export interface DeviceReport {
  videoId: string | null; position: number; duration: number
  paused: boolean; completed: boolean; playerConnected: boolean; notice: string
  run?: { id: string; revision: number; videoIndex: number }
  controlling: boolean
}
export interface RemoteAssignment {
  runId: string; revision: number; videoIndex: number; videoId: string; position: number; paused: boolean
  playlistId: string; videoIds: string[]
  // Older local checkpoints have no sequence ID and request a full assignment.
  sequenceId?: string
  revisionReason: 'navigation' | 'advance' | 'transfer' | 'reload'
}
export interface Observation { id: string; waitUntil: number; endsAt: number | null }
export interface RetryRequest { id: string; runId: string; revision: number; videoIndex: number; videoId: string; expiresAt: number }
export interface RetryResult { id: string; status: 'applied' | 'failed'; error?: string }
export interface SyncPayload { report?: DeviceReport; knownSequenceId?: string; observationId?: string; retryResult?: RetryResult }
export interface SyncResult { assignment: RemoteAssignment | null; observation: Observation | null; retry: RetryRequest | null }
interface Connection { endpoint: string; token: string; name: string; owner: string; revoked?: boolean }
let connection: Connection | null = null
let synced = false
let error = ''

export function endpointFrom(input: string) {
  const url = new URL(input)
  if (url.protocol !== 'https:' || !/^[a-z0-9-]+\.convex\.site$/.test(url.hostname) || url.port || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Use the HTTPS Convex site address shown with the pairing code.')
  }
  return url.origin
}
export async function initializeRemote() {
  const data = await chrome.storage.local.get('remote')
  connection = (data.remote as Connection | undefined) ?? null
}

export function remoteStatus() {
  return { name: connection?.name ?? null,
    paired: Boolean(connection && !connection.revoked), synced, error }
}
export function remoteOwner(): string | null {
  return connection && !connection.revoked ? connection.owner : null
}

export function assignmentFrom(value: unknown, previous?: RemoteAssignment | null): RemoteAssignment | null {
  if (value === null) return null
  if (!value || typeof value !== 'object') throw new Error('Invalid playlist assignment.')
  const assignment = { ...value as Partial<RemoteAssignment> }
  if (assignment.videoIds === undefined && assignment.sequenceId && assignment.sequenceId === previous?.sequenceId) {
    assignment.videoIds = previous.videoIds
  }
  // Preserve checkpoints written while the removed Admin controls were available.
  const reason = (value as { revisionReason?: unknown }).revisionReason
  if (reason === 'pause' || reason === 'resume') assignment.revisionReason = 'transfer'
  if (typeof assignment.runId !== 'string' || !assignment.runId || assignment.runId.length > 128
    || !Number.isSafeInteger(assignment.revision) || assignment.revision! < 1
    || !Number.isSafeInteger(assignment.videoIndex) || assignment.videoIndex! < 0
    || typeof assignment.videoId !== 'string' || !/^[\w-]{11}$/.test(assignment.videoId)
    || typeof assignment.position !== 'number' || !Number.isFinite(assignment.position) || assignment.position < 0 || assignment.position > 7 * 86400
    || typeof assignment.playlistId !== 'string' || !/^[\w-]{10,100}$/.test(assignment.playlistId)
    || (assignment.sequenceId !== undefined && (typeof assignment.sequenceId !== 'string' || !assignment.sequenceId || assignment.sequenceId.length > 128))
    || !Array.isArray(assignment.videoIds) || assignment.videoIds.length < 1 || assignment.videoIds.length > 1_000
    || assignment.videoIds.some(id => typeof id !== 'string' || !/^[\w-]{11}$/.test(id))
    || assignment.videoIds[assignment.videoIndex!] !== assignment.videoId
    || !['navigation', 'advance', 'transfer', 'reload'].includes(assignment.revisionReason ?? '')
    || typeof assignment.paused !== 'boolean') throw new Error('Invalid playlist assignment.')
  return assignment as RemoteAssignment
}
async function request(endpoint: string, path: string, body: unknown, token?: string) {
  return fetch(endpoint + path, { method: 'POST', credentials: 'omit', redirect: 'error',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body), signal: AbortSignal.timeout(5_000) })
}
export async function pairRemote(endpointInput: string, codeInput: string) {
  const endpoint = endpointFrom(endpointInput)
  const code = codeInput.trim().toLowerCase()
  if (!/^[a-f0-9]{32}$/.test(code)) throw new Error('Paste the complete pairing code from Momoi Admin.')
  if (!await chrome.permissions.contains({ origins: [`${endpoint}/*`] })) throw new Error('Allow connection to the selected Momoi backend first.')
  const fingerprint = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(endpoint + code))), x => x.toString(16).padStart(2, '0')).join('')
  const stored = await chrome.storage.local.get('pairAttempt')
  const attempt = stored.pairAttempt as { fingerprint: string; token: string } | undefined
  const token = attempt?.fingerprint === fingerprint ? attempt.token : crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', '')
  // Retain the same proposed credential for a retry after an uncertain exchange.
  await chrome.storage.local.set({ pairAttempt: { fingerprint, token } })
  const response = await request(endpoint, '/playback/pair', { code, token, protocolVersion: 4 })
  if (response.status === 426) throw new Error('Update the extension and Momoi backend to matching versions.')
  if (!response.ok) throw new Error('Pairing failed. Check the endpoint and use a current pairing code.')
  const result = await response.json() as { name?: unknown }
  if (typeof result.name !== 'string') throw new Error('Pairing response was invalid.')
  connection = { endpoint, token, name: result.name.slice(0, 80), owner: crypto.randomUUID() }
  synced = false
  error = ''
  await chrome.storage.local.set({ remote: connection })
  await chrome.storage.local.remove('pairAttempt')
  await chrome.storage.session.remove('pairingDraft')
}
export async function disconnectRemote() {
  connection = null
  synced = false
  error = ''
  await chrome.storage.local.remove(['remote', 'pairAttempt'])
  await chrome.storage.session.remove('pairingDraft')
}
// Network sync runs outside the player queue, so outages cannot delay saving.
export async function syncRemote(
  payload: SyncPayload,
  previous: RemoteAssignment | null,
  receive: (result: SyncResult, owner: string, allowed: () => boolean) => Promise<void>,
  revoke: (allowed: () => boolean) => Promise<void>,
): Promise<boolean> {
  if (!connection || connection.revoked) return false
  const current = connection
  try {
    const requestedAt = performance.now()
    const response = await request(current.endpoint, '/playback/sync', { ...payload, protocolVersion: 4 }, current.token)
    if (connection !== current) return false
    if (response.status === 401) {
      current.revoked = true
      await chrome.storage.local.set({ remote: current })
      await revoke(() => connection === current)
      throw new Error('Device access was revoked. Pair again in Momoi Admin.')
    }
    if (response.status === 426) throw new Error('Update the extension and Momoi backend to matching versions.')
    if (!response.ok) throw new Error('Cannot reach Momoi. Progress is saved locally; advancement waits for reconnection.')
    const body = await response.json() as { assignment?: unknown; observation?: Observation | null; retry?: RetryRequest | null }
    if (connection !== current) return false
    if (body.assignment === undefined || body.observation === undefined || body.retry === undefined
      || body.observation !== null && (typeof body.observation.id !== 'string' || !body.observation.id || body.observation.id.length > 128
        || !Number.isFinite(body.observation.waitUntil) || body.observation.waitUntil <= 0
        || body.observation.endsAt !== null && (!Number.isFinite(body.observation.endsAt) || body.observation.endsAt <= 0))
      || body.retry !== null && (typeof body.retry.id !== 'string' || !body.retry.id || body.retry.id.length > 128
        || typeof body.retry.runId !== 'string' || !body.retry.runId || body.retry.runId.length > 128
        || !Number.isSafeInteger(body.retry.revision) || body.retry.revision < 1
        || !Number.isSafeInteger(body.retry.videoIndex) || body.retry.videoIndex < 0 || body.retry.videoIndex > 999
        || typeof body.retry.videoId !== 'string' || !/^[\w-]{11}$/.test(body.retry.videoId)
        || !Number.isFinite(body.retry.expiresAt) || body.retry.expiresAt <= 0)) throw new Error('Invalid playback response.')
    synced = true
    error = ''
    await receive({ assignment: assignmentFrom(body.assignment, previous), observation: body.observation, retry: body.retry }, current.owner,
      () => connection === current && !current.revoked && performance.now() - requestedAt < 10_000)
    return true
  } catch (failure) {
    if (connection === current) {
      synced = false
      error = failure instanceof Error ? failure.message : 'Momoi connection failed. Progress is saved locally.'
    }
    return false
  }
}

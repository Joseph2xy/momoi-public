import { assignmentFrom, disconnectRemote, endpointFrom, initializeRemote, pairRemote, remoteOwner, remoteStatus, syncRemote } from './remote'
import type { DeviceReport, Observation, RemoteAssignment, RetryRequest, RetryResult } from './remote'
import { advancePlayer, inspectPlayer } from './youtube'
import type { HeartbeatResponse, PlaybackControl, PlaybackSnapshot } from './youtube'
interface SavedPlayback extends RemoteAssignment {
  version: 2; tag: string; owner: string; duration: number; completed: boolean
}
function readPlayback(value: unknown): SavedPlayback | null {
  if (!value || typeof value !== 'object') return null
  const s = value as SavedPlayback
  let assignment: RemoteAssignment | null
  try { assignment = assignmentFrom(s); if (!assignment) return null } catch { return null }
  return s.version === 2
    && typeof s.owner === 'string' && !!s.owner && typeof s.tag === 'string' && /^[a-f0-9-]{36}$/i.test(s.tag)
    && Number.isFinite(s.duration) && s.duration >= 0 && s.duration <= 7 * 86400
    && typeof s.completed === 'boolean' ? { ...s, ...assignment } : null
}
let saved: SavedPlayback | null = null
let tabId: number | null = null
let snapshot: PlaybackSnapshot | null = null
let lastHeartbeat = 0
let lastSave = 0
let control: PlaybackControl | undefined
let notice = ''
let pairingError = ''
let enabled = false
let confirmedEntry: string | null = null
let lastCheckpoint: string | null = null
interface RetryReceipt extends RetryRequest { status: 'applying' | 'applied' | 'failed'; error?: string; owner: string; controlId?: string }
let retryReceipt: RetryReceipt | null = null
let observation: Observation | null = null
let observationTimer: ReturnType<typeof setTimeout> | undefined
let reportVersion = 0
let acknowledgedVersion = -1
let acknowledgedKey = ''
let lastExchange = -Infinity
let lastReport = -Infinity
let lastAttempt = -Infinity
let failedExchange = false
let forcePending = false
let syncing: Promise<void> | null = null
let queue: Promise<unknown> = Promise.resolve()
function serial<T>(operation: () => Promise<T>): Promise<T> {
  const result = queue.then(operation)
  queue = result.catch(() => {})
  return result
}
const initialized = (async () => {
  await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' })
  await initializeRemote()
  const data = await chrome.storage.local.get(['playback', 'playbackRetry'])
  saved = readPlayback(data.playback)
  const receipt = data.playbackRetry as RetryReceipt | undefined
  if (receipt && typeof receipt.id === 'string' && typeof receipt.owner === 'string'
    && ['applying', 'applied', 'failed'].includes(receipt.status) && Number.isFinite(receipt.expiresAt)) retryReceipt = receipt
  const session = await chrome.storage.session.get(['playbackTab', 'playbackEnabled', 'playbackControl'])
  tabId = typeof session.playbackTab === 'number' ? session.playbackTab : null
  enabled = session.playbackEnabled === true
  const previousControl = session.playbackControl as (PlaybackControl & { kind?: unknown }) | undefined
  // Discard a pending action from the removed controls, retaining the checkpoint.
  control = previousControl?.kind === 'pause' || previousControl?.kind === 'resume' ? undefined : previousControl
  if (previousControl && !control) await chrome.storage.session.remove('playbackControl')
  if (control && (control.videoId !== saved?.videoId || control.playlistId !== saved?.playlistId || control.videoIndex !== saved?.videoIndex)) {
    control = undefined
    newControl(false)
  }
  await chrome.alarms.create('momoi-sync', { periodInMinutes: 0.5 })
})()
async function persist() {
  await chrome.storage.local.set({ playback: saved, playbackRetry: retryReceipt })
  await chrome.storage.session.set({ playbackTab: tabId, playbackEnabled: enabled, playbackControl: control ?? null })
  lastSave = Date.now()
}
async function saveRetry() {
  await chrome.storage.local.set({ playbackRetry: retryReceipt })
  reportVersion++
}
async function cancelRetryControl() {
  if (!retryReceipt?.controlId || control?.id !== retryReceipt.controlId) return
  control = undefined
  if (saved) saved.paused = true
  notice = retryReceipt.error ?? 'Playback recovery failed.'
  await persist()
  if (tabId !== null) await chrome.scripting.executeScript({ target: { tabId }, func: () => {
    document.querySelector<HTMLVideoElement>('#movie_player video')?.pause()
  } }).catch(() => {})
}
function observe(value: Observation | null) {
  observation = value && Date.now() < (value.endsAt ?? value.waitUntil) ? value : null
  clearTimeout(observationTimer)
  if (observation) observationTimer = setTimeout(() => {
    // The timer only exists for a requested, bounded window. Alarms still
    // recover a suspended worker; browser scheduling can delay these updates.
    observe(observation)
    void sync()
  }, 5_000)
}
async function retryPlayback(request: RetryRequest, owner: string, allowed: () => boolean) {
  if (!allowed() || retryReceipt?.id === request.id && retryReceipt.owner === owner) return
  retryReceipt = { ...request, owner, status: 'applying' }
  // Persist before touching the tab: an uncertain response or worker restart
  // must not repeatedly reload the same request.
  await saveRetry()
  if (!allowed()) return
  if (!saved || saved.owner !== owner || saved.runId !== request.runId || saved.revision !== request.revision
    || saved.videoIndex !== request.videoIndex || saved.videoId !== request.videoId || saved.completed || Date.now() >= request.expiresAt) {
    retryReceipt.status = 'failed'; retryReceipt.error = 'Playback changed before recovery could start.'
  } else if (tabId === null) {
    retryReceipt.status = 'failed'; retryReceipt.error = 'The playback tab is closed. Open the extension to resume.'
  } else {
    try {
      notice = ''
      control = undefined
      snapshot = null
      // Force restoration even if the previous player looked healthy. Keep the
      // latest local position (including backwards seeks), then attempt Play.
      await openPlayback(true, false, false, { receipt: retryReceipt, allowed })
    } catch (error) {
      retryReceipt.status = 'failed'
      retryReceipt.error = error instanceof Error ? error.message.slice(0, 300) : 'Playback recovery failed.'
    }
  }
  if (retryReceipt.status === 'failed') await cancelRetryControl()
  await saveRetry()
}
async function finishRetry() {
  if (!retryReceipt || retryReceipt.status !== 'applying' || retryReceipt.owner !== remoteOwner()) return
  const targetMatches = saved?.runId === retryReceipt.runId && saved.revision === retryReceipt.revision
    && saved.videoIndex === retryReceipt.videoIndex && saved.videoId === retryReceipt.videoId
  if (!targetMatches || saved?.completed || tabId === null || Date.now() >= retryReceipt.expiresAt || snapshot?.error) {
    retryReceipt.status = 'failed'
    retryReceipt.error = snapshot?.error || (!targetMatches ? 'Playback changed during recovery.' : tabId === null
      ? 'The playback tab was closed during recovery.' : 'The browser did not confirm resumed playback in time.')
    await cancelRetryControl()
  } else if (!control && retryReceipt.controlId && snapshot?.applied === retryReceipt.controlId
    && snapshot.ready && !snapshot.paused && !snapshot.seeking && !notice
    && Date.now() - lastHeartbeat < 10_000 && snapshot.videoId === retryReceipt.videoId) {
    retryReceipt.status = 'applied'
  } else return
  await saveRetry()
}
function status() {
  const connected = tabId !== null && Date.now() - lastHeartbeat < 10_000
  const owned = saved?.owner === remoteOwner() ? saved : null
  return { remote: remoteStatus(), pairingError, available: Boolean(owned && enabled), canFocus: tabId !== null, playback: owned ? {
    videoId: owned.videoId, videoIndex: owned.videoIndex, videoCount: owned.videoIds.length, position: owned.position,
  } : null, notice,
    title: owned ? snapshot?.title ?? '' : '', state: !connected ? 'Playback closed' : owned?.completed ? 'Waiting for Momoi'
      : notice ? 'Check playback' : control ? 'Preparing playback' : owned?.paused ? 'Paused' : 'Playing' }
}
export type PlaybackStatus = ReturnType<typeof status>
function newControl(play: boolean) {
  if (!saved) return
  control = { id: crypto.randomUUID(), videoId: saved.videoId, playlistId: saved.playlistId,
    videoIndex: saved.videoIndex, position: saved.position, play }
}
async function stop() {
  enabled = false
  control = undefined
  if (saved) { saved.paused = true; await persist() }
  if (tabId !== null) await chrome.scripting.executeScript({ target: { tabId }, func: () => {
    document.querySelector<HTMLVideoElement>('#movie_player video')?.pause()
  } }).catch(() => {})
}
async function openPlayback(play: boolean, focus = false, advance = false,
  recovery?: { receipt: RetryReceipt; allowed: () => boolean }) {
  if (!saved) throw new Error('Choose a starting playlist in Momoi Admin first.')
  const target = saved
  const tab = tabId === null ? null : await chrome.tabs.get(tabId).catch(() => null)
  function checkRecovery() {
    if (!recovery) return
    const request = recovery.receipt
    if (!recovery.allowed() || retryReceipt !== request || request.status !== 'applying'
      || saved !== target || target.owner !== request.owner || target.completed
      || target.runId !== request.runId || target.revision !== request.revision
      || target.videoIndex !== request.videoIndex || target.videoId !== request.videoId
      || Date.now() >= request.expiresAt) throw new Error('Playback changed before recovery could start.')
    if (!tab) throw new Error('The playback tab is closed. Open the extension to resume.')
  }
  checkRecovery()
  if (tab) {
    if (!control && snapshot?.ready && Date.now() - lastHeartbeat < 10_000 && snapshot.videoId === target.videoId
      && snapshot.playlistId === target.playlistId && snapshot.videoIndex === target.videoIndex
      && !snapshot.error && !target.completed && !notice) {
      if (play && target.paused) { newControl(true); await persist() }
      if (focus) {
        await chrome.tabs.update(tab.id!, { active: true })
        await chrome.windows.update(tab.windowId, { focused: true })
      }
      return
    }
  } else tabId = null
  // Only the popup's Start action may create a tab. A delayed assignment must
  // not reopen one the owner closed while the request was in flight.
  if (tabId === null && !focus) return
  const url = new URL('https://www.youtube.com/watch')
  url.searchParams.set('v', target.videoId)
  url.searchParams.set('list', target.playlistId)
  url.searchParams.set('index', String(target.videoIndex + 1))
  url.hash = 'momoi=' + target.tag
  confirmedEntry = null
  lastCheckpoint = null
  snapshot = null
  lastHeartbeat = 0
  newControl(play)
  if (recovery && control) {
    recovery.receipt.controlId = control.id
    await persist()
    // Storage and tab lookups can outlive the request. Keep the control tied
    // to its receipt so failure cleanup also cancels a delayed Play.
    checkRecovery()
  }
  if (tab && advance) {
    // Release the old ending only after the server assigned its successor.
    // Keep the page's user activation and fullscreen instead of reloading it.
    await persist()
    try {
      const prepared = await chrome.tabs.sendMessage(tab.id!, { type: 'prepare-advance', tag: target.tag })
      if (prepared !== true) throw new Error('Playback page did not acknowledge the next video.')
      const result = await chrome.scripting.executeScript({ target: { tabId: tab.id! }, world: 'MAIN',
        func: advancePlayer, args: [target.videoId, target.playlistId, target.videoIndex] })
      if (result[0]?.result !== true) throw new Error('YouTube navigation is unavailable.')
    } catch {
      control = undefined
      target.paused = true
      notice = 'YouTube could not open the next video. Choose Retry playback in the extension.'
      await persist()
    }
    return
  }
  if (tab) {
    // YouTube's SPA navigation can remove the owner fragment. Restoring only
    // that fragment keeps the old content script (including its latched hold
    // or error) alive. Recovery must load a fresh document in that case too.
    const currentUrl = tab.url ? new URL(tab.url) : null
    if (currentUrl) currentUrl.hash = url.hash
    const sameDocument = currentUrl?.href === url.href
    if (tab.url !== url.href) await chrome.tabs.update(tab.id!, { url: url.href, ...(focus ? { active: true } : {}) })
    if (sameDocument) await chrome.tabs.reload(tab.id!)
    if (focus) await chrome.windows.update(tab.windowId, { focused: true })
  }
  else {
    const created = await chrome.tabs.create({ url: url.href, active: true })
    tabId = created.id ?? null
  }
  await persist()
}
function report(): DeviceReport {
  const owned = saved?.owner === remoteOwner() ? saved : null
  const connected = tabId !== null && Date.now() - lastHeartbeat < 10_000
  return { videoId: owned?.videoId ?? null, position: owned?.position ?? 0,
    controlling: Boolean(control),
    duration: owned?.duration ?? 0, paused: !connected || (owned?.paused ?? true),
    completed: owned?.completed ?? false, playerConnected: connected,
    notice: (notice || (!connected ? 'Open the extension to resume playback.' : owned?.completed ? 'Video finished. Waiting for Momoi.' : control ? 'Opening the saved video. Check YouTube if playback does not start.' : owned?.paused ? 'Paused on YouTube.' : 'Playing on YouTube.')).slice(0, 300),
    ...(owned ? { run: { id: owned.runId, revision: owned.revision, videoIndex: owned.videoIndex } } : {}) }
}
async function assign(assignment: RemoteAssignment | null, owner: string, allowed: () => boolean, sent: DeviceReport) {
  if (!allowed()) return
  enabled = assignment !== null
  await chrome.storage.session.set({ playbackEnabled: enabled })
  if (!assignment) {
    await stop()
    notice = 'Choose a playlist in Momoi Admin.'
    return
  }
  const sameRun = saved?.owner === owner && saved.runId === assignment.runId
  if (sameRun && saved) {
    if (assignment.sequenceId && saved.sequenceId !== assignment.sequenceId) {
      saved.sequenceId = assignment.sequenceId
      saved.videoIds = assignment.videoIds
      await persist()
    }
    if (assignment.revision <= saved.revision) return
    // Navigation acknowledgement must not overwrite newer local seeks/selections.
    if (assignment.revisionReason === 'navigation') {
      saved.revision = assignment.revision
      saved.revisionReason = assignment.revisionReason
      await persist()
      return
    }
    if (assignment.revisionReason === 'reload') {
      saved = { ...saved, ...assignment, completed: false }
      notice = ''
      control = undefined
      // Remote actions operate on the existing tab; they never reopen a closed one.
      if (tabId !== null) {
        snapshot = null
        await openPlayback(!assignment.paused)
      } else await persist()
      return
    }
  }
  const continuePlaying = Boolean(sent.completed && !saved?.paused && tabId !== null && !assignment.paused)
  saved = { ...assignment, version: 2, owner, tag: saved?.tag ?? crypto.randomUUID(), duration: 0,
    paused: !continuePlaying, completed: false }
  notice = ''
  snapshot = null
  control = undefined
  await persist()
  await openPlayback(continuePlaying, false, continuePlaying)
}
async function sync(force = false) {
  await initialized
  forcePending ||= force
  if (syncing) return syncing
  if (!remoteOwner()) return
  syncing = (async () => {
    for (;;) {
      await serial(finishRetry)
      const sent = report()
      const key = JSON.stringify({ ...sent, position: undefined, duration: undefined })
      const now = performance.now()
      const observing = observation && Date.now() < (observation.endsAt ?? observation.waitUntil)
      const meaningful = reportVersion !== acknowledgedVersion || key !== acknowledgedKey
      const reportDue = Boolean(observing && now - lastReport >= 5_000
        || sent.playerConnected && !sent.paused && now - lastReport >= 60_000)
      if (failedExchange && now - lastAttempt < 5_000) break
      if (!forcePending && !meaningful && !reportDue && now - lastExchange < 30_000) break
      const includeReport = forcePending || meaningful || reportDue || observing && observation?.endsAt === null
      forcePending = false
      const version = reportVersion
      const previous = saved?.owner === remoteOwner() ? saved : null
      const receipt: RetryResult | undefined = retryReceipt && retryReceipt.owner === remoteOwner() && retryReceipt.status !== 'applying'
        ? { id: retryReceipt.id, status: retryReceipt.status, ...(retryReceipt.error ? { error: retryReceipt.error } : {}) } : undefined
      lastAttempt = now
      const succeeded = await syncRemote({ ...(includeReport ? { report: sent } : {}),
        ...(previous?.sequenceId ? { knownSequenceId: previous.sequenceId } : {}),
        ...(observing ? { observationId: observation!.id } : {}), ...(receipt ? { retryResult: receipt } : {}) }, previous,
      (result, owner, allowed) => serial(async () => {
        if (!allowed()) return
        await assign(result.assignment, owner, allowed, sent)
        if (!allowed()) return
        observe(result.observation)
        if (observation?.endsAt === null) forcePending = true
        if (result.retry) await retryPlayback(result.retry, owner, allowed)
      }), allowed => serial(async () => { if (allowed()) { observe(null); await stop() } }))
      failedExchange = !succeeded
      if (!succeeded) break
      lastExchange = now
      if (includeReport) { lastReport = now; acknowledgedKey = key; acknowledgedVersion = version }
      if (!remoteOwner()) break
      // Recheck the latest local state. Events arriving during the request are
      // coalesced here instead of being dropped behind the periodic throttle.
    }
  })()
  try { await syncing } finally { syncing = null }
}
async function heartbeat(value: PlaybackSnapshot, sender: chrome.runtime.MessageSender): Promise<HeartbeatResponse> {
  if (!saved || saved.owner !== remoteOwner() || sender.tab?.id === undefined || value.controllerTag !== saved.tag) return { managed: false }
  if (tabId !== null && tabId !== sender.tab.id) {
    const existing = await chrome.tabs.get(tabId).catch(() => null)
    if (existing) return { managed: false }
  }
  if (tabId !== sender.tab.id) {
    tabId = sender.tab.id
    saved.paused = true
    newControl(false)
    await persist()
  }
  lastHeartbeat = Date.now()
  snapshot = value
  // An expired remote recovery must not be returned to a player waking later.
  await finishRetry()
  if (!enabled) return { managed: true, hold: true }
  if (value.error) {
    notice = value.error
    if (!saved.paused) { saved.paused = true; await persist() }
    return { managed: true, hold: true }
  }
  if (saved.completed) return { managed: true, hold: true }
  if (value.playlistId !== saved.playlistId) {
    notice = 'This video is outside your saved playlist. Choose Retry playback to restore it.'
    if (!saved.paused) { saved.paused = true; await persist() }
    return { managed: true, hold: true }
  }
  // Seeking can be applied with metadata loaded, before enough media has
  // buffered for ready=true. Do not re-pause an acknowledged Start command
  // while waiting for that buffer; progress is still validated below.
  if (control && value.applied === control.id && value.videoId === control.videoId) {
    control = undefined
    await chrome.storage.session.remove('playbackControl')
  }
  if (!value.ready) return { managed: true,
    hold: Boolean(control || value.videoId !== saved.videoId),
    allowAd: control ? control.play : true,
    ...(control ? { control } : {}) }
  const entryKey = (index: number) => `${sender.documentId ?? sender.tab!.id}:${saved!.runId}:${index}:${value.videoId}`
  // YouTube may already have navigated after an ending. Keep the ending tied to
  // the entry this document previously proved, never to its new player state.
  const confirmedEnd = value.ended && value.videoId === saved.videoId
    && confirmedEntry === entryKey(saved.videoIndex)
  let index = saved.videoIndex
  if (!confirmedEnd) {
    const identity = await chrome.scripting.executeScript({
      target: { tabId, ...(sender.documentId ? { documentIds: [sender.documentId] } : { frameIds: [0] }) },
      world: 'MAIN', func: inspectPlayer,
    }).catch(() => [])
    const observed = identity[0]?.result
    if (!observed || observed.videoId !== value.videoId || observed.videoIndex === null) {
      notice = 'Waiting for YouTube to identify the playlist video. Check the playback tab if it does not load.'
      return { managed: true, hold: true }
    }
    index = observed.videoIndex
    // The watch URL can lag behind YouTube's player. Validate the actual entry
    // against the saved sequence instead of requiring both positions to agree.
    if (saved.videoIds[index] !== value.videoId) {
      notice = 'YouTube’s playlist no longer matches the saved sequence. Check its entries in Momoi Admin.'
      return { managed: true, hold: true }
    }
    confirmedEntry = entryKey(index)
  }
  if (control && (index !== control.videoIndex || value.videoId !== control.videoId)) {
    notice = 'YouTube opened a different playlist entry. Choose Retry playback to restore the saved video.'
    return { managed: true, hold: true }
  }
  notice = ''
  if (control) return { managed: true, hold: true, control }
  if (value.seeking) return { managed: true, hold: false }
  const changed = saved.videoIndex !== index || saved.paused !== value.paused
  saved.videoIndex = index
  saved.videoId = value.videoId!
  const checkpoint = value.checkpoint === undefined ? null : `${sender.documentId ?? sender.tab.id}:${value.checkpoint}`
  const checkpointChanged = checkpoint !== null && checkpoint !== lastCheckpoint
  saved.position = Math.max(0, value.currentTime)
  saved.duration = Math.max(0, value.duration)
  const ended = value.ended && value.duration > 0 && value.currentTime >= value.duration - 1
  saved.paused = ended ? false : value.paused
  saved.completed = ended
  notice = ended ? 'Video finished. Waiting for Momoi.' : ''
  if (changed || checkpointChanged || ended || Date.now() - lastSave >= 5_000) await persist()
  if (changed || checkpointChanged || ended) reportVersion++
  lastCheckpoint = checkpoint
  return { managed: true, hold: ended }
}
function validSnapshot(value: unknown): value is PlaybackSnapshot {
  if (!value || typeof value !== 'object') return false
  const s = value as Record<string, unknown>
  return (s.controllerTag === null || typeof s.controllerTag === 'string' && /^[a-f0-9-]{36}$/i.test(s.controllerTag))
    && (s.videoId === null || typeof s.videoId === 'string' && /^[\w-]{11}$/.test(s.videoId))
    && (s.playlistId === null || typeof s.playlistId === 'string' && s.playlistId.length <= 100)
    && typeof s.videoIndex === 'number' && Number.isSafeInteger(s.videoIndex) && s.videoIndex >= -1 && s.videoIndex < 1000
    && ['currentTime', 'duration'].every(key => typeof s[key] === 'number' && Number.isFinite(s[key]) && (s[key] as number) >= 0)
    && (s.currentTime as number) <= 7 * 86400 && (s.duration as number) <= 7 * 86400
    && ['paused', 'seeking', 'ended', 'ready'].every(key => typeof s[key] === 'boolean')
    && typeof s.title === 'string' && s.title.length <= 500
    && (s.error === null || typeof s.error === 'string' && s.error.length <= 300)
    && (s.applied === undefined || typeof s.applied === 'string' && s.applied.length <= 100)
    && (s.checkpoint === undefined || typeof s.checkpoint === 'number' && Number.isSafeInteger(s.checkpoint) && s.checkpoint >= 0)
}
chrome.runtime.onMessage.addListener((message: unknown, sender, respond) => {
  const data = message as Record<string, unknown> | null
  if (!data || typeof data.type !== 'string' || sender.id !== chrome.runtime.id) return false
  if (data.type === 'heartbeat') {
    if (!sender.tab || sender.frameId !== 0 || !sender.url?.startsWith('https://www.youtube.com/')) return false
    if (!validSnapshot(data.snapshot)) { respond({ managed: true, hold: true }); return false }
    const value = data.snapshot
    void initialized.then(() => serial(() => heartbeat(value, sender)))
      .then(result => { respond(result); void sync() }, () => respond({ managed: true, hold: true }))
    return true
  }
  if (sender.tab || sender.url !== chrome.runtime.getURL('control.html')) return false
  if (data.type === 'pair') {
    // Request synchronously in the message's user gesture. The worker owns the
    // continuation because the browser's permission prompt can close the popup.
    try {
      const endpoint = endpointFrom(String(data.endpoint))
      const code = String(data.code).trim().toLowerCase()
      if (!/^[a-f0-9]{32}$/.test(code)) throw new Error('Paste the complete connection code from Momoi Admin.')
      pairingError = ''
      const permission = chrome.permissions.request({ origins: [endpoint + '/*'] })
      void (async () => {
        if (!await permission) throw new Error('Allow this connection to link your browser to Momoi.')
        await initialized
        await serial(async () => { await stop(); await pairRemote(endpoint, code); enabled = false; observe(null); acknowledgedVersion = -1; lastAttempt = -Infinity; failedExchange = false })
        void sync(true)
        respond({ ok: true, status: status() })
      })().catch(error => {
        pairingError = error instanceof Error ? error.message : 'Connection failed. Try again.'
        respond({ ok: false, error: pairingError })
      })
    } catch (error) {
      pairingError = error instanceof Error ? error.message : 'Connection failed. Try again.'
      respond({ ok: false, error: pairingError })
    }
    return true
  }
  void (async () => {
    await initialized
    if (data.type === 'start') {
      await sync(true)
      await serial(async () => {
        if (!remoteOwner() || !saved || saved.owner !== remoteOwner() || !enabled) throw new Error('Connect this browser and choose a starting playlist in Momoi Admin first.')
        if (saved.completed) throw new Error('Waiting for Momoi to advance the finished video. Try again after reconnecting.')
        await openPlayback(true, true)
      })
    } else await serial(async () => {
      if (data.type === 'disconnect') { await stop(); await disconnectRemote(); enabled = false; pairingError = '' }
      else if (data.type === 'focus') {
        const tab = tabId === null ? null : await chrome.tabs.get(tabId).catch(() => null)
        if (!tab) throw new Error('The YouTube tab is closed. Reopen this popup and choose Resume.')
        await chrome.tabs.update(tab.id!, { active: true })
        await chrome.windows.update(tab.windowId, { focused: true })
      }
      else if (data.type !== 'status') throw new Error('Unknown extension action.')
    })
    respond({ ok: true, status: status() })
    // Opening the popup is not a request for remote telemetry.
  })().catch(error => respond({ ok: false, error: error instanceof Error ? error.message : 'Playback action failed.' }))
  return true
})
chrome.tabs.onRemoved.addListener(id => {
  void initialized.then(() => serial(async () => {
    if (id !== tabId) return false
    tabId = null
    snapshot = null
    confirmedEntry = null
    control = undefined
    if (saved) { saved.paused = true; await persist() }
    return true
  })).then(removed => { if (removed) return sync(true) })
})
chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === 'momoi-sync') void sync() })
void initialized.then(() => sync())

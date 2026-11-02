import { ConvexError, v } from 'convex/values'
import { action, internalMutation, mutation, query } from './_generated/server'
import { internal } from './_generated/api'
import { requireAdmin } from './identity'
import { requireReady } from './operations'
import type { Doc, Id } from './_generated/dataModel'
import { acceptRunReport, activeRun, activationBlockers, assignPairedRun, createRun, playbackState, preparedGames, runAssignment } from './playbackRuns'
import { isPreparedPlaylist } from './playlistAvailability'
import { currentRound } from './voting'

const reportFields = v.object({ videoId: v.union(v.string(), v.null()), position: v.number(), duration: v.number(),
  paused: v.boolean(), completed: v.boolean(), playerConnected: v.boolean(), notice: v.string(),
  controlling: v.optional(v.boolean()),
  run: v.optional(v.object({ id: v.string(), revision: v.number(), videoIndex: v.number() })) })
const OBSERVATION_LEASE = 60_000
const DEVICE_CONTACT_WINDOW = 90_000
const RETRY_DURATION = 90_000
type Observation = NonNullable<Doc<'playbackDevices'>['observation']>
type Retry = NonNullable<Doc<'playbackDevices'>['retry']>

function observationActive(observation: Observation | undefined, now: number): observation is Observation {
  return !!observation && (observation.endsAt ?? observation.waitUntil) > now
}

function retryMatchesRun(retry: Retry, run: Doc<'playbackRuns'> | null, deviceId: Id<'playbackDevices'>) {
  return !!run && run.status === 'playing' && run.deviceId === deviceId && retry.runId === run._id &&
    retry.revision === run.revision && retry.videoIndex === run.videoIndex && retry.videoId === run.video.videoId
}
export async function digest(value: string) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('')
}

export const status = query({ args: {}, handler: async ctx => {
  await requireAdmin(ctx)
  const device = await ctx.db.query('playbackDevices').withIndex('revoked', q => q.eq('revoked', false)).unique()
  const run = await activeRun(ctx)
  return {
    roundId: (await currentRound(ctx)).sourceId,
    run: run ? { id: run._id, title: run.title, videoIndex: run.videoIndex,
      videoCount: run.videoCount, videoId: run.video.videoId, videoTitle: run.video.title, position: run.position, checkpointAt: run.checkpointAt ?? null, revision: run.revision, deviceId: run.deviceId } : null,
    device: device ? {
    id: device._id, name: device.name,
    lastSeen: device.lastSeen, report: device.report ?? null, reportAt: device.reportAt ?? null,
    observation: device.observation ? { ...device.observation, endsAt: device.observation.endsAt ?? null } : null,
    retry: device.retry ?? null,
  } : null }
} })

export const catalogue = query({ args: {}, handler: async ctx => {
  await requireAdmin(ctx)
  const lists = await preparedGames(ctx)
  const eligible = lists.filter(list => !list.retired).map(list => list.gameId)
  const state = await playbackState(ctx)
  const startBlockers = state?.playbackRunId ? [] : await activationBlockers(ctx, eligible)
  if (!state?.playbackRunId && eligible.length < 2) startBlockers.push('Save playlists for at least two nonretired games in Catalogue before starting.')
  return { selectedPlaylists: lists.map(list => ({ playlistId: list.playlistId, title: list.title, retired: list.retired })), startBlockers }
} })

export const playlist = query({ args: { playlistId: v.string() }, handler: async (ctx, args) => {
  await requireAdmin(ctx)
  const list = await ctx.db.query('playlists').withIndex('playlistId', q => q.eq('playlistId', args.playlistId)).unique()
  const sequence = list && isPreparedPlaylist(list) ? await ctx.db.get(list.sequenceId) : null
  return sequence ? { videos: sequence.videos } : null
} })

export const startRun = mutation({ args: {
  deviceId: v.id('playbackDevices'), roundId: v.string(), playlistId: v.string(),
  videoIndex: v.number(), expectedVideoId: v.string(), position: v.number(),
}, handler: async (ctx, args) => {
  const actor = await requireAdmin(ctx)
  const state = await playbackState(ctx); const round = await currentRound(ctx)
  if (!state || round.sourceId !== args.roundId) throw new ConvexError('ROUND_CHANGED')
  if (state.playbackRunId) throw new ConvexError('A playlist is already selected. Open the extension to resume it.')
  const device = await ctx.db.get(args.deviceId)
  if (!device || device.revoked || !device.lastSeen || Date.now() - device.lastSeen > 60_000) throw new ConvexError('Connect the streaming device before preparing the first playlist.')
  const lists = await preparedGames(ctx)
  const list = lists.find(list => list.playlistId === args.playlistId)
  const sequence = list ? await ctx.db.get(list.sequenceId) : null
  const video = Number.isSafeInteger(args.videoIndex) && args.videoIndex >= 0 ? sequence?.videos[args.videoIndex] : undefined
  if (!list || !video || video.videoId !== args.expectedVideoId || !Number.isFinite(args.position) || args.position < 0 || args.position >= video.duration) throw new ConvexError('Review the saved playlist video and starting position.')
  const available = lists.filter(list => !list.retired)
  if (available.length < 2) throw new ConvexError('Save playlists for at least two nonretired games in Catalogue before starting.')
  const eligibleGameIds = available.map(list => list.gameId).filter(id => id !== list.gameId)
  const blockers = await activationBlockers(ctx, eligibleGameIds)
  if (blockers.length) throw new ConvexError(blockers[0]!)
  const playbackRunId = await createRun(ctx, list, { deviceId: args.deviceId, roundId: round.sourceId,
    rotation: 1, videoIndex: args.videoIndex, position: args.position, paused: true, startedBy: actor.twitchId })
  await ctx.db.patch(round._id, { eligibleGameIds, rotation: 1 })
  await ctx.db.patch(state._id, { playbackRunId, rotation: 1, playedGameIds: [list.gameId] })
  return playbackRunId
} })

export const requestObservation = mutation({ args: { deviceId: v.id('playbackDevices') }, handler: async (ctx, args) => {
  await requireAdmin(ctx)
  const device = await ctx.db.get(args.deviceId)
  if (!device || device.revoked) throw new ConvexError('DEVICE_DENIED')
  const now = Date.now()
  // Visible Playback panels renew the shared lease. Joining very recently
  // renewed requests avoids duplicate writes from multiple admin tabs.
  if (observationActive(device.observation, now) && (device.observation.endsAt ?? device.observation.waitUntil) > now + 45_000) return device.observation
  const observation: Observation = observationActive(device.observation, now)
    ? { ...device.observation, waitUntil: now + OBSERVATION_LEASE,
      ...(device.observation.endsAt ? { endsAt: now + OBSERVATION_LEASE } : {}) }
    : { id: crypto.randomUUID(), requestedAt: now, waitUntil: now + OBSERVATION_LEASE }
  await ctx.db.patch(device._id, { observation })
  return observation
} })

export const retryPlayback = mutation({ args: {
  runId: v.id('playbackRuns'), revision: v.number(), deviceId: v.id('playbackDevices'),
}, handler: async (ctx, args) => {
  await requireAdmin(ctx)
  if (!Number.isSafeInteger(args.revision) || args.revision < 1) throw new ConvexError('PLAYBACK_CHANGED')
  const run = await activeRun(ctx)
  if (!run || run.status !== 'playing' || run._id !== args.runId || run.revision !== args.revision || run.deviceId !== args.deviceId) throw new ConvexError('PLAYBACK_CHANGED')
  const device = await ctx.db.get(args.deviceId)
  const now = Date.now()
  if (!device || device.revoked || !device.lastSeen || now - device.lastSeen >= DEVICE_CONTACT_WINDOW) throw new ConvexError('PLAYBACK_OFFLINE')
  if (device.retry?.status === 'pending' && device.retry.expiresAt > now && retryMatchesRun(device.retry, run, device._id)) return device.retry
  const retry: Retry = { id: crypto.randomUUID(), runId: run._id, revision: run.revision, videoIndex: run.videoIndex,
    videoId: run.video.videoId, expiresAt: now + RETRY_DURATION, status: 'pending' }
  await ctx.db.patch(device._id, { retry })
  return retry
} })

export const skipVideo = mutation({ args: {
  runId: v.id('playbackRuns'), revision: v.number(), deviceId: v.id('playbackDevices'),
}, handler: async (ctx, args) => {
  await requireAdmin(ctx)
  const run = await activeRun(ctx)
  if (!Number.isSafeInteger(args.revision) || !run || run.status !== 'playing' ||
    run._id !== args.runId || run.revision !== args.revision || run.deviceId !== args.deviceId) throw new ConvexError('PLAYBACK_CHANGED')
  if (run.videoIndex + 1 >= run.videoCount) throw new ConvexError('LAST_PLAYBACK_VIDEO')
  const device = await ctx.db.get(args.deviceId)
  const now = Date.now()
  if (!device || device.revoked || !device.lastSeen || now - device.lastSeen >= DEVICE_CONTACT_WINDOW) throw new ConvexError('PLAYBACK_OFFLINE')
  const report = device.report
  if (report?.run?.id !== run._id || report.run.revision !== run.revision ||
    report.run.videoIndex !== run.videoIndex || report.videoId !== run.video.videoId || report.controlling || report.completed) throw new ConvexError('PLAYBACK_PREPARING')
  const next = (await ctx.db.get(run.sequenceId))?.videos[run.videoIndex + 1]
  if (!next) throw new ConvexError('INVALID_PLAYBACK_SEQUENCE')
  // Existing extensions apply reload assignments even when the old video is paused.
  // A new revision fences stale reports and duplicate clicks without completing a round.
  await ctx.db.patch(run._id, { videoIndex: run.videoIndex + 1, video: next, position: 0,
    checkpointAt: now, revision: run.revision + 1, revisionReason: 'reload', paused: false })
} })

export const savePairing = internalMutation({ args: { codeHash: v.string(), name: v.string() }, handler: async (ctx, args) => {
  const admin = await requireAdmin(ctx)
  if (!args.name.trim() || args.name.length > 80) throw new ConvexError('Enter a device name of up to 80 characters.')
  // Only one outstanding invitation; issuing another invalidates the previous code.
  for (const previous of await ctx.db.query('playbackPairings').collect()) await ctx.db.delete(previous._id)
  const expiresAt = Date.now() + 10 * 60_000
  await ctx.db.insert('playbackPairings', { ...args, name: args.name.trim(), createdBy: admin.twitchId, expiresAt })
  return expiresAt
} })

export const createPairing = action({ args: { name: v.string() }, handler: async (ctx, args): Promise<{ code: string; expiresAt: number; endpoint: string }> => {
  await ctx.runQuery(internal.identity.authorizeAdmin, {})
  const endpoint = process.env.CONVEX_SITE_URL
  if (!endpoint) throw new ConvexError('The playback endpoint is not configured.')
  const code = crypto.randomUUID().replaceAll('-', '')
  const expiresAt: number = await ctx.runMutation(internal.playback.savePairing, { name: args.name, codeHash: await digest(code) })
  return { code, expiresAt, endpoint }
} })

export const pair = internalMutation({ args: { codeHash: v.string(), tokenHash: v.string() }, handler: async (ctx, args): Promise<{ id: Id<'playbackDevices'>; name: string }> => {
  requireReady()
  const invitation = await ctx.db.query('playbackPairings').withIndex('codeHash', q => q.eq('codeHash', args.codeHash)).unique()
  if (!invitation || invitation.expiresAt <= Date.now() || !(process.env.ADMIN_TWITCH_IDS ?? '').split(',').map(x => x.trim()).includes(invitation.createdBy)) {
    throw new ConvexError('PAIRING_DENIED')
  }
  if (invitation.consumedTokenHash) {
    if (invitation.consumedTokenHash !== args.tokenHash) throw new ConvexError('PAIRING_DENIED')
    const previous = await ctx.db.query('playbackDevices').withIndex('tokenHash', q => q.eq('tokenHash', args.tokenHash)).unique()
    if (!previous || previous.revoked) throw new ConvexError('PAIRING_DENIED')
    await assignPairedRun(ctx, previous._id)
    return { id: previous._id, name: previous.name }
  }
  for (const device of await ctx.db.query('playbackDevices').withIndex('revoked', q => q.eq('revoked', false)).collect()) {
    await ctx.db.patch(device._id, { revoked: true })
  }
  const id = await ctx.db.insert('playbackDevices', { name: invitation.name, tokenHash: args.tokenHash,
    createdBy: invitation.createdBy, createdAt: Date.now(), revoked: false, lastSeen: null })
  await ctx.db.patch(invitation._id, { consumedTokenHash: args.tokenHash })
  await assignPairedRun(ctx, id)
  return { id, name: invitation.name }
} })

export const revoke = mutation({ args: { deviceId: v.id('playbackDevices') }, handler: async (ctx, args) => {
  await requireAdmin(ctx)
  const device = await ctx.db.get(args.deviceId)
  if (device) await ctx.db.patch(device._id, { revoked: true })
} })

export const sync = internalMutation({ args: {
  tokenHash: v.string(), report: v.optional(reportFields), knownSequenceId: v.optional(v.string()), observationId: v.optional(v.string()),
  retryResult: v.optional(v.object({ id: v.string(), status: v.union(v.literal('applied'), v.literal('failed')), error: v.optional(v.string()) })),
}, handler: async (ctx, args) => {
  requireReady()
  if (!/^[a-f0-9]{64}$/.test(args.tokenHash) ||
    [args.knownSequenceId, args.observationId, args.retryResult?.id].some(value => value !== undefined && (!value.length || value.length > 100)) ||
    (args.retryResult?.error?.length ?? 0) > 300) throw new ConvexError('INVALID_REPORT')
  const device = await ctx.db.query('playbackDevices').withIndex('tokenHash', q => q.eq('tokenHash', args.tokenHash)).unique()
  if (!device || device.revoked) throw new ConvexError('DEVICE_DENIED')
  const report = args.report
  if (report && ((report.videoId !== null && !/^[\w-]{11}$/.test(report.videoId)) ||
    ![report.position, report.duration].every(value => Number.isFinite(value) && value >= 0) ||
    report.position > 7 * 86400 || report.duration > 7 * 86400 || report.notice.length > 300)) throw new ConvexError('INVALID_REPORT')
  if (report?.run && (!report.run.id.length || report.run.id.length > 100 || !Number.isSafeInteger(report.run.revision) || report.run.revision < 1 || !Number.isSafeInteger(report.run.videoIndex) || report.run.videoIndex < 0 || report.run.videoIndex > 999)) throw new ConvexError('INVALID_REPORT')
  const now = Date.now()
  await ctx.db.patch(device._id, { lastSeen: now, ...(report ? { report, reportAt: now } : {}) })
  // Also reconnect devices paired before automatic assignment was introduced.
  const pairedRun = await assignPairedRun(ctx, device._id, await activeRun(ctx))
  let retry = device.retry
  // Recovery may finish just before its deadline and acknowledge afterward.
  // Accept that receipt before timeout cleanup, but never deliver an expired request.
  if (retry?.status === 'pending' && args.retryResult?.id === retry.id && retryMatchesRun(retry, pairedRun, device._id)) {
    retry = { ...retry, status: args.retryResult.status, error: args.retryResult.status === 'failed' ? args.retryResult.error : undefined }
    await ctx.db.patch(device._id, { retry })
  }
  const run = report ? await acceptRunReport(ctx, device, report, pairedRun) : pairedRun
  if (retry?.status === 'pending' && (retry.expiresAt <= now || !retryMatchesRun(retry, run, device._id))) {
    retry = { ...retry, status: 'failed', error: retry.expiresAt <= now ? 'The browser did not confirm recovery before the request expired.' : 'Playback changed before the recovery request was applied.' }
    await ctx.db.patch(device._id, { retry })
  }
  let observation = observationActive(device.observation, now) ? device.observation : undefined
  if (observation && !observation.endsAt && report && args.observationId === observation.id) {
    // A report acknowledges the lease; it never extends it. If Admin closes,
    // even a late first response stops reporting at the last renewed deadline.
    observation = { ...observation, endsAt: observation.waitUntil }
    await ctx.db.patch(device._id, { observation })
  }
  const assignment = await runAssignment(ctx, device._id, run, args.knownSequenceId)
  return { assignment, observation: observation ? { id: observation.id, waitUntil: observation.waitUntil, endsAt: observation.endsAt ?? null } : null,
    retry: retry?.status === 'pending' ? { id: retry.id, runId: retry.runId, revision: retry.revision,
      videoIndex: retry.videoIndex, videoId: retry.videoId, expiresAt: retry.expiresAt } : null }
} })

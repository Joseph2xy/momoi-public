import { ConvexError } from 'convex/values'
import type { Doc, Id } from './_generated/dataModel'
import type { MutationCtx, QueryCtx } from './_generated/server'
import { completeRoundBallots, currentRound } from './voting'
import { isPreparedPlaylist } from './playlistAvailability'

export const playbackState = (ctx: QueryCtx) => ctx.db.query('appState').withIndex('key', q => q.eq('key', 'current')).unique()
export async function activeRun(ctx: QueryCtx) {
  const state = await playbackState(ctx)
  return state?.playbackRunId ? ctx.db.get(state.playbackRunId) : null
}

// Called only after pairing or authenticating the current, nonrevoked device.
// Reassignment keeps the checkpoint and fences reports from the former owner.
export async function assignPairedRun(ctx: MutationCtx, deviceId: Id<'playbackDevices'>, existingRun?: Doc<'playbackRuns'> | null) {
  const run = existingRun === undefined ? await activeRun(ctx) : existingRun
  if (!run || run.status !== 'playing' || run.deviceId === deviceId) return run
  await ctx.db.patch(run._id, { deviceId, revision: run.revision + 1, revisionReason: 'transfer', paused: true })
  return { ...run, deviceId, revision: run.revision + 1, revisionReason: 'transfer' as const, paused: true }
}
export async function preparedGames(ctx: QueryCtx) {
  const games = new Map((await ctx.db.query('games').collect()).map(game => [game.sourceId, game]))
  return (await ctx.db.query('playlists').collect()).filter(isPreparedPlaylist).filter(list => games.has(list.gameId))
    .map(list => ({ ...list, retired: games.get(list.gameId)!.retired }))
}
export async function activationBlockers(ctx: QueryCtx, eligibleIds: string[]) {
  const round = await currentRound(ctx)
  const eligible = new Set(eligibleIds)
  const ballots = await ctx.db.query('ballots').withIndex('round_user', q => q.eq('roundId', round.sourceId)).collect()
  const missing = new Set(ballots.flatMap(ballot => ballot.gameIds).filter(id => !eligible.has(id)))
  const messages: string[] = []
  for (const id of missing) {
    const game = await ctx.db.query('games').withIndex('sourceId', q => q.eq('sourceId', id)).unique()
    messages.push(`An existing ballot selects ${game?.name ?? id}. Save its playlist in Catalogue, and choose a different initial game; existing selections cannot be removed by activation.`)
  }
  return messages
}
export async function createRun(ctx: MutationCtx, list: Doc<'playlists'>, args: {
  deviceId: Id<'playbackDevices'>; roundId: string; rotation: number; videoIndex: number; position: number; paused: boolean; startedBy: string
}) {
  if (!isPreparedPlaylist(list)) throw new ConvexError('PLAYLIST_NOT_PREPARED')
  const sequence = await ctx.db.get(list.sequenceId)
  const video = sequence?.videos[args.videoIndex]
  if (!video) throw new ConvexError('INVALID_PLAYBACK_SEQUENCE')
  return ctx.db.insert('playbackRuns', { ...args, sequenceId: list.sequenceId, video, videoCount: sequence!.videos.length, playlistId: list.playlistId, gameId: list.gameId,
    title: list.title, revision: 1, revisionReason: 'transfer', status: 'playing', startedAt: Date.now(), checkpointAt: Date.now(), completedAt: null })
}

export async function runAssignment(ctx: QueryCtx, deviceId: Id<'playbackDevices'>, existingRun?: Doc<'playbackRuns'> | null, knownSequenceId?: string) {
  const run = existingRun === undefined ? await activeRun(ctx) : existingRun
  if (!run || run.deviceId !== deviceId || run.status !== 'playing') return null
  let videoIds: string[] | undefined
  if (knownSequenceId !== run.sequenceId) {
    const sequence = await ctx.db.get(run.sequenceId)
    if (!sequence) throw new ConvexError('INVALID_PLAYBACK_SEQUENCE')
    videoIds = sequence.videos.map(video => video.videoId)
  }
  const revisionReason = !run.revisionReason || run.revisionReason === 'pause' || run.revisionReason === 'resume' ? 'transfer' : run.revisionReason
  return { sequenceId: run.sequenceId, revisionReason, playlistId: run.playlistId, ...(videoIds ? { videoIds } : {}), runId: run._id, revision: run.revision, videoIndex: run.videoIndex,
    videoId: run.video.videoId, position: run.position, paused: run.paused }
}

// Playlist completion owns winner selection and rotation.
export async function acceptRunReport(ctx: MutationCtx, device: Doc<'playbackDevices'>,
  report: NonNullable<Doc<'playbackDevices'>['report']>, existingRun?: Doc<'playbackRuns'> | null) {
  const run = existingRun === undefined ? await activeRun(ctx) : existingRun
  if (!run || run.deviceId !== device._id || run.status !== 'playing' || !report.run ||
    report.run.id !== run._id || report.run.revision !== run.revision || report.controlling) return run
  const navigated = report.run.videoIndex !== run.videoIndex
  const sequence = navigated ? await ctx.db.get(run.sequenceId) : null
  const video = navigated ? sequence?.videos[report.run.videoIndex] : run.video
  if (!video || report.videoId !== video.videoId) return run
  // YouTube can trim a video after the sequence was prepared. The authenticated
  // controller's observed media duration governs its end; the snapshot still
  // fixes identity and order. Provider metadata is not an immutable media file.
  const duration = report.duration > 0 ? report.duration : video.duration
  if (report.position > duration + 5) throw new ConvexError('INVALID_PLAYBACK_POSITION')
  const position = Math.min(report.position, Math.max(0, duration - 0.5))
  const revision = run.revision + (navigated ? 1 : 0)
  const changed = navigated || position !== run.position || report.paused !== run.paused
  const changes = { position, paused: report.paused, video, videoIndex: report.run.videoIndex, revision,
    ...(changed ? { checkpointAt: Date.now() } : {}),
    ...(navigated ? { revisionReason: 'navigation' as const } : {}) }
  if (changed) await ctx.db.patch(run._id, changes)
  const updated = { ...run, ...changes }
  // Selecting an entry saves progress but never completes that entry.
  if (navigated || !report.completed ||
    report.duration <= 0 || report.position < report.duration - 2) return updated
  if (run.videoIndex + 1 < run.videoCount) {
    const next = (await ctx.db.get(run.sequenceId))?.videos[run.videoIndex + 1]
    if (!next) throw new ConvexError('INVALID_PLAYBACK_SEQUENCE')
    const advancement = { videoIndex: run.videoIndex + 1, video: next, position: 0, checkpointAt: Date.now(), revision: run.revision + 1, revisionReason: 'advance' as const, paused: false }
    await ctx.db.patch(run._id, advancement)
    return { ...updated, ...advancement }
  }
  return finishRun(ctx, run)
}

async function finishRun(ctx: MutationCtx, run: Doc<'playbackRuns'>) {
  const state = await playbackState(ctx)
  const round = await currentRound(ctx)
  if (!state || state.playbackRunId !== run._id || round.sourceId !== run.roundId || !round.eligibleGameIds?.length) {
    throw new ConvexError('PLAYBACK_ROUND_CHANGED')
  }
  const prepared = (await preparedGames(ctx)).filter(list => !list.retired)
  const byGame = new Map(prepared.map(list => [list.gameId, list]))
  // Missing candidates must be repaired, never silently substitute a lower winner.
  if (round.eligibleGameIds.some(id => !byGame.has(id))) throw new ConvexError('PLAYBACK_CANDIDATE_UNAVAILABLE')
  const ballots = await completeRoundBallots(ctx, round.sourceId)
  const counts = new Map(round.eligibleGameIds.map(id => [id, 0]))
  for (const ballot of ballots) for (const id of ballot.gameIds) {
    if (!counts.has(id)) throw new ConvexError('INVALID_PLAYBACK_BALLOT')
    counts.set(id, counts.get(id)! + 1)
  }
  const maximum = Math.max(...counts.values())
  const leaders = [...counts].filter(([, count]) => count === maximum).map(([id]) => id)
  // Convex supplies deterministic seeded randomness for mutation retries.
  const winnerGameId = leaders[Math.floor(Math.random() * leaders.length)]!
  let rotation = state.rotation ?? 1
  let played = [...new Set([...(state.playedGameIds ?? []), winnerGameId])]
  let eligibleGameIds = prepared.map(list => list.gameId).filter(id => !played.includes(id))
  if (!eligibleGameIds.length) {
    rotation++
    played = [winnerGameId]
    eligibleGameIds = prepared.map(list => list.gameId).filter(id => id !== winnerGameId)
  }
  if (!eligibleGameIds.length) throw new ConvexError('At least two eligible saved playlists are needed to continue the rotation.')
  const now = Date.now(); const nextRoundId = crypto.randomUUID()
  await ctx.db.patch(run._id, { status: 'completed', completedAt: now })
  await ctx.db.patch(round._id, { status: 'completed', winnerGameId, closedAt: now, closedBy: null })
  await ctx.db.insert('winnerChanges', { sourceId: crypto.randomUUID(), roundId: round.sourceId,
    previousGameId: null, nextGameId: winnerGameId, changedBy: 'playback', changedAt: now })
  await ctx.db.insert('rounds', { sourceId: nextRoundId, status: 'open', openedAt: now, openedBy: null,
    winnerGameId: null, closedAt: null, closedBy: null, eligibleGameIds, rotation })
  const nextRunId = await createRun(ctx, byGame.get(winnerGameId)!, { deviceId: run.deviceId, roundId: nextRoundId,
    rotation, videoIndex: 0, position: 0, paused: false, startedBy: 'playback' })
  await ctx.db.patch(state._id, { roundId: nextRoundId, playbackRunId: nextRunId, rotation, playedGameIds: played })
  return ctx.db.get(nextRunId)
}

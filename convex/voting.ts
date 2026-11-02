import { ADMIN_PAGE_SIZE } from '../src/shared/admin-pagination'
import { ConvexError, v } from 'convex/values'
import { query, mutation, type QueryCtx, type MutationCtx } from './_generated/server'
import { requireAdmin, requireIdentity } from './identity'
import { requireReady } from './operations'
import { hasPreparedPlaylist, preparedGameIds } from './playlistAvailability'

const id = v.string()
export async function currentRound(ctx: QueryCtx) {
  requireReady()
  const state = await ctx.db.query('appState').withIndex('key', q => q.eq('key', 'current')).unique()
  if (!state) throw new ConvexError('VOTING_NOT_INITIALIZED')
  const round = await ctx.db.query('rounds').withIndex('sourceId', q => q.eq('sourceId', state.roundId)).unique()
  if (!round || round.status !== 'open') throw new ConvexError('INVALID_ROUND_STATE')
  return round
}
async function expectedRound(ctx: QueryCtx, roundId: string) {
  const round = await currentRound(ctx)
  if (round.sourceId !== roundId) throw new ConvexError('ROUND_CHANGED')
  return round
}
const gameById = (ctx: QueryCtx, gameId: string) => ctx.db.query('games').withIndex('sourceId', q => q.eq('sourceId', gameId)).unique()
const ballotByUser = (ctx: QueryCtx, roundId: string, twitchId: string) => ctx.db.query('ballots').withIndex('round_user', q => q.eq('roundId', roundId).eq('twitchId', twitchId)).unique()

// Playlist completion freezes moderation state in its transaction.
// Later bans and exclusions must never change completed-round inclusion.
export async function completeRoundBallots(ctx: MutationCtx, roundId: string) {
  const ballots = await ctx.db.query('ballots').withIndex('round_user', q => q.eq('roundId', roundId)).collect()
  const included = []
  for (const ballot of ballots) {
    const user = await ctx.db.query('twitchProfiles').withIndex('twitchId', q => q.eq('twitchId', ballot.twitchId)).unique()
    if (!user) throw new ConvexError('INVALID_BALLOT_OWNER')
    const includedAtCompletion = !ballot.excluded && !user.banned
    await ctx.db.patch(ballot._id, { includedAtCompletion })
    if (includedAtCompletion) included.push(ballot)
  }
  return included
}

export const publicSnapshot = query({ args: {}, handler: async ctx => {
  const round = await currentRound(ctx)
  const [games, prepared] = await Promise.all([ctx.db.query('games').collect(), preparedGameIds(ctx)])
  const ballots = await ctx.db.query('ballots').withIndex('round_user', q => q.eq('roundId', round.sourceId)).collect()
  const counted = await Promise.all(ballots.filter(ballot => !ballot.excluded && ballot.gameIds.length).map(async ballot => {
    const user = await ctx.db.query('twitchProfiles').withIndex('twitchId', q => q.eq('twitchId', ballot.twitchId)).unique()
    return user?.banned ? null : ballot
  }))
  const counts = new Map<string, number>(); let voters = 0; let selections = 0
  for (const ballot of counted) if (ballot) {
    voters++; selections += ballot.gameIds.length
    for (const gameId of ballot.gameIds) counts.set(gameId, (counts.get(gameId) ?? 0) + 1)
  }
  return { round: { id: round.sourceId, openedAt: round.openedAt },
    games: games.filter(game => !game.retired && (!round.eligibleGameIds || round.eligibleGameIds.includes(game.sourceId))).map(game => ({ id: game.sourceId, name: game.name, coverUrl: game.coverUrl, available: prepared.has(game.sourceId),
      selectionCount: counts.get(game.sourceId) ?? 0, voteShare: selections ? (counts.get(game.sourceId) ?? 0) / selections * 100 : 0,
    })).sort((a, b) => b.selectionCount - a.selectionCount || a.name.localeCompare(b.name) || a.id.localeCompare(b.id)),
    totals: { voters, selections },
  }
} })

export const winnerHistory = query({ args: {}, handler: async ctx => {
  requireReady()
  const [completed, legacy] = await Promise.all([
    ctx.db.query('rounds').withIndex('status', q => q.eq('status', 'completed')).collect(),
    ctx.db.query('legacyWinners').collect(),
  ])
  const winnerGameIds = [...new Set(completed.map(round => round.winnerGameId))]
  const byId = new Map(await Promise.all(winnerGameIds.map(async gameId => {
    if (gameId === null) throw new ConvexError('INVALID_WINNER_STATE')
    const game = await gameById(ctx, gameId)
    if (!game) throw new ConvexError('INVALID_WINNER_STATE')
    return [game.sourceId, game] as const
  })))
  const winners = completed.sort((a, b) => b.closedAt! - a.closedAt!).map(item => {
    const game = byId.get(item.winnerGameId!)
    if (!game) throw new ConvexError('INVALID_WINNER_STATE')
    return { id: item.sourceId, roundId: item.sourceId, game: { id: game.sourceId, name: game.name, coverUrl: game.coverUrl } }
  })
  return [...winners, ...legacy.sort((a, b) => a.displayOrder - b.displayOrder).map(item => ({
    id: item.sourceId, roundId: null, game: { id: item.gameId, name: item.name, coverUrl: item.coverUrl },
  }))]
} })

export const ballot = query({ args: {}, handler: async ctx => {
  const actor = await requireIdentity(ctx)
  const round = await currentRound(ctx)
  const current = await ballotByUser(ctx, round.sourceId, actor.twitchId)
  const pending = await ctx.db.query('pendingChoices').withIndex('sessionId', q => q.eq('sessionId', actor.sessionId)).unique()
  return { roundId: round.sourceId, gameIds: current?.gameIds ?? [], revision: current?.revision ?? 0,
    pendingChoice: pending ? { gameId: pending.gameId, roundId: pending.roundId } : null }
} })

async function replace(ctx: MutationCtx, args: { roundId: string; expectedRevision: number; gameIds: string[] }, actor: Awaited<ReturnType<typeof requireIdentity>>) {
  const round = await expectedRound(ctx, args.roundId)
  if (!actor.ageEligible) throw new ConvexError('ACCOUNT_TOO_YOUNG')
  if (actor.banned) throw new ConvexError('VOTING_BANNED')
  if (!Number.isSafeInteger(args.expectedRevision) || args.expectedRevision < 0) throw new ConvexError('INVALID_REVISION')
  if (args.gameIds.length > 3 || new Set(args.gameIds).size !== args.gameIds.length) throw new ConvexError('INVALID_SELECTIONS')
  const existing = await ballotByUser(ctx, args.roundId, actor.twitchId)
  if ((existing?.revision ?? 0) !== args.expectedRevision) throw new ConvexError('REVISION_CONFLICT')
  for (const gameId of args.gameIds) {
    const game = await gameById(ctx, gameId)
    if (!game || game.retired || (round.eligibleGameIds && !round.eligibleGameIds.includes(gameId))) throw new ConvexError('GAME_UNAVAILABLE')
    // Keep existing choices editable when a game lacks a playlist. Once removed,
    // it cannot be selected again until a complete playlist has been saved.
    if (!existing?.gameIds.includes(gameId) && !await hasPreparedPlaylist(ctx, gameId)) throw new ConvexError('GAME_UNAVAILABLE')
  }
  const before = existing?.gameIds ?? []
  if (before.length === args.gameIds.length && before.every(gameId => args.gameIds.includes(gameId))) return { revision: args.expectedRevision }
  const now = Date.now(); const revision = args.expectedRevision + 1
  const sourceId = existing?.sourceId ?? crypto.randomUUID()
  if (existing) await ctx.db.patch(existing._id, { gameIds: args.gameIds, revision, updatedAt: now })
  else await ctx.db.insert('ballots', { sourceId, roundId: args.roundId, twitchId: actor.twitchId, gameIds: args.gameIds,
    revision, excluded: false, includedAtCompletion: null, createdAt: now, updatedAt: now })
  await ctx.db.insert('ballotChanges', { sourceId: crypto.randomUUID(), ballotId: sourceId, revision, source: 'voter', actorId: actor.twitchId,
    beforeGameIds: before, afterGameIds: args.gameIds, changedAt: now })
  return { revision }
}
export const replaceBallot = mutation({ args: { roundId: id, expectedRevision: v.number(), gameIds: v.array(id) },
  handler: async (ctx, args) => replace(ctx, args, await requireIdentity(ctx)) })

export const consumePending = mutation({ args: { roundId: id, expectedRevision: v.number() }, handler: async (ctx, args) => {
  const actor = await requireIdentity(ctx)
  const pending = await ctx.db.query('pendingChoices').withIndex('sessionId', q => q.eq('sessionId', actor.sessionId)).unique()
  if (!pending || pending.roundId !== args.roundId) throw new ConvexError('PENDING_CHOICE_CONFLICT')
  const ballot = await ballotByUser(ctx, args.roundId, actor.twitchId)
  const gameIds = [...new Set([...(ballot?.gameIds ?? []), pending.gameId])]
  const result = await replace(ctx, { ...args, gameIds }, actor)
  await ctx.db.delete(pending._id)
  return result
} })
export const dismissPending = mutation({ args: {}, handler: async ctx => {
  const actor = await requireIdentity(ctx)
  const pending = await ctx.db.query('pendingChoices').withIndex('sessionId', q => q.eq('sessionId', actor.sessionId)).unique()
  if (pending) await ctx.db.delete(pending._id)
} })

async function recordModeration(ctx: MutationCtx, kind: 'ban' | 'exclusion', targetId: string, active: boolean, actorId: string) {
  const records = await ctx.db.query('moderation').withIndex('kind_target', q => q.eq('kind', kind).eq('targetId', targetId)).collect()
  const previous = records.find(record => record.liftedAt === null)
  if (active && !previous) await ctx.db.insert('moderation', { sourceId: crypto.randomUUID(), kind, targetId,
    startedBy: actorId, startedAt: Date.now(), liftedBy: null, liftedAt: null })
  if (!active && previous) await ctx.db.patch(previous._id, { liftedBy: actorId, liftedAt: Date.now() })
}
export const setBan = mutation({ args: { twitchId: id, banned: v.boolean() }, handler: async (ctx, args) => {
  const actor = await requireAdmin(ctx)
  const user = await ctx.db.query('twitchProfiles').withIndex('twitchId', q => q.eq('twitchId', args.twitchId)).unique()
  if (!user) throw new ConvexError('USER_NOT_FOUND')
  await recordModeration(ctx, 'ban', args.twitchId, args.banned, actor.twitchId)
  await ctx.db.patch(user._id, { banned: args.banned })
} })
export const setExclusion = mutation({ args: { roundId: id, twitchId: id, excluded: v.boolean() }, handler: async (ctx, args) => {
  const actor = await requireAdmin(ctx)
  await expectedRound(ctx, args.roundId)
  const ballot = await ballotByUser(ctx, args.roundId, args.twitchId)
  if (!ballot) throw new ConvexError('BALLOT_NOT_FOUND')
  await recordModeration(ctx, 'exclusion', ballot.sourceId, args.excluded, actor.twitchId)
  await ctx.db.patch(ballot._id, { excluded: args.excluded })
} })

export const adminDirectory = query({ args: { search: v.optional(v.string()), scope: v.optional(v.union(v.literal('all'), v.literal('voted'), v.literal('excluded'), v.literal('banned'))), offset: v.optional(v.number()) }, handler: async (ctx, args) => {
  await requireAdmin(ctx)
  const offset = args.offset ?? 0
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 1000000 || (args.search?.length ?? 0) > 100) throw new ConvexError('INVALID_INPUT')
  const round = await currentRound(ctx)
  const ballots = await ctx.db.query('ballots').withIndex('round_user', q => q.eq('roundId', round.sourceId)).collect()
  const byUser = new Map(ballots.map(ballot => [ballot.twitchId, ballot]))
  const search = (args.search ?? '').toLowerCase(); const scope = args.scope ?? 'all'
  const users = (await ctx.db.query('twitchProfiles').collect()).filter(user => !search || [user.twitchId, user.login, user.displayName ?? ''].some(value => value.toLowerCase().includes(search)))
    .map(user => { const ballot = byUser.get(user.twitchId); return { id: user.twitchId, login: user.login, displayName: user.displayName ?? user.login, banned: user.banned ?? false,
      ballot: ballot ? { id: ballot.sourceId, gameIds: ballot.gameIds, excluded: ballot.excluded, included: !ballot.excluded && !user.banned } : null } })
    .filter(user => scope === 'all' || scope === 'banned' && user.banned || scope === 'voted' && !!user.ballot?.gameIds.length || scope === 'excluded' && user.ballot?.excluded)
    .sort((a, b) => a.login.localeCompare(b.login) || a.id.localeCompare(b.id))
  const pageUsers = users.slice(offset, offset + ADMIN_PAGE_SIZE)
  const gameIds = [...new Set(pageUsers.flatMap(user => user.ballot?.gameIds ?? []))]
  const games = (await Promise.all(gameIds.map(gameId => gameById(ctx, gameId))))
    .flatMap(game => game ? [{ id: game.sourceId, name: game.name, coverUrl: game.coverUrl, retired: game.retired }] : [])
  return { users: pageUsers, hasMoreUsers: users.length > offset + ADMIN_PAGE_SIZE, games,
    openRound: { id: round.sourceId } }
} })

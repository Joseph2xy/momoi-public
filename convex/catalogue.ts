import { ConvexError, v } from 'convex/values'
import { action, internalMutation, internalQuery, mutation, type QueryCtx, type MutationCtx } from './_generated/server'
import { internal } from './_generated/api'
import type { Doc } from './_generated/dataModel'
import { requireAdmin } from './identity'
import { lookupGames, type IgdbGame } from './igdb'
import { checkPlaylistId, preparePlaylist } from './youtube'
import { isPreparedPlaylist } from './playlistAvailability'
import { currentRound } from './voting'

const gameFields = {
  igdbId: v.number(), name: v.string(), slug: v.string(), coverUrl: v.union(v.string(), v.null()),
  year: v.union(v.number(), v.null()), platforms: v.array(v.string()), aliases: v.array(v.string()),
}
const playlistFields = {
  playlistId: v.string(), channelId: v.string(), title: v.string(), thumbnailUrl: v.union(v.string(), v.null()),
  videos: v.array(v.object({ videoId: v.string(), title: v.string(), duration: v.number() })),
}
type Existing = { id: string; retired: boolean }
export type SearchGame = Omit<IgdbGame, 'aliases'> & { existing: Existing | null }
const normalize = (value: string) => value.normalize('NFKD').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')

const removalArgs = { gameId: v.string(), expectedCreatedAt: v.number() }
async function removeUnusedEntry(ctx: MutationCtx, args: { gameId: string; expectedCreatedAt: number }) {
  await requireAdmin(ctx)
  const game = await ctx.db.query('games').withIndex('sourceId', q => q.eq('sourceId', args.gameId)).unique()
  if (!game) return 'absent'
  if (game.retired || game.createdAt !== args.expectedCreatedAt || !/^(igdb-|playlist-)/.test(game.sourceId)) throw new ConvexError('GAME_UNAVAILABLE')
  const mapping = await ctx.db.query('playlists').withIndex('gameId', q => q.eq('gameId', game.sourceId)).unique()
  // Unused-addition correction never removes votes or history.
  const [ballots, changes, rounds, runs, retirements, winners, legacy, pending, states] = await Promise.all([
    ctx.db.query('ballots').collect(), ctx.db.query('ballotChanges').collect(), ctx.db.query('rounds').collect(),
    ctx.db.query('playbackRuns').collect(), ctx.db.query('retirements').collect(), ctx.db.query('winnerChanges').collect(),
    ctx.db.query('legacyWinners').collect(), ctx.db.query('pendingChoices').collect(), ctx.db.query('appState').collect(),
  ])
  const id = game.sourceId
  if (ballots.some(b => b.gameIds.includes(id)) || changes.some(c => c.beforeGameIds.includes(id) || c.afterGameIds.includes(id)) ||
    rounds.some(r => r.winnerGameId === id || r.eligibleGameIds?.includes(id)) || runs.some(r => r.gameId === id) ||
    retirements.some(r => r.gameId === id) || winners.some(w => w.previousGameId === id || w.nextGameId === id) ||
    legacy.some(w => w.gameId === id) || pending.some(p => p.gameId === id) || states.some(s => s.playedGameIds?.includes(id))) {
    throw new ConvexError('GAME_IN_USE')
  }
  if (mapping) {
    const mappings = await ctx.db.query('playlists').collect()
    if (mapping.sequenceId && !runs.some(r => r.sequenceId === mapping.sequenceId) &&
      !mappings.some(m => m._id !== mapping._id && m.sequenceId === mapping.sequenceId)) await ctx.db.delete(mapping.sequenceId)
    await ctx.db.delete(mapping._id)
  }
  await ctx.db.delete(game._id)
  return 'deleted'
}

export const removeUnusedAddition = mutation({ args: removalArgs, handler: removeUnusedEntry })
export const removeUnlinked = mutation({ args: {
  entries: v.array(v.object(removalArgs)), expectedRoundId: v.string(), expectedVoteCount: v.number(), confirmVoteRemoval: v.literal(true),
}, handler: async (ctx, args) => {
  const admin = await requireAdmin(ctx)
  if (!args.entries.length || args.entries.length > 100 || new Set(args.entries.map(e => e.gameId)).size !== args.entries.length ||
    !Number.isSafeInteger(args.expectedVoteCount) || args.expectedVoteCount < 0) throw new ConvexError('INVALID_INPUT')
  const round = await currentRound(ctx)
  if (round.sourceId !== args.expectedRoundId) throw new ConvexError('ROUND_CHANGED')
  const ids = new Set(args.entries.map(e => e.gameId))
  const [games, ballots, rounds, runs, retirements, winners, legacy, pending, states, mappings] = await Promise.all([
    Promise.all(args.entries.map(e => ctx.db.query('games').withIndex('sourceId', q => q.eq('sourceId', e.gameId)).unique())),
    ctx.db.query('ballots').collect(), ctx.db.query('rounds').collect(), ctx.db.query('playbackRuns').collect(),
    ctx.db.query('retirements').collect(), ctx.db.query('winnerChanges').collect(), ctx.db.query('legacyWinners').collect(),
    ctx.db.query('pendingChoices').collect(), ctx.db.query('appState').collect(), ctx.db.query('playlists').collect(),
  ])
  for (let i = 0; i < games.length; i++) {
    const game = games[i]
    if (game && (game.retired || game.createdAt !== args.entries[i].expectedCreatedAt)) throw new ConvexError('GAME_UNAVAILABLE')
  }
  const selectedMappings = mappings.filter(m => ids.has(m.gameId))
  if (selectedMappings.some(isPreparedPlaylist)) throw new ConvexError('PLAYLIST_READY')
  // Current selections are explicitly authorized for removal. Completed-round,
  // playback and winner records still require their game identity.
  if (ballots.some(b => b.roundId !== round.sourceId && b.gameIds.some(id => ids.has(id))) ||
    rounds.some(r => ids.has(r.winnerGameId ?? '') || r.eligibleGameIds?.some(id => ids.has(id))) ||
    runs.some(r => ids.has(r.gameId)) || retirements.some(r => ids.has(r.gameId)) ||
    winners.some(w => ids.has(w.previousGameId ?? '') || ids.has(w.nextGameId)) || legacy.some(w => ids.has(w.gameId)) ||
    states.some(s => s.playedGameIds?.some(id => ids.has(id)))) throw new ConvexError('GAME_IN_USE')
  const affected = ballots.filter(b => b.gameIds.some(id => ids.has(id)))
  const removedVotes = affected.reduce((n, b) => n + b.gameIds.filter(id => ids.has(id)).length, 0)
  if (!games.some(Boolean) && !removedVotes) return { deleted: 0, removedVotes: 0, changedBallots: 0 }
  if (removedVotes !== args.expectedVoteCount) throw new ConvexError('VOTES_CHANGED')
  const now = Date.now()
  for (const ballot of affected) {
    const gameIds = ballot.gameIds.filter(id => !ids.has(id)); const revision = ballot.revision + 1
    await ctx.db.patch(ballot._id, { gameIds, revision, updatedAt: now })
    await ctx.db.insert('ballotChanges', { sourceId: crypto.randomUUID(), ballotId: ballot.sourceId, revision, source: 'game_removal',
      actorId: admin.twitchId, beforeGameIds: ballot.gameIds, afterGameIds: gameIds, changedAt: now })
  }
  for (const choice of pending) if (ids.has(choice.gameId)) await ctx.db.delete(choice._id)
  for (const mapping of selectedMappings) {
    if (mapping.sequenceId && !runs.some(r => r.sequenceId === mapping.sequenceId) &&
      !mappings.some(m => !ids.has(m.gameId) && m.sequenceId === mapping.sequenceId)) await ctx.db.delete(mapping.sequenceId)
    await ctx.db.delete(mapping._id)
  }
  for (const game of games) if (game) await ctx.db.delete(game._id)
  return { deleted: games.filter(Boolean).length, removedVotes, changedBallots: affected.length }
} })

function findExisting(games: Doc<'games'>[], winners: Doc<'legacyWinners'>[], candidate: IgdbGame): Existing | null {
  const exact = games.find(game => game.igdbId === candidate.igdbId || game.sourceId === `igdb-${candidate.igdbId}`)
  if (exact) return { id: exact.sourceId, retired: exact.retired }
  // Legacy records have no IGDB identity. Conservatively match their accepted
  // titles/slugs and provider aliases without rewriting or linking those records.
  const keys = new Set([candidate.name, candidate.slug, ...candidate.aliases].map(normalize))
  const legacy = games.find(game => !game.igdbId && game.kind !== 'playlist' && (keys.has(normalize(game.name)) || keys.has(normalize(game.slug))))
  if (legacy) return { id: legacy.sourceId, retired: legacy.retired }
  const winner = winners.find(game => keys.has(normalize(game.name)) || keys.has(normalize(game.slug)))
  return winner ? { id: winner.gameId, retired: true } : null
}

async function storedCatalogue(ctx: QueryCtx) {
  const [games, winners] = await Promise.all([ctx.db.query('games').collect(), ctx.db.query('legacyWinners').collect()])
  return { games, winners }
}

export const markExisting = internalQuery({ args: { games: v.array(v.object(gameFields)) }, handler: async (ctx, { games }): Promise<SearchGame[]> => {
  await requireAdmin(ctx)
  const stored = await storedCatalogue(ctx)
  return games.map(game => {
    const { aliases: _aliases, ...result } = game
    return { ...result, existing: findExisting(stored.games, stored.winners, game) }
  })
} })

export const insertGame = internalMutation({ args: { ...gameFields, playlist: v.object(playlistFields) }, handler: async (ctx, { playlist, ...game }): Promise<{ added: boolean; name: string; existing: Existing }> => {
  const admin = await requireAdmin(ctx)
  // The read and insert share one serializable transaction, including legacy
  // matches. Concurrent adds and retries cannot create duplicate records.
  const stored = await storedCatalogue(ctx)
  const existing = findExisting(stored.games, stored.winners, game)
  if (existing) return { added: false, name: game.name, existing }
  if (await ctx.db.query('playlists').withIndex('playlistId', q => q.eq('playlistId', playlist.playlistId)).unique()) throw new ConvexError('PLAYLIST_ALREADY_MAPPED')
  const now = Date.now()
  const sourceId = `igdb-${game.igdbId}`
  await ctx.db.insert('games', { sourceId, igdbId: game.igdbId, name: game.name, slug: game.slug,
    coverUrl: game.coverUrl, retired: false, createdAt: now, updatedAt: now })
  await insertMapping(ctx, sourceId, playlist, admin.twitchId, now)
  return { added: true, name: game.name, existing: { id: sourceId, retired: false } }
} })

export const search = action({ args: { query: v.string() }, handler: async (ctx, { query }): Promise<SearchGame[]> => {
  await ctx.runQuery(internal.identity.authorizeAdmin, {})
  const term = query.trim()
  if (term.length < 2 || term.length > 100 || /[\u0000-\u001f]/.test(term)) throw new ConvexError('INVALID_GAME_SEARCH')
  const escaped = term.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  const games = await lookupGames(`search "${escaped}"; limit 20;`)
  return ctx.runQuery(internal.catalogue.markExisting, { games })
} })

export const add = action({ args: { igdbId: v.number(), playlistId: v.string() }, handler: async (ctx, { igdbId, playlistId }): Promise<{ added: boolean; name: string; existing: Existing }> => {
  await ctx.runQuery(internal.identity.authorizeAdmin, {})
  if (!Number.isSafeInteger(igdbId) || igdbId <= 0) throw new ConvexError('INVALID_GAME_ID')
  checkPlaylistId(playlistId)
  // Only identifiers come from the browser; providers supply fresh metadata.
  // The final mutation repeats live session/admin checks and inserts atomically.
  const [games, playlist] = await Promise.all([
    lookupGames(`where id = ${igdbId}; limit 1;`), preparePlaylist(playlistId),
  ])
  const game = games.find(game => game.igdbId === igdbId)
  if (!game) throw new ConvexError('IGDB_GAME_NOT_FOUND')
  return ctx.runMutation(internal.catalogue.insertGame, { ...game, playlist })
} })

async function insertMapping(ctx: MutationCtx, gameId: string, playlist: {
  playlistId: string; channelId: string; title: string; thumbnailUrl: string | null;
  videos: { videoId: string; title: string; duration: number }[];
}, selectedBy: string, updatedAt: number) {
  const { videos, ...metadata } = playlist
  const sequenceId = await ctx.db.insert('playbackSequences', { videos })
  await ctx.db.insert('playlists', { ...metadata, gameId, sequenceId, videoCount: videos.length, updatedAt, selectedBy })
}

export const insertPlaylist = internalMutation({ args: playlistFields, handler: async (ctx, playlist): Promise<{ added: boolean; name: string; existing: Existing }> => {
  const admin = await requireAdmin(ctx)
  const existingMapping = await ctx.db.query('playlists').withIndex('playlistId', q => q.eq('playlistId', playlist.playlistId)).unique()
  if (existingMapping) {
    const game = await ctx.db.query('games').withIndex('sourceId', q => q.eq('sourceId', existingMapping.gameId)).unique()
    if (!game) throw new ConvexError('GAME_NOT_FOUND')
    return { added: false, name: game.name, existing: { id: game.sourceId, retired: game.retired } }
  }
  const sourceId = `playlist-${playlist.playlistId}`
  if (await ctx.db.query('games').withIndex('sourceId', q => q.eq('sourceId', sourceId)).unique()) throw new ConvexError('PLAYLIST_ALREADY_ADDED')
  const now = Date.now()
  await ctx.db.insert('games', { sourceId, kind: 'playlist', name: playlist.title, slug: sourceId.toLowerCase(),
    coverUrl: playlist.thumbnailUrl, retired: false, createdAt: now, updatedAt: now })
  await insertMapping(ctx, sourceId, playlist, admin.twitchId, now)
  return { added: true, name: playlist.title, existing: { id: sourceId, retired: false } }
} })

export const addPlaylist = action({ args: { playlistId: v.string() }, handler: async (ctx, { playlistId }): Promise<{ added: boolean; name: string; existing: Existing }> => {
  await ctx.runQuery(internal.identity.authorizeAdmin, {})
  checkPlaylistId(playlistId)
  const playlist = await preparePlaylist(playlistId)
  return ctx.runMutation(internal.catalogue.insertPlaylist, playlist)
} })

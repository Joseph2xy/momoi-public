import { ConvexError, v, type Infer } from 'convex/values'
import { action, internalMutation, internalQuery, query, type QueryCtx } from './_generated/server'
import { internal } from './_generated/api'
import { requireAdmin } from './identity'
import { preparePlaylist } from './youtube'
import { isPreparedPlaylist } from './playlistAvailability'
import { playlistIdFromInput } from '../src/shared/playlist-id'

const mappingVersion = v.union(v.object({
  id: v.id('playlists'), sequenceId: v.union(v.id('playbackSequences'), v.null()),
}), v.null())
const saveArgs = { gameId: v.string(), playlistId: v.string(), expectedMapping: mappingVersion }

function mappingPlaylistId(value: string) {
  const id = playlistIdFromInput(value)
  if (!id) throw new ConvexError('INVALID_PLAYLIST_ID')
  return id
}

export const mappings = query({ args: {}, handler: async ctx => {
  await requireAdmin(ctx)
  const [lists, games] = await Promise.all([ctx.db.query('playlists').collect(), ctx.db.query('games').collect()])
  const byGame = new Map(lists.map(list => [list.gameId, list]))
  return {
    games: games.map(game => {
      const list = byGame.get(game.sourceId)
      return { id: game.sourceId, name: game.name, coverUrl: game.coverUrl, retired: game.retired,
        mapping: list ? { id: list._id, sequenceId: list.sequenceId ?? null, playlistId: list.playlistId,
          title: list.title, prepared: isPreparedPlaylist(list) } : null,
      }
    }).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)),
    youtubeConfigured: !!process.env.YOUTUBE_API_KEY,
  }
} })

async function saveTarget(ctx: QueryCtx, args: { gameId: string; playlistId: string; expectedMapping: Infer<typeof mappingVersion> }) {
  if (!args.gameId || args.gameId.length > 200) throw new ConvexError('GAME_NOT_FOUND')
  const game = await ctx.db.query('games').withIndex('sourceId', q => q.eq('sourceId', args.gameId)).unique()
  if (!game) throw new ConvexError('GAME_NOT_FOUND')
  const existing = await ctx.db.query('playlists').withIndex('gameId', q => q.eq('gameId', args.gameId)).unique()
  if ((existing?._id ?? null) !== (args.expectedMapping?.id ?? null) ||
    (existing?.sequenceId ?? null) !== (args.expectedMapping?.sequenceId ?? null)) throw new ConvexError('MAPPING_CHANGED')
  const other = await ctx.db.query('playlists').withIndex('playlistId', q => q.eq('playlistId', args.playlistId)).unique()
  if (other && other.gameId !== args.gameId) throw new ConvexError('PLAYLIST_ALREADY_MAPPED')
  return existing
}

export const checkSave = internalQuery({ args: saveArgs, handler: async (ctx, args) => {
  await requireAdmin(ctx)
  await saveTarget(ctx, args)
} })

export const savePrepared = internalMutation({ args: {
  ...saveArgs, channelId: v.string(), title: v.string(), thumbnailUrl: v.union(v.string(), v.null()),
  videos: v.array(v.object({ videoId: v.string(), title: v.string(), duration: v.number() })),
}, handler: async (ctx, { expectedMapping, gameId, videos, ...metadata }) => {
  const admin = await requireAdmin(ctx)
  const existing = await saveTarget(ctx, { gameId, playlistId: metadata.playlistId, expectedMapping })
  // Preparation succeeds before this atomic replacement. Every save creates a
  // new immutable sequence; existing runs keep their sequence and checkpoint.
  // Never rewrite game identity, metadata, ballots, retirements or past records.
  const sequenceId = await ctx.db.insert('playbackSequences', { videos })
  const record = { ...metadata, gameId, sequenceId, videoCount: videos.length, updatedAt: Date.now(), selectedBy: admin.twitchId }
  if (existing) await ctx.db.patch(existing._id, record)
  else await ctx.db.insert('playlists', record)
} })

export const save = action({ args: saveArgs, handler: async (ctx, args): Promise<void> => {
  const target = { ...args, playlistId: mappingPlaylistId(args.playlistId) }
  await ctx.runQuery(internal.playlists.checkSave, target)
  const playlist = await preparePlaylist(target.playlistId)
  // Authority, mapping version and uniqueness are checked again after provider
  // I/O, so neither a failed preparation nor a stale editor can replace a link.
  await ctx.runMutation(internal.playlists.savePrepared, { ...target, ...playlist })
} })

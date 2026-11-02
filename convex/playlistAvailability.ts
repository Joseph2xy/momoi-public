import type { Doc, Id } from './_generated/dataModel'
import type { QueryCtx } from './_generated/server'

type PreparedMapping = Doc<'playlists'> & { channelId: string; sequenceId: Id<'playbackSequences'>; videoCount: number }

export function isPreparedPlaylist(list: Doc<'playlists'>): list is PreparedMapping {
  return typeof list.channelId === 'string' && /^UC[\w-]{22}$/.test(list.channelId) &&
    !!list.sequenceId && typeof list.videoCount === 'number' && Number.isSafeInteger(list.videoCount) && list.videoCount > 0 && list.videoCount <= 1000
}

export async function preparedGameIds(ctx: QueryCtx) {
  return new Set((await ctx.db.query('playlists').collect()).filter(isPreparedPlaylist).map(list => list.gameId))
}

export async function hasPreparedPlaylist(ctx: QueryCtx, gameId: string) {
  const list = await ctx.db.query('playlists').withIndex('gameId', q => q.eq('gameId', gameId)).unique()
  return !!list && isPreparedPlaylist(list)
}

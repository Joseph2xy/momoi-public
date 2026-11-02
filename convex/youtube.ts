import { ConvexError } from 'convex/values'

type PlaylistVideo = { videoId: string; title: string; duration: number }
type YoutubePlaylist = {
  playlistId: string; channelId: string; title: string; thumbnailUrl: string | null; itemCount: number
}
type PreparedPlaylist = Omit<YoutubePlaylist, 'itemCount'> & { videos: PlaylistVideo[] }
const MAX_VIDEOS = 1000
type JsonObject = Record<string, unknown>
const object = (value: unknown): JsonObject => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {}
const invalid = () => new ConvexError('YOUTUBE_UNAVAILABLE')

export function checkPlaylistId(value: string) {
  if (!/^[A-Za-z0-9_-]{10,100}$/.test(value)) throw new ConvexError('INVALID_PLAYLIST_ID')
}

function text(value: unknown, limit: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > limit) throw invalid()
  return value.trim()
}

function pageToken(value: unknown): string | null {
  if (value === undefined) return null
  if (typeof value !== 'string' || !value || value.length > 1024 || /[\u0000-\u001f]/.test(value)) throw new ConvexError('INVALID_PLAYLIST_PAGE')
  return value
}

function client() {
  const key = process.env.YOUTUBE_API_KEY
  if (!key) throw new ConvexError('YOUTUBE_NOT_CONFIGURED')
  // A bounded preparation must finish within the Convex action time limit.
  const signal = AbortSignal.timeout(45000)
  return async (resource: string, params: Record<string, string>) => {
    try {
      const url = new URL(`https://www.googleapis.com/youtube/v3/${resource}`)
      url.search = new URLSearchParams({ ...params, key }).toString()
      const response = await fetch(url, { redirect: 'error', signal })
      if (response.status === 429) throw new ConvexError('YOUTUBE_RATE_LIMITED')
      if (!response.ok) throw invalid()
      const body = object(await response.json())
      if (!Array.isArray(body.items)) throw invalid()
      return { items: body.items.map(object), nextPageToken: pageToken(body.nextPageToken) }
    } catch (error) {
      // Never expose API keys, request URLs, or upstream response bodies.
      if (error instanceof ConvexError) throw error
      throw invalid()
    }
  }
}
type YoutubeClient = ReturnType<typeof client>

async function channelId(request: YoutubeClient) {
  const result = await request('channels', { part: 'id', forHandle: 'LacariVOD', fields: 'items(id)' })
  if (result.items.length !== 1) throw new ConvexError('YOUTUBE_CHANNEL_UNAVAILABLE')
  const id = text(result.items[0].id, 30)
  if (!/^UC[A-Za-z0-9_-]{22}$/.test(id)) throw invalid()
  return id
}

function playlist(value: JsonObject, expectedChannelId: string): YoutubePlaylist {
  const snippet = object(value.snippet)
  if (snippet.channelId !== expectedChannelId) throw new ConvexError('PLAYLIST_WRONG_CHANNEL')
  const playlistId = text(value.id, 100)
  checkPlaylistId(playlistId)
  const itemCount = object(value.contentDetails).itemCount
  if (typeof itemCount !== 'number' || !Number.isSafeInteger(itemCount) || itemCount < 0) throw invalid()
  const thumbnails = object(snippet.thumbnails)
  const thumbnail = object(thumbnails.high ?? thumbnails.medium ?? thumbnails.default).url
  // Provider image URLs are only used for display, never fetched by the backend.
  const thumbnailUrl = typeof thumbnail === 'string' && thumbnail.length <= 2048 && /^https:\/\/(?:i\.ytimg\.com|yt3\.ggpht\.com)\//.test(thumbnail) ? thumbnail : null
  return { playlistId, channelId: expectedChannelId, title: text(snippet.title, 200), thumbnailUrl, itemCount }
}

const playlistParts = {
  part: 'snippet,contentDetails',
  fields: 'items(id,snippet(channelId,title,thumbnails),contentDetails(itemCount))',
}

function duration(value: unknown) {
  // YouTube uses ISO 8601 durations; longer recordings may include days.
  const match = typeof value === 'string' ? /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(value) : null
  if (!match) throw new ConvexError('PLAYLIST_VIDEO_UNAVAILABLE')
  const seconds = Number(match[1] ?? 0) * 86400 + Number(match[2] ?? 0) * 3600 + Number(match[3] ?? 0) * 60 + Number(match[4] ?? 0)
  if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 7 * 86400) throw new ConvexError('PLAYLIST_VIDEO_UNAVAILABLE')
  return seconds
}

export async function preparePlaylist(playlistId: string): Promise<PreparedPlaylist> {
  checkPlaylistId(playlistId)
  const request = client()
  const id = await channelId(request)
  const result = await request('playlists', { ...playlistParts, id: playlistId })
  if (result.items.length !== 1 || result.items[0].id !== playlistId) throw new ConvexError('PLAYLIST_NOT_FOUND')
  const summary = playlist(result.items[0], id)
  if (!summary.itemCount) throw new ConvexError('PLAYLIST_EMPTY')
  if (summary.itemCount > MAX_VIDEOS) throw new ConvexError('PLAYLIST_TOO_LARGE')

  const ordered: string[] = []
  let nextPageToken: string | null = null
  const seen = new Set<string>()
  do {
    const page = await request('playlistItems', {
      part: 'snippet,contentDetails', playlistId, maxResults: '50',
      fields: 'nextPageToken,items(snippet(position),contentDetails(videoId))',
      ...(nextPageToken ? { pageToken: nextPageToken } : {}),
    })
    for (const item of page.items) {
      const videoId = object(item.contentDetails).videoId
      if (typeof videoId !== 'string' || !/^[A-Za-z0-9_-]{11}$/.test(videoId)) throw new ConvexError('PLAYLIST_VIDEO_UNAVAILABLE')
      if (object(item.snippet).position !== ordered.length) throw new ConvexError('PLAYLIST_CHANGED')
      ordered.push(videoId)
    }
    nextPageToken = page.nextPageToken
    if (ordered.length > MAX_VIDEOS || (nextPageToken && seen.size >= 19)) throw new ConvexError('PLAYLIST_TOO_LARGE')
    if (nextPageToken && (seen.has(nextPageToken) || !page.items.length)) throw new ConvexError('PLAYLIST_CHANGED')
    if (nextPageToken) seen.add(nextPageToken)
  } while (nextPageToken)
  if (ordered.length !== summary.itemCount) throw new ConvexError('PLAYLIST_CHANGED')

  const uniqueIds = [...new Set(ordered)]
  const metadata = new Map<string, PlaylistVideo>()
  for (let offset = 0; offset < uniqueIds.length; offset += 50) {
    const ids = uniqueIds.slice(offset, offset + 50)
    const videos = await request('videos', {
      part: 'snippet,contentDetails,status', id: ids.join(','),
      fields: 'items(id,snippet(title,liveBroadcastContent),contentDetails(duration),status(privacyStatus,uploadStatus))',
    })
    for (const item of videos.items) {
      const videoId = text(item.id, 11)
      const snippet = object(item.snippet)
      const status = object(item.status)
      if (!ids.includes(videoId) || status.privacyStatus === 'private' || status.uploadStatus !== 'processed' || snippet.liveBroadcastContent !== 'none') throw new ConvexError('PLAYLIST_VIDEO_UNAVAILABLE')
      metadata.set(videoId, { videoId, title: text(snippet.title, 200), duration: duration(object(item.contentDetails).duration) })
    }
  }
  const videos = ordered.map(videoId => {
    const video = metadata.get(videoId)
    if (!video) throw new ConvexError('PLAYLIST_VIDEO_UNAVAILABLE')
    return video
  })
  const prepared = { playlistId: summary.playlistId, channelId: summary.channelId,
    title: summary.title, thumbnailUrl: summary.thumbnailUrl, videos }
  // Keep headroom beneath Convex's document/argument limit; never truncate a run.
  if (new TextEncoder().encode(JSON.stringify(prepared)).length > 700000) throw new ConvexError('PLAYLIST_TOO_LARGE')
  return prepared
}

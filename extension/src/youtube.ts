export interface PlaybackSnapshot {
  controllerTag: string | null
  videoId: string | null
  playlistId: string | null
  videoIndex: number
  currentTime: number
  duration: number
  paused: boolean
  seeking: boolean
  ended: boolean
  ready: boolean
  error: string | null
  title: string
  applied?: string
  checkpoint?: number
}
export interface PlaybackControl { id: string; videoId: string; playlistId: string; videoIndex: number; position: number; play: boolean }
export interface HeartbeatResponse { managed: boolean; hold?: boolean; allowAd?: boolean; control?: PlaybackControl }
// YouTube's own watch navigation retains the document, player and fullscreen.
// Executed in MAIN world with public playlist identity only.
export function advancePlayer(videoId: string, playlistId: string, videoIndex: number): boolean {
  const app = document.querySelector('ytd-app') as (HTMLElement & { onYtNavigate?: unknown }) | null
  if (!app || typeof app.onYtNavigate !== 'function') return false
  const url = new URL('/watch', location.origin)
  url.searchParams.set('v', videoId)
  url.searchParams.set('list', playlistId)
  url.searchParams.set('index', String(videoIndex + 1))
  app.dispatchEvent(new CustomEvent('yt-navigate', { bubbles: true, composed: true, detail: {
    endpoint: {
      commandMetadata: { webCommandMetadata: { url: url.pathname + url.search, webPageType: 'WEB_PAGE_TYPE_WATCH', rootVe: 3832 } },
      watchEndpoint: { videoId, playlistId, index: videoIndex },
    },
  } }))
  return true
}
// Executed in MAIN world; only returns untrusted player identity, never secrets.
export function inspectPlayer(): { videoId: string; videoIndex: number | null } | null {
  const player = document.getElementById('movie_player') as (HTMLElement & {
    getVideoData?: () => { video_id?: unknown }
    getPlaylistIndex?: () => unknown
  }) | null
  try {
    const id = player?.getVideoData?.()?.video_id
    if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{11}$/.test(id)) return null
    const index = player?.getPlaylistIndex?.()
    return { videoId: id, videoIndex: typeof index === 'number' && Number.isSafeInteger(index) && index >= 0 && index < 1000 ? index : null }
  } catch { return null }
}

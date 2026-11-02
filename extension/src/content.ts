import type { HeartbeatResponse, PlaybackControl, PlaybackSnapshot } from './youtube'
const MARKER = 'momoi.playback.owner'
let tag: string | null = new URLSearchParams(location.hash.slice(1)).get('momoi')
try { tag ??= sessionStorage.getItem(MARKER) } catch { /* URL marker still works. */ }
if (!tag || !/^[a-f0-9-]{36}$/i.test(tag)) tag = null
if (tag) { try { sessionStorage.setItem(MARKER, tag) } catch { /* Optional persistence. */ } }
let managed = Boolean(tag)
let hold = managed // Restored pages wait for the worker to restore their checkpoint.
let video: HTMLVideoElement | null = null
let command: PlaybackControl | undefined
let applied: string | undefined
let started: string | undefined
let allowAd = false
let sending = false
let pendingHeartbeat = false
let checkpoint = 0
let finished: PlaybackSnapshot | null = null
let lastReply = 0
let error: string | null = null
let playbackError: string | null = null
let navigationResume = false
let navigationEpoch = 0
let navigating = false
let metadataReady = false
let previousVideoId: string | null = null
function ad() { return document.getElementById('movie_player')?.classList.contains('ad-showing') ?? false }
function readPlaybackError() {
  return video?.error ? 'YouTube cannot play this video. Resolve the problem, then choose Retry playback in the extension.'
    : document.querySelector('.ytp-error')?.textContent?.trim().slice(0, 200) || null
}
function pause() { if (managed && video && !video.paused) video.pause() }
function play(key: string, message: string) {
  if (!video || started === key) return
  const target = video
  const epoch = navigationEpoch
  started = key
  void target.play().catch((reason: unknown) => {
    // Native Pause can cancel a pending Play before buffering completes.
    // Cancellation is an ordinary pause, not a failed video or a Retry loop.
    if (target.paused && reason instanceof DOMException && reason.name === 'AbortError') return
    // A rejected Play from the old video must not stop its successor, even
    // when YouTube reuses the same video element during navigation.
    if (managed && video === target && navigationEpoch === epoch && started === key) error = message
  })
}
chrome.runtime.onMessage.addListener((message: unknown, sender, respond) => {
  const data = message as { type?: unknown; tag?: unknown } | null
  if (sender.id !== chrome.runtime.id || sender.tab || !managed || data?.type !== 'prepare-advance' || data.tag !== tag) return false
  // The worker has the server-confirmed successor. Its control will restore
  // that entry; the old ending must no longer be reported after navigation.
  finished = null
  command = undefined
  applied = undefined
  navigationEpoch += 1
  allowAd = false
  hold = true
  error = null
  navigationResume = false
  pause()
  respond(true)
  return false
})
function bind() {
  const next = document.querySelector<HTMLVideoElement>('#movie_player video')
  if (next === video) return
  video = next
  metadataReady = Boolean(next && next.readyState >= 1 && !navigating)
}
function snapshot(): PlaybackSnapshot {
  const url = new URL(location.href)
  const id = url.searchParams.get('v')
  const advertising = ad()
  const ready = Boolean(!navigating && metadataReady && video && video.readyState >= 2 && !advertising && Number.isFinite(video.duration))
  const index = Number(url.searchParams.get('index'))
  return {
    controllerTag: tag, videoId: id && /^[\w-]{11}$/.test(id) ? id : null,
    playlistId: url.searchParams.get('list'), videoIndex: Number.isSafeInteger(index) && index > 0 && index <= 1000 ? index - 1 : -1,
    currentTime: ready ? video!.currentTime : 0, duration: ready ? video!.duration : 0,
    paused: video?.paused ?? true,
    seeking: video?.seeking ?? false, ended: ready && Boolean(video?.ended), ready, checkpoint,
    error: playbackError || error || (navigating || advertising ? null : readPlaybackError()),
    title: document.title.slice(0, 200), ...(applied ? { applied } : {}),
  }
}
function guard() {
  bind()
  if (!navigating && !ad()) playbackError ??= readPlaybackError()
  // A requested start must let pre-roll finish before its checkpoint can be
  // restored. Paused recovery and loss of worker authority still pause ads.
  const preparingAd = ad() && allowAd
  if (managed && (playbackError || (hold && !preparingAd) || finished || performance.now() - lastReply > 10_000)) pause()
}
function apply(control: PlaybackControl) {
  const state = snapshot()
  if (!video || playbackError || navigating || performance.now() - lastReply > 10_000 || control.id === applied || state.videoId !== control.videoId
    || state.playlistId !== control.playlistId) return
  if (ad()) {
    // Release the initial pause once per Start command. Later heartbeats must
    // respect a native Pause instead of repeatedly forcing the ad to play.
    if (control.play) play('ad:' + control.id, 'YouTube could not start. Press Play on YouTube or choose Retry playback in the extension.')
    return
  }
  if (!metadataReady) return
  if (video.readyState < 1 || !Number.isFinite(video.duration)) return
  const target = video
  try {
    // A checkpoint at the ending can trigger YouTube autoplay during the seek,
    // before restoration is acknowledged. Replay a short tail on recovery;
    // only the subsequent real ending may complete the playlist.
    const position = control.position >= target.duration - 2
      ? Math.max(0, target.duration - 5)
      : Math.min(control.position, target.duration)
    if (Math.abs(target.currentTime - position) > 0.75) {
      pause()
      target.currentTime = position
    }
    // currentTime confirms the requested destination, not buffered media.
    // Some YouTube players cannot finish a paused seek until Play starts
    // loading it. Release the hold here; the worker still rejects progress
    // while seeking, and Retry requires ready, playing, non-seeking media.
    applied = control.id
    finished = null
    error = null
    hold = false
    navigationResume = false
    if (control.play) play('video:' + control.id, 'YouTube could not start. Press Play on YouTube or choose Retry playback in the extension.')
    else pause()
  } catch { error = 'YouTube could not start. Press Play on YouTube or choose Retry playback in the extension.' }
}
async function heartbeat() {
  // The report heartbeat also checks worker liveness. Media events enforce
  // holds immediately, so there is no separate timer repeatedly pausing media.
  guard()
  if (!managed) return
  if (sending) { pendingHeartbeat = true; return }
  sending = true
  const epoch = navigationEpoch
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    const response = await Promise.race<HeartbeatResponse>([
      chrome.runtime.sendMessage({ type: 'heartbeat', snapshot: finished ?? snapshot() }),
      new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error('Playback worker timed out')), 5_000) }),
    ])
    if (epoch !== navigationEpoch) return
    lastReply = performance.now()
    if (!response.managed) {
      pause()
      managed = false
      try { sessionStorage.removeItem(MARKER) } catch { /* Storage may be unavailable. */ }
      return
    }
    hold = response.hold === true
    allowAd = response.allowAd === true
    command = response.control
    if (command) apply(command)
    else if (allowAd && ad() && navigationResume && !finished && !playbackError && video) {
      play('navigation-ad:' + navigationEpoch, 'Click Play on YouTube to continue.')
    }
    else if (!hold && navigationResume && !finished && snapshot().ready && video) {
      navigationResume = false
      play('navigation-video:' + navigationEpoch, 'Click Play on YouTube to continue.')
    }
    guard()
  } catch { guard() } finally {
    clearTimeout(timeout)
    sending = false
    if (pendingHeartbeat) { pendingHeartbeat = false; void heartbeat() }
  }
}
// Capture ending before YouTube's playlist listener can advance. Advancement is
// released only by a new server assignment, including after an offline ending.
window.addEventListener('ended', event => {
  bind()
  if (!managed || event.target !== video || ad() || hold || playbackError || !snapshot().ready) return
  event.stopImmediatePropagation()
  checkpoint += 1
  finished = snapshot()
  hold = true
  pause()
  void heartbeat()
}, true)
for (const name of ['play', 'playing', 'pause', 'seeked', 'error', 'loadedmetadata', 'loadeddata', 'emptied']) document.addEventListener(name, event => {
  bind()
  if (!managed || event.target !== video) return
  if (name === 'error' && !ad()) playbackError ??= readPlaybackError()
  if (name === 'loadedmetadata' || name === 'loadeddata') metadataReady = true
  if (name === 'emptied') metadataReady = false
  if (name === 'pause' || name === 'seeked') checkpoint += 1
  if (name === 'play' && video && !video.paused && error) {
    // An autoplay rejection is recoverable through YouTube's native Play button.
    error = null
    if (!finished && (!command || command.id === applied)) hold = false
  }
  if (command && (name === 'loadedmetadata' || name === 'loadeddata')) apply(command)
  guard()
  void heartbeat()
}, true)
document.addEventListener('yt-navigate-start', () => {
  if (!managed) return
  // YouTube can skip an unavailable entry itself; retain its failure rather
  // than accepting the replacement as an ordinary playlist selection.
  if (!ad()) playbackError ??= readPlaybackError()
  previousVideoId = new URL(location.href).searchParams.get('v')
  navigationEpoch += 1
  allowAd = false
  navigating = true
  metadataReady = false
  // An ending stays latched even if YouTube attempts SPA auto-navigation.
  if (!finished) { navigationResume = true; hold = true; command = undefined; applied = undefined; error = null }
  pause()
})
document.addEventListener('yt-navigate-finish', () => {
  navigating = false
  // Opening the same video in another playlist position can retain its media.
  if (previousVideoId === new URL(location.href).searchParams.get('v') && video?.readyState) metadataReady = true
  void heartbeat()
})
setInterval(() => { void heartbeat() }, 1_000)
void heartbeat()

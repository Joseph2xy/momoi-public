import { useEffect, useRef, useState } from 'react'
import { useConvex } from 'convex/react'
import { ConvexError } from 'convex/values'
import { RotateCw, SkipForward } from 'lucide-react'
import type { FunctionArgs, FunctionReturnType } from 'convex/server'
import { api } from '../../convex/_generated/api'
import { useAppState } from '../client/app-state'
import { useLiveQuery } from '../client/live-query'
import { useViewState } from '../client/view-state'
import { Notice } from './feedback'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { NativeSelect, NativeSelectOption } from './ui/native-select'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog'
import '../playback.css'

type Props = { disabled: boolean; active: boolean }
type Pairing = FunctionReturnType<typeof api.playback.createPairing>
type DeviceId = FunctionArgs<typeof api.playback.revoke>['deviceId']
type StartRun = FunctionArgs<typeof api.playback.startRun>
type PlaybackStatus = FunctionReturnType<typeof api.playback.status>
const AUTH_ERRORS = new Set(['UNAUTHENTICATED', 'FORBIDDEN', 'REAUTHENTICATION_REQUIRED'])
const PLAYBACK_ERRORS = new Set([
  'Enter a device name of up to 80 characters.', 'The playback endpoint is not configured.',
  'A playlist is already selected. Open the extension to resume it.',
  'Review the saved playlist video and starting position.',
  'Save playlists for at least two nonretired games in Catalogue before starting.',
])
function errorCode(error: unknown) { return error instanceof ConvexError ? String(error.data) : '' }
function failure(error: unknown) {
  const code = errorCode(error)
  if (code === 'Connect the streaming device before preparing the first playlist.') return 'Open the connected browser and its Momoi extension, then try again.'
  if (PLAYBACK_ERRORS.has(code)) return code.replace('Catalogue', 'Games & playlists')
  if (code.startsWith('An existing ballot selects ')) return code.slice(0, 600)
  if (AUTH_ERRORS.has(code)) return 'Your admin session could not be verified. Sign in again before continuing.'
  if (code === 'ROUND_CHANGED') return 'The voting round changed. Review the current round before starting.'
  if (code === 'PLAYBACK_CHANGED') return 'Playback changed. Check its current status before trying again.'
  if (code === 'LAST_PLAYBACK_VIDEO') return 'The last video must finish naturally to select the next voting round’s winner.'
  if (code === 'PLAYBACK_PREPARING') return 'Wait for the browser to report the current video before skipping.'
  if (code === 'PLAYBACK_OFFLINE') return 'The playback browser has not contacted Momoi recently. Open the connected browser and its Momoi extension before trying again.'
  return 'The request could not be confirmed. Review the current status before trying again.'
}
function timestamp(seconds: number) {
  const value = Math.max(0, Math.floor(seconds))
  return `${Math.floor(value / 3600)}:${String(Math.floor(value / 60) % 60).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`
}

// Remount private state when the account changes, including pairing credentials.
export function PlaybackAdmin(props: Props) {
  const { sessionQuery } = useAppState()
  const session = sessionQuery.data
  return session?.admin ? <PlaybackWorkspace key={session.user.id} {...props} disabled={props.disabled || sessionQuery.isError} actor={session.user.id} /> : null
}

function PlaybackWorkspace({ disabled, active, actor }: Props & { actor: string }) {
  const client = useConvex()
  const { isCurrentAdmin, beginAdmin, endAdmin, adminPending } = useAppState()
  const [authError, setAuthError] = useState(false)
  const [observationError, setObservationError] = useState('')
  const observationPending = useRef(false)
  const authority = useRef(isCurrentAdmin)
  authority.current = isCurrentAdmin
  const lastStatus = useRef<PlaybackStatus | undefined>(undefined)
  const [message, setMessage] = useState('')
  const [pending, setPending] = useViewState(`admin.playback.pending.${actor}`, '')
  const [now, setNow] = useState(() => Date.now())
  const liveStatus = useLiveQuery(api.playback.status, !authError && active ? {} : 'skip')
  if (liveStatus.data) lastStatus.current = liveStatus.data
  const status = { ...liveStatus, data: liveStatus.data ?? lastStatus.current }
  const [pairing, setPairing] = useViewState<Pairing | null>(`admin.playback.pairing.${actor}`, null)
  const [copyMessage, setCopyMessage] = useState('')
  const [revokeId, setRevokeId] = useState<DeviceId | null>(null)
  useEffect(() => {
    if (!active) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [active])
  useEffect(() => { if (pairing && now >= pairing.expiresAt) setPairing(null) }, [now, pairing])
  useEffect(() => { if (AUTH_ERRORS.has(errorCode(status.error))) { setAuthError(true); setPairing(null) } }, [status.error])
  const device = status.data?.device
  const report = device?.report
  const playbackRun = status.data?.run
  const connected = !!device && device.lastSeen !== null && now - device.lastSeen < 90_000
  const blocked = disabled || !active || authError || status.isError || !liveStatus.data || liveStatus.isFetching || !!pending || adminPending.includes('playback')
  const canManage = !blocked && connected
  const activePairing = pairing && pairing.expiresAt > now && !authError && !status.isError ? pairing : null
  const ConnectionPanel = device ? 'details' : 'section'
  const ownsRun = !!playbackRun && playbackRun.deviceId === device?.id
  const assignmentReady = !playbackRun || ownsRun && report?.run?.id === playbackRun.id && report.run.revision === playbackRun.revision
    && report.run.videoIndex === playbackRun.videoIndex && report.videoId === playbackRun.videoId
  const observation = device?.observation
  const observing = !!observation && observation.endsAt !== null && observation.endsAt > now
  const waiting = !!observation && observation.endsAt === null && observation.waitUntil > now
  const retry = ownsRun && device?.retry?.runId === playbackRun?.id
    && device.retry.revision === playbackRun.revision && device.retry.videoIndex === playbackRun.videoIndex
    && device.retry.videoId === playbackRun.videoId ? device.retry : null
  const retryPending = retry?.status === 'pending' && retry.expiresAt > now
  const deviceId = device?.id
  const canObserve = active && !disabled && !authError && !liveStatus.isError && !liveStatus.isFetching && ownsRun

  useEffect(() => {
    if (!canObserve || !deviceId) return
    let watching = true
    let timer: ReturnType<typeof setTimeout> | undefined
    async function renew() {
      if (!watching || document.hidden) return
      if (!observationPending.current && authority.current(actor)) {
        observationPending.current = true
        try {
          await client.mutation(api.playback.requestObservation, { deviceId: deviceId! })
          if (watching && authority.current(actor)) setObservationError('')
        } catch (error) {
          if (watching && authority.current(actor)) {
            setObservationError('Fresh player status could not be requested. Retrying automatically; the saved position stays visible.')
            if (AUTH_ERRORS.has(errorCode(error))) { setAuthError(true); setPairing(null) }
          }
        } finally { observationPending.current = false }
      }
      if (watching) timer = setTimeout(() => { void renew() }, 30_000)
    }
    void renew()
    return () => { watching = false; clearTimeout(timer) }
  }, [client, actor, deviceId, canObserve])

  async function run(label: string, work: () => Promise<void>) {
    if (blocked || !isCurrentAdmin(actor) || !beginAdmin('playback')) return false
    setPending(label); setMessage('')
    try { await work(); return true }
    catch (error) {
      if (isCurrentAdmin(actor)) {
        setMessage(failure(error))
        if (AUTH_ERRORS.has(errorCode(error))) { setAuthError(true); setPairing(null) }
      }
      return false
    } finally {
      endAdmin('playback')
      if (isCurrentAdmin(actor)) setPending('')
    }
  }
  function current() { return isCurrentAdmin(actor) }

  const currentReport = ownsRun && assignmentReady ? report : null
  const routineNotices = new Set(['Paused on YouTube.', 'Playing on YouTube.', 'Playback closed. Click Start playback in the extension.', 'Open the extension to resume playback.', 'Video finished. Waiting for Momoi.'])
  const problem = currentReport?.notice && !routineNotices.has(currentReport.notice) ? currentReport.notice : ''
  const retryReady = !blocked && ownsRun && !retryPending
  const lastVideo = !!playbackRun && playbackRun.videoIndex + 1 >= playbackRun.videoCount
  const skipReady = !blocked && connected && ownsRun && assignmentReady && !retryPending
    && !currentReport?.controlling && !currentReport?.completed && !lastVideo
  const staleReport = !device?.reportAt || now - device.reportAt > 15_000
  const stateLabel = waiting ? 'Waiting for playback browser' : !observing ? 'Saved snapshot'
    : staleReport ? 'Player report stale'
    : !currentReport ? 'Waiting for player status' : problem ? 'Needs attention' : !currentReport.playerConnected ? 'Playback tab unavailable'
      : currentReport.controlling ? 'Preparing playback' : currentReport.completed ? 'Waiting for next video' : currentReport.paused ? 'Reported paused' : 'Reported playing'
  const instruction = observationError || (waiting ? 'Fresh status should arrive on the next background check, usually within about 30 seconds.' : problem)
  function retryCurrentVideo() {
    if (!retryReady || !playbackRun || !device) return
    void run('retry', async () => {
      await client.mutation(api.playback.retryPlayback, {
        runId: playbackRun.id, revision: playbackRun.revision, deviceId: device.id,
      })
    })
  }
  function skipCurrentVideo() {
    if (!skipReady || !playbackRun || !device) return
    void run('skip', async () => {
      await client.mutation(api.playback.skipVideo, {
        runId: playbackRun.id, revision: playbackRun.revision, deviceId: device.id,
      })
    })
  }
  async function copy(value: string) {
    try { await navigator.clipboard.writeText(value); if (current()) setCopyMessage('Copied') }
    catch { if (current()) setCopyMessage('Select the field and copy it manually.') }
  }
  return <section className="playback-admin" aria-labelledby="playback-title">
    <div className="admin-section-heading"><h2 id="playback-title">Playback</h2></div>
    <Notice>{authError ? 'Sign in again to restore admin access.' : status.isError ? 'Playback status could not be loaded. Reload the page to try again.' : !status.data ? 'Loading playback…' : message || null}</Notice>
    {playbackRun ? <div className="playback-overview">
      <div className="playback-overview-top"><span className="playback-label">Current playlist</span><span className="playback-status" role="status">{stateLabel}</span></div>
      <h3>{playbackRun.title}</h3>
      <p className="playback-video-title">{playbackRun.videoTitle}</p>
      <p className="playback-progress">Video {playbackRun.videoIndex + 1} of {playbackRun.videoCount} <span aria-hidden="true">·</span> {timestamp(playbackRun.position)}{currentReport && currentReport.duration > 0 ? ' / ' + timestamp(currentReport.duration) : ''}</p>
      <p className="playback-control-hint">{device?.reportAt ? <>Last player report: {new Date(device.reportAt).toLocaleTimeString()} · {Math.max(0, Math.floor((now - device.reportAt) / 1000))} seconds ago.</>
        : 'No timestamped player report yet.'}</p>
      <p className="playback-control-hint">{playbackRun.checkpointAt ? <>Cloud recovery saved: {new Date(playbackRun.checkpointAt).toLocaleString()}.</> : 'Saved cloud position is available; its save time was not recorded.'}</p>
      <p className="playback-control-hint">Player status updates while this panel is visible.</p>
      <div className="playback-actions" aria-busy={!!pending || !!retryPending}>
        <Button asChild variant="secondary"><a href={`https://www.youtube.com/watch?v=${encodeURIComponent(playbackRun.videoId)}`} target="_blank" rel="noopener noreferrer">Open current video on YouTube</a></Button>
        <Button variant="secondary" disabled={!retryReady} onClick={retryCurrentVideo}>
          <RotateCw size={16} aria-hidden="true" />{pending === 'retry' || retryPending ? 'Retrying…' : 'Retry playback'}
        </Button>
        <Button variant="secondary" disabled={!skipReady} onClick={skipCurrentVideo}>
          <SkipForward size={16} aria-hidden="true" />{pending === 'skip' ? 'Skipping…' : 'Skip video'}
        </Button>
      </div>
      <p className="playback-control-hint">Retry restores the existing playback tab at its latest local checkpoint and attempts to play, including if paused.</p>
      <p className="playback-control-hint">{lastVideo ? 'Skip is unavailable on the last video; it must finish naturally.' : 'Skip opens the next video from the beginning and attempts to play.'}</p>
      {retry ? <p role="status" className="playback-control-hint">{retryPending ? 'Recovery requested. Waiting for the browser to confirm resumed playback.'
        : retry.status === 'applied' ? 'The browser confirmed that playback resumed.'
          : retry.error || 'The browser did not confirm recovery before the request expired.'}</p> : null}
      {instruction ? <p className="playback-instruction">{instruction}</p> : null}
    </div> : null}
    {status.data ? <ConnectionPanel key={device?.id ?? 'unpaired'} className="playback-connection">
      {device ? <summary><span>Browser settings</span><span className="playback-connection-state">{device.name} · {connected ? 'Recent contact' : 'No recent contact recorded'}</span></summary> : <h3>Connect your browser</h3>}
      {device ? <div className="playback-connection-info"><strong>{device.name}</strong>
        <Button variant="secondary" disabled={blocked} onClick={() => setRevokeId(device.id)}>Disconnect browser</Button>
      </div> : null}
      <div className="playback-pairing">
        {device ? <p>Pairing another browser disconnects this one.</p> : null}
        <form className="playback-pair-form" onSubmit={event => { event.preventDefault(); void run('pair', async () => {
          const result = await client.action(api.playback.createPairing, { name: 'Playback browser' })
          if (current()) { setPairing(result); setCopyMessage('') }
        }) }}>
          {activePairing ? <>
            <div className="playback-copy">
              <label htmlFor="admin-pairing-details">Pairing details</label>
              <div className="playback-copy-controls">
                <Input id="admin-pairing-details" readOnly autoComplete="off" spellCheck={false} value={`${activePairing.endpoint} ${activePairing.code}`} onFocus={event => event.currentTarget.select()} aria-describedby="pairing-next-step" />
                <Button type="button" disabled={blocked} aria-live="polite" onClick={() => void copy(`${activePairing.endpoint} ${activePairing.code}`)}>{copyMessage === 'Copied' ? 'Copied' : 'Copy pairing details'}</Button>
              </div>
            </div>
            <p id="pairing-next-step" className="playback-pair-hint">Paste into the Momoi extension.</p>
            <div className="playback-pair-footer">
              <span>Expires in {Math.ceil((activePairing.expiresAt - now) / 60_000)} min</span>
              <Button variant="ghost" size="sm" disabled={blocked}>{pending === 'pair' ? 'Creating…' : 'Generate new'}</Button>
            </div>
            {copyMessage && copyMessage !== 'Copied' ? <p role="status">{copyMessage}</p> : null}
          </> : <Button disabled={blocked}>{pending === 'pair' ? 'Creating…' : device ? 'Pair another browser' : 'Create pairing details'}</Button>}
        </form>
      </div>
    </ConnectionPanel> : null}
    {!playbackRun && status.data && device ? <>
      {!connected ? <Notice>Open the connected browser and its Momoi extension before choosing a playlist.</Notice> : null}
      <RunSetup actor={actor} active={active} status={status.data} disabled={!canManage || liveStatus.isFetching || !liveStatus.data} submitting={pending === 'start'} message={message}
        onAuthError={() => { setAuthError(true); setPairing(null) }} onStart={async args => {
          if (!canManage || !status.data || status.data.run || status.data.roundId !== args.roundId || device.id !== args.deviceId) return false
          return run('start', async () => { await client.mutation(api.playback.startRun, args) })
        }} />
    </> : null}
    <Dialog open={active && !!revokeId} onOpenChange={open => { if (!open) setRevokeId(null) }}>
      <DialogContent onCloseAutoFocus={event => { if (!active) event.preventDefault() }}>
        <DialogHeader><DialogTitle>Disconnect this browser?</DialogTitle><DialogDescription>Playback will pause when the extension next connects. Saved progress stays safe. You will need a new connection code to reconnect.</DialogDescription></DialogHeader>
        <DialogFooter><Button variant="secondary" onClick={() => setRevokeId(null)}>Cancel</Button><Button disabled={blocked || revokeId !== device?.id} onClick={() => { if (!revokeId) return; void run('revoke', async () => {
          await client.mutation(api.playback.revoke, { deviceId: revokeId })
          if (current()) { setRevokeId(null); setPairing(null); setMessage('Browser disconnected. Saved progress is preserved.') }
        }) }}>Disconnect browser</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </section>
}

function RunSetup({ actor, active, status, disabled, submitting, message, onStart, onAuthError }: {
  actor: string; active: boolean; status: PlaybackStatus; disabled: boolean; submitting: boolean; message: string; onStart: (args: StartRun) => Promise<boolean>; onAuthError: () => void
}) {
  const [playlistId, setPlaylistId] = useViewState(`admin.playback.initial-playlist.${actor}`, '')
  const [videoIndex, setVideoIndex] = useViewState(`admin.playback.initial-video.${actor}`, 0)
  const [position, setPosition] = useViewState(`admin.playback.initial-position.${actor}`, '0')
  const [review, setReview] = useState<{ args: StartRun; title: string; videoTitle: string } | null>(null)
  const [attempted, setAttempted] = useState(false)
  const catalogue = useLiveQuery(api.playback.catalogue, active ? {} : 'skip')
  const detail = useLiveQuery(api.playback.playlist, active && playlistId ? { playlistId } : 'skip')
  useEffect(() => { if (AUTH_ERRORS.has(errorCode(catalogue.error)) || AUTH_ERRORS.has(errorCode(detail.error))) onAuthError() }, [catalogue.error, detail.error])
  const playlists = catalogue.data?.selectedPlaylists ?? []
  const blockers = catalogue.data?.startBlockers ?? []
  const playlist = playlists.find(item => item.playlistId === playlistId)
  const video = detail.data?.videos[videoIndex]
  const seconds = Number(position)
  const valid = !!video && position.trim() !== '' && Number.isFinite(seconds) && seconds >= 0 && seconds < video.duration
  const canStart = !disabled && !catalogue.isError && !!catalogue.data && !detail.isError && !!detail.data
    && !!playlist && !status.run && !!status.device && !blockers.length && valid
  const reviewValid = canStart && review?.args.deviceId === status.device?.id && review?.args.roundId === status.roundId
    && review?.args.playlistId === playlistId && review?.args.videoIndex === videoIndex && review?.args.position === seconds && review?.args.expectedVideoId === video?.videoId
  return <section className="playback-initial" aria-labelledby="initial-playlist-title">
    <h3 id="initial-playlist-title">Choose your first playlist</h3>
    <p>Choose where to begin. You will press Play in the extension when ready.</p>

    {catalogue.isError || detail.isError ? <Notice>Saved playlist data could not be loaded. Reload the page before starting.</Notice> : null}
    {catalogue.isFetching || detail.isFetching ? <p role="status">Loading saved playlists…</p> : null}
    {blockers.length ? <Notice><ul>{blockers.map(blocker => <li key={blocker}>{blocker.replaceAll('Catalogue', 'Games & playlists')}</li>)}</ul></Notice> : null}
    {catalogue.data && !playlists.length ? <p>Add a playlist under Games & playlists first.</p> : null}
    <form onSubmit={event => {
      event.preventDefault()
      if (!canStart || !status.device || !playlist || !video) return
      setAttempted(false)
      setReview({ args: { deviceId: status.device.id, roundId: status.roundId, playlistId, videoIndex, position: seconds, expectedVideoId: video.videoId },
        title: playlist.title, videoTitle: video.title })
    }}>
      <div className="admin-lookup-form">
        <label>Playlist<NativeSelect value={playlistId} onChange={event => { setPlaylistId(event.target.value); setVideoIndex(0); setPosition('0'); setReview(null) }}>
          <NativeSelectOption value="">Choose a saved playlist</NativeSelectOption>
          {playlists.map(item => <NativeSelectOption key={item.playlistId} value={item.playlistId}>{item.title}{item.retired ? ' (retired from voting)' : ''}</NativeSelectOption>)}
        </NativeSelect></label>
        <label>Starting video<NativeSelect value={videoIndex} disabled={!playlist} onChange={event => { setVideoIndex(Number(event.target.value)); setPosition('0'); setReview(null) }}>
          {detail.data?.videos.map((item, index) => <NativeSelectOption key={`${item.videoId}-${index}`} value={index}>{index + 1}. {item.title}</NativeSelectOption>)}
        </NativeSelect></label>
      </div>
      <div className="admin-lookup-form">
        <label>Start at (seconds)<Input type="number" min={0} max={video ? Math.max(0, Math.ceil(video.duration) - 1) : undefined} step="1" value={position} required
          onChange={event => { setPosition(event.target.value); setReview(null) }} /></label>
        <Button disabled={!canStart}>Review playlist</Button>
      </div>
      {video && !valid ? <p role="status">Enter a starting position from 0 to {Math.max(0, Math.ceil(video.duration) - 1)} seconds.</p> : null}
    </form>
    <Dialog open={active && !!review} onOpenChange={open => { if (!open) setReview(null) }}>
      <DialogContent onCloseAutoFocus={event => { if (!active) event.preventDefault() }}>
        <DialogHeader><DialogTitle>Use this playlist?</DialogTitle><DialogDescription>Review where playback will begin.</DialogDescription></DialogHeader>
        {review ? <>
          <p>{review.title} · Video {review.args.videoIndex + 1}: {review.videoTitle} · {timestamp(review.args.position)}</p>
          <p>This game leaves the voting choices while it plays. Existing votes are preserved. When the playlist ends, voting chooses the next game. Open the extension and click Play to begin.</p>
        </> : null}
        {attempted && message ? <Notice>{message}</Notice> : null}
        {submitting ? <p role="status">Saving playlist…</p> : !reviewValid ? <p role="status">The selection or playback state changed. Cancel and review the current state before starting.</p> : null}
        <DialogFooter><Button variant="secondary" onClick={() => setReview(null)}>Cancel</Button><Button disabled={!reviewValid} onClick={() => {
          if (review && reviewValid) { setAttempted(true); void onStart(review.args).then(saved => { if (saved) setReview(null) }) }
        }}>Use this playlist</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </section>
}

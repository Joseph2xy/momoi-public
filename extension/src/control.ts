import { endpointFrom } from './remote'
import type { PlaybackStatus } from './background'

function element<T extends HTMLElement>(id: string) { return document.getElementById(id) as T }
let busy = false
let polling = false
let current: PlaybackStatus | null = null
let action: 'start' | 'focus' = 'start'
let actionError = ''
const pairingDetails = element<HTMLInputElement>('pairing-details')
let draftEdited = false

function saveDraft() {
  draftEdited = true
  void chrome.storage.session.set({ pairingDraft: pairingDetails.value }).catch(() => {
    actionError = 'Could not save your input. Keep this popup open until connected.'
    if (current) render(current)
  })
}
pairingDetails.addEventListener('input', saveDraft)
void chrome.storage.session.get('pairingDraft').then(({ pairingDraft }) => {
  if (draftEdited || typeof pairingDraft !== 'string' || current?.remote.paired) return
  pairingDetails.value = pairingDraft
}).catch(() => {})

function time(seconds: number) {
  const n = Math.floor(seconds)
  const minutes = Math.floor(n / 60)
  return (n >= 3600 ? Math.floor(n / 3600) + ':' + String(minutes % 60).padStart(2, '0') : String(minutes))
    + ':' + String(n % 60).padStart(2, '0')
}
function render(status: PlaybackStatus) {
  current = status
  const { remote, playback } = status
  if (remote.paired) {
    pairingDetails.value = ''
  }
  const available = remote.paired && status.available && playback !== null
  const playing = available && status.state === 'Playing'
  const preparing = available && status.state === 'Preparing playback'
  const waiting = available && status.state === 'Waiting for Momoi'
  const problem = available && status.state === 'Check playback'
  const resume = status.state === 'Paused' || (playback?.position ?? 0) > 0
  action = playing || waiting ? 'focus' : 'start'

  element('setup').hidden = remote.paired
  element('playback').hidden = !remote.paired
  element('connection-settings').hidden = !remote.paired
  element('connection-state').hidden = !remote.paired
  element('connection-state').textContent = !remote.paired ? 'Browser not connected'
    : remote.synced ? 'Connected to Momoi' : 'Reconnecting to Momoi…'
  element('remote-name').textContent = remote.name || 'This browser'
  element('state').textContent = !available ? playback ? 'Playback unavailable' : 'Choose a playlist' : preparing ? 'Opening YouTube…'
    : waiting ? 'Waiting for the next video' : problem ? 'Playback needs attention'
    : playing ? 'Playing' : status.state === 'Paused' ? 'Paused' : 'Ready to play'
  element('video-title').textContent = playback ? status.title.replace(/ - YouTube$/, '') || 'Your playlist' : 'Finish setup in Momoi Admin'
  element('position').textContent = available && playback
    ? 'Video ' + (playback.videoIndex + 1) + ' of ' + playback.videoCount + ' · ' + time(playback.position) : ''
  const start = element<HTMLButtonElement>('start')
  start.hidden = !available
  start.disabled = busy || !available || (action === 'focus' && !status.canFocus)
  start.textContent = busy ? 'Working…' : action === 'focus' ? 'Go to YouTube'
    : preparing || problem ? 'Retry playback' : resume ? 'Resume' : 'Play'
  element<HTMLButtonElement>('open-tab').hidden = !status.canFocus || !(preparing || problem)
  element('hint').textContent = !available ? playback ? 'Enable playback in Momoi Admin.' : 'Choose a playlist in Momoi Admin.'
    : preparing ? 'Check YouTube if playback doesn’t start.'
    : waiting ? 'Waiting for Momoi to reconnect.'
    : ''
  element('hint').hidden = !element('hint').textContent
  const message = element('message')
  message.textContent = actionError || status.pairingError || remote.error || (problem ? status.notice : '')
  message.hidden = !message.textContent
  message.classList.toggle('error', Boolean(actionError || status.pairingError || remote.error || problem))
}
async function send(command: Record<string, unknown>) {
  const result = await chrome.runtime.sendMessage(command) as { ok: boolean; status?: PlaybackStatus; error?: string }
  if (!result?.ok || !result.status) throw new Error(result?.error || 'Cannot reach the extension. Reopen this popup.')
  render(result.status)
}
async function act(work: () => Promise<void>) {
  if (busy) return
  busy = true
  pairingDetails.disabled = true
  element('connect').textContent = 'Connecting…'
  actionError = ''
  document.querySelectorAll<HTMLButtonElement>('button').forEach(button => { button.disabled = true })
  try { await work() } catch (error) { actionError = error instanceof Error ? error.message : 'Action failed. Please try again.' }
  finally {
    busy = false
    pairingDetails.disabled = false
    element('connect').textContent = 'Connect'
    document.querySelectorAll<HTMLButtonElement>('button').forEach(button => { button.disabled = false })
    if (current) render(current)
  }
}
async function poll() {
  if (busy || polling) return
  polling = true
  try { await send({ type: 'status' }) } catch (error) {
    const message = element('message')
    message.textContent = error instanceof Error ? error.message : 'Cannot reach the extension. Reopen this popup.'
    message.hidden = false
    message.classList.add('error')
  } finally { polling = false }
}
element('start').addEventListener('click', () => { void act(() => send({ type: action })) })
element('open-tab').addEventListener('click', () => { void act(() => send({ type: 'focus' })) })
element('disconnect').addEventListener('click', () => { void act(() => send({ type: 'disconnect' })) })
element<HTMLFormElement>('pair-form').addEventListener('submit', event => {
  event.preventDefault()
  void act(async () => {
    const parts = pairingDetails.value.trim().split(/\s+/)
    if (parts.length !== 2 || !/^[a-f0-9]{32}$/i.test(parts[1])) {
      throw new Error('Use Copy pairing details in Momoi Admin and paste the complete value here.')
    }
    const endpoint = endpointFrom(parts[0])
    const code = parts[1]
    // Send before awaiting anything so the worker can request permission in
    // this user gesture and finish pairing if the popup closes.
    await send({ type: 'pair', endpoint, code })
  })
})
setInterval(() => { void poll() }, 2_000)
void poll()

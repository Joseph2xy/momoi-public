import type { BallotState, PublicSession } from '../shared/contracts'

type ConfirmedBallot = { roundId: string; gameIds: string[]; revision: number; pendingChoice: { gameId: string; roundId: string } | null }
type Backend = {
  save(args: { roundId: string; expectedRevision: number; gameIds: string[] }): Promise<{ revision: number }>
  read(): Promise<ConfirmedBallot>
  consume(args: { roundId: string; expectedRevision: number }): Promise<{ revision: number }>
  dismiss(): Promise<unknown>
}
export function createReactiveBallot(backend: Backend) {
  let state: BallotState = { session: null, selectedGameIds: [], status: 'loading', message: 'Loading your ballot…' }
  let confirmed: ConfirmedBallot | null = null
  let draft: string[] | null = null
  let running = false; let epoch = 0; let connected = true; let pendingAttempted = false
  let contextKey = ''
  let contextRound: string | undefined
  const listeners = new Set<() => void>()
  const update = (patch: Partial<BallotState>) => { state = { ...state, ...patch }; listeners.forEach(listener => listener()) }
  const same = (a: string[], b: string[]) => a.length === b.length && a.every(id => b.includes(id))
  const eligibility = () => state.session?.banned ? "You're banned from voting." : state.session && !state.session.eligible
    ? 'This account is not eligible to vote yet. Your Twitch account must be at least 30 days old.' : ''
  async function reconcile(message = 'Your ballot changed elsewhere. The latest saved choices are shown; choose again to make changes.') {
    const requestEpoch = epoch
    draft = null; update({ status: 'loading', message: 'Checking your saved choices…' })
    try {
      const data = await backend.read()
      if (epoch !== requestEpoch) return
      if (data.roundId !== contextRound) {
        confirmed = null
        update({ selectedGameIds: [], status: 'loading', message: 'The voting round changed. Loading the new round…' }); return
      }
      if (!confirmed || confirmed.revision <= data.revision) confirmed = data
      update({ selectedGameIds: confirmed.gameIds, status: connected ? 'ready' : 'error', message: eligibility() || message })
    } catch { if (epoch === requestEpoch) update({ status: 'error', message: 'Could not confirm your ballot. Reload the page before choosing again.' }) }
  }
  async function drain() {
    if (running || !connected || !confirmed || !draft || !state.session?.eligible) return
    running = true
    const requestEpoch = epoch
    try {
      while (draft && confirmed && requestEpoch === epoch) {
        const sent = draft; draft = null
        const { revision } = await backend.save({ roundId: confirmed.roundId, expectedRevision: confirmed.revision, gameIds: sent })
        if (requestEpoch !== epoch) return
        if (confirmed.revision > revision) { await reconcile(); return }
        confirmed = { ...confirmed, revision, gameIds: sent }
        if (draft && same(draft, sent)) draft = null
        if (!draft) update({ selectedGameIds: sent, status: connected ? 'saved' : 'error', message: connected ? 'All choices saved.' : 'Connection interrupted. Reconnect to confirm your choices before editing.' })
      }
    } catch { if (requestEpoch === epoch) { console.warn('ballot_save_requires_reconciliation'); await reconcile() } }
    finally { if (requestEpoch === epoch) running = false }
  }
  async function tryPending() {
    if (pendingAttempted || !confirmed?.pendingChoice || !state.session?.eligible || running) return
    pendingAttempted = true
    const requestEpoch = epoch
    if (confirmed.pendingChoice.roundId !== confirmed.roundId) {
      update({ message: 'The voting round changed during sign-in. Dismiss the remembered choice and choose again.' }); return
    }
    running = true; update({ status: 'loading', message: 'Adding your remembered choice…' })
    try {
      await backend.consume({ roundId: confirmed.roundId, expectedRevision: confirmed.revision })
      if (requestEpoch === epoch) await reconcile('Your remembered choice was saved.')
    } catch { if (requestEpoch === epoch) await reconcile('Your remembered choice could not be added. Review your choices or dismiss it.') }
    finally { if (requestEpoch === epoch) running = false }
  }
  return {
    getSnapshot: () => state,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    context(session: PublicSession | null | undefined, roundId: string | undefined) {
      contextRound = roundId
      const key = JSON.stringify([session === undefined, session?.user.id, roundId === undefined, roundId])
      if (key !== contextKey) {
        const wasSignedIn = !!state.session
        contextKey = key; epoch++; confirmed = null; draft = null; running = false; pendingAttempted = false
        update({ session: session ?? null, selectedGameIds: [], status: session === undefined || roundId === undefined || session ? 'loading' : wasSignedIn ? 'expired' : 'ready',
          message: session === undefined ? 'Checking your session…' : !session ? 'Sign in with Twitch to vote.' : 'Loading your ballot…' })
      } else if (state.session !== session) {
        if (!session?.eligible) draft = null
        update({ session: session ?? null, message: session?.banned ? "You're banned from voting." : state.session?.banned ? '' : state.message })
      }
    },
    receive(data: ConfirmedBallot) {
      if (!state.session || data.roundId !== contextRound || confirmed && confirmed.revision > data.revision) return
      const changed = confirmed && confirmed.revision !== data.revision
      confirmed = data
      if (!running && !draft) update({ selectedGameIds: data.gameIds, status: connected ? 'ready' : 'error', message: eligibility() || (!connected ? 'Connection interrupted. Reconnect before editing.' : changed ? 'Your saved choices were updated.' : state.status === 'loading' ? '' : state.message) })
      void tryPending()
    },
    connection(online: boolean) {
      connected = online
      if (!online) { draft = null; update({ status: running ? state.status : 'error', message: 'Connection interrupted. Reconnect to confirm your choices before editing.' }) }
      if (online && !running && state.status === 'error' && state.session) void reconcile('Connection restored. Your saved choices are shown.')
    },
    toggle(gameId: string) {
      if (!connected || !confirmed || !state.session?.eligible || !['ready', 'saved', 'saving'].includes(state.status)) return
      const selected = state.selectedGameIds
      if (!selected.includes(gameId) && selected.length >= 3) return
      draft = selected.includes(gameId) ? selected.filter(id => id !== gameId) : [...selected, gameId]
      update({ selectedGameIds: draft, status: 'saving', message: 'Saving your choices…' }); void drain()
    },
    readFailed() { draft = null; if (!running) update({ status: 'error', message: 'Could not load your ballot. Reload the page before editing.' }) },
    async dismissPending() {
      if (running || !state.session || !confirmed) return
      const requestEpoch = epoch
      running = true
      update({ status: 'loading', message: 'Checking your saved choices…' })
      try {
        await backend.dismiss()
        if (requestEpoch !== epoch) return
        if (confirmed) confirmed = { ...confirmed, pendingChoice: null }
        update({ selectedGameIds: confirmed?.gameIds ?? [], status: connected ? 'ready' : 'error', message: 'Remembered choice dismissed.' })
      } catch {
        if (requestEpoch === epoch) update({ status: 'error', message: 'Could not confirm your ballot. Reload the page before choosing again.' })
      } finally { if (requestEpoch === epoch) running = false }
    },
    dispose() { epoch++; draft = null; listeners.clear() },
  }
}

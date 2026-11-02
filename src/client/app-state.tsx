import { createContext, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { useConvex, useConvexAuth, useConvexConnectionState } from 'convex/react'
import { ConvexError } from 'convex/values'
import { api } from '../../convex/_generated/api'
import { createReactiveBallot } from './reactive-ballot'
import type { PublicSession } from '../shared/contracts'
import { useLiveQuery } from './live-query'
import { authClient } from './convex-auth'
import { useBallotNotifications } from './use-ballot-notifications'
import { ViewStateProvider } from './view-state'
import { Toaster } from '../components/ui/sonner'
import { reloadPage } from './reload-page'

function useRuntime() {
  const client = useConvex()
  const auth = useConvexAuth()
  const connection = useConvexConnectionState()
  const publicQuery = useLiveQuery(api.voting.publicSnapshot, {})
  const historyQuery = useLiveQuery(api.voting.winnerHistory, {})
  const identity = useLiveQuery(api.identity.viewer, auth.isAuthenticated ? {} : 'skip')
  const privateQuery = useLiveQuery(api.voting.ballot, auth.isAuthenticated ? {} : 'skip')
  const session = useMemo<PublicSession | null | undefined>(() => {
    if (!auth.isLoading && !auth.isAuthenticated || identity.error instanceof ConvexError && ['UNAUTHENTICATED', 'REAUTHENTICATION_REQUIRED'].includes(String(identity.error.data))) return null
    const viewer = identity.data
    if (!viewer) return undefined
    return { user: { id: viewer.twitchId, displayName: viewer.name },
      eligible: viewer.ageEligible && !viewer.banned, banned: viewer.banned, admin: viewer.admin }
  }, [identity.data, identity.error, auth.isAuthenticated, auth.isLoading])
  const roundId = publicQuery.data?.round.id
  const accountReadFailed = identity.isError && session !== null
  const readFailed = publicQuery.isError || accountReadFailed || privateQuery.isError && !!session
  const controller = useMemo(() => createReactiveBallot({
    save: args => client.mutation(api.voting.replaceBallot, args), read: () => client.query(api.voting.ballot, {}),
    consume: args => client.mutation(api.voting.consumePending, args), dismiss: () => client.mutation(api.voting.dismissPending, {}),
  }), [client])
  useEffect(() => { controller.context(session, roundId) }, [controller, session, roundId])
  useEffect(() => {
    if (!session) return
    if (readFailed) controller.readFailed()
    else if (privateQuery.data && privateQuery.data.roundId === roundId) controller.receive(privateQuery.data)
  }, [controller, session, privateQuery.data, readFailed, roundId])
  const everConnected = useRef(false)
  useEffect(() => {
    if (connection.isWebSocketConnected) everConnected.current = true
    if (everConnected.current) controller.connection(connection.isWebSocketConnected)
  }, [controller, connection.isWebSocketConnected])
  useEffect(() => () => controller.dispose(), [controller])
  const ballotState = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot)
  const toggle = useBallotNotifications(controller, ballotState, session, publicQuery.data?.games, roundId)
  const authority = useRef(session)
  authority.current = session
  const [adminPending, setAdminPending] = useState<string[]>([])
  const pendingRef = useRef(new Set<string>())
  useEffect(() => {
    if (ballotState.status !== 'saving' && !adminPending.length) return
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn)
  }, [ballotState.status, adminPending.length])
  const ballot = { ...ballotState, session: session ?? null,
    pendingGameId: session && ballotState.session?.user.id === session.user.id ? privateQuery.data?.pendingChoice?.gameId ?? null : null,
    ...(ballotState.session?.user.id !== session?.user.id || !session && session !== undefined ? { selectedGameIds: [], status: session ? 'loading' as const : 'ready' as const } : {}),
    ...(readFailed && ballotState.status !== 'saving' ? { status: 'error' as const,
      message: accountReadFailed ? 'Your account could not be loaded. Reload the page to try again.' : 'Voting data could not be loaded. Reload the page before choosing again.' } : {}),
    toggle: (gameId: string) => { if (!readFailed) toggle(gameId) },
    reload: reloadPage, dismissPending: controller.dismissPending }
  return { publicQuery, historyQuery, sessionQuery: { ...identity, data: session }, ballot, adminPending,
    isCurrentAdmin: (actor: string) => authority.current?.user.id === actor && authority.current.admin,
    beginAdmin(target: string) {
      if (pendingRef.current.has(target)) return false
      pendingRef.current.add(target); setAdminPending([...pendingRef.current]); return true
    },
    endAdmin(target: string) { pendingRef.current.delete(target); setAdminPending([...pendingRef.current]) },
    async signIn(pendingGameId?: string) {
      const response = await authClient.signIn.social({ provider: 'twitch', callbackURL: '/', errorCallbackURL: '/',
        ...(pendingGameId && roundId ? { additionalData: { pendingChoice: { gameId: pendingGameId, roundId } } } : {}) })
      if (response.error) throw new Error('Twitch sign-in could not start. Please try again.')
    },
    async signOut() { const result = await authClient.signOut(); if (result.error) throw new Error('Sign out failed. Please try again.'); window.location.replace('/') },
  }
}
const RuntimeContext = createContext<ReturnType<typeof useRuntime> | null>(null)
export function AppStateProvider({ children }: { children: ReactNode }) {
  const runtime = useRuntime()
  return <RuntimeContext.Provider value={runtime}><ViewStateProvider session={runtime.sessionQuery.data}>{children}<Toaster /></ViewStateProvider></RuntimeContext.Provider>
}
export function useAppState() { const value = useContext(RuntimeContext); if (!value) throw new Error('AppStateProvider is required'); return value }

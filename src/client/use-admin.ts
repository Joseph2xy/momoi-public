import { useEffect, useMemo, useRef, useState } from 'react'
import { useConvex, useConvexConnectionState } from 'convex/react'
import { useAppState } from './app-state'
import { useViewState } from './view-state'
import { useLiveQuery } from './live-query'
import { api } from '../../convex/_generated/api'
import type { AdminIntent, AdminData } from '../shared/contracts'

type Filters = { query?: string; scope?: 'all' | 'voted' | 'excluded' | 'banned'; usersOffset?: number }
const EMPTY_GAMES: AdminData['games'] = []
export function useAdmin(active: boolean) {
  const client = useConvex()
  const connection = useConvexConnectionState()
  const connectedBefore = useRef(false)
  if (connection.isWebSocketConnected) connectedBefore.current = true
  const disconnected = connectedBefore.current && !connection.isWebSocketConnected
  const { sessionQuery, adminPending: pending, beginAdmin, endAdmin, isCurrentAdmin } = useAppState()
  const actor = sessionQuery.data?.user.id ?? 'signed-out'
  const authorized = sessionQuery.data?.admin === true
  const [filters, setFilters] = useViewState<Filters>('admin.filters.' + actor, {})
  const [expandedId, setExpandedId] = useViewState<string | null>('admin.expanded.' + actor, null)
  const [message, setMessage] = useViewState('admin.message.' + actor, '')
  const [confirmation, setConfirmation] = useState<{ action: AdminIntent; text: string } | null>(null)
  const search = filters.query?.trim() ?? ''
  const [settledSearch, setSettledSearch] = useState({ actor, search })
  const appliedSearch = settledSearch.actor === actor ? settledSearch.search : search
  const searchPending = appliedSearch !== search
  useEffect(() => {
    if (settledSearch.actor !== actor) { setSettledSearch({ actor, search }); return }
    if (!searchPending) return
    const timer = setTimeout(() => setSettledSearch({ actor, search }), 250)
    return () => clearTimeout(timer)
  }, [actor, search, searchPending, settledSearch.actor])
  const appliedFilters = { ...filters, query: appliedSearch }
  const queryArgs = (next: Filters) => ({ search: next.query?.trim() ?? '', scope: next.scope ?? 'voted', offset: next.usersOffset ?? 0 })
  const live = useLiveQuery(api.voting.adminDirectory, authorized && active ? queryArgs(appliedFilters) : 'skip')
  const query = { ...live, isFetching: live.isFetching || searchPending, isError: live.isError || sessionQuery.isError }
  const last = useRef<{ actor: string; filters: Filters; data: AdminData } | null>(null)
  if (!authorized || last.current?.actor !== actor) last.current = null
  if (query.data && authorized && !query.isError) last.current = { actor, filters: appliedFilters, data: query.data }
  const data = authorized ? query.data ?? last.current?.data : undefined
  const showingPrevious = !!data && (searchPending || !query.data)
  const visibleFilters = query.data ? appliedFilters : last.current?.filters ?? filters
  const denied = sessionQuery.data !== undefined && !authorized
  const ready = authorized && !sessionQuery.isError && connection.isWebSocketConnected
  const directoryReady = ready && active && !!data && !query.isError && !showingPrevious && !live.isFetching
  useEffect(() => { setConfirmation(null) }, [actor, authorized])

  const targetFor = (action: AdminIntent) => 'userId' in action ? action.userId
    : data?.users.find(user => user.ballot?.id === action.ballotId)?.id ?? action.ballotId

  async function execute(action: AdminIntent, target: string) {
    try {
      switch (action.action) {
        case 'ban': case 'unban': await client.mutation(api.voting.setBan, { twitchId: action.userId, banned: action.action === 'ban' }); break
        case 'exclude': case 'unexclude': {
          const user = data?.users.find(user => user.ballot?.id === action.ballotId)
          if (!user || !data) throw new Error('Current ballot not available')
          await client.mutation(api.voting.setExclusion, { twitchId: user.id, roundId: data.openRound.id, excluded: action.action === 'exclude' }); break
        }
      }
      if (isCurrentAdmin(actor)) setMessage('Change saved.')
    } catch {
      console.warn('admin_operation_rejected', { operation: action.action })
      // Convex keeps the subscribed directory consistent with mutation results.
      // A rejection needs feedback, not a duplicate query or automatic write.
      if (!isCurrentAdmin(actor)) return
      setMessage('Change was not accepted. Review the current state and try again.')
    } finally { endAdmin(target) }
  }
  function mutate(action: AdminIntent, text?: string) {
    if (!directoryReady) return
    const target = targetFor(action)
    if (text) { setConfirmation({ action, text }); return }
    if (!beginAdmin(target)) return
    setMessage(''); void execute(action, target)
  }
  const games = data?.games ?? EMPTY_GAMES
  const gamesById = useMemo(() => new Map(games.map(game => [game.id, game])), [games])
  return { filters, expandedId, setExpandedId, message, confirmation, setConfirmation,
    authorized, query, data, showingPrevious, visibleFilters, denied, ready, disconnected,
    confirmationPending: !!confirmation && pending.includes(targetFor(confirmation.action)), pending,
    mutate, gamesById, managedUser: data?.users.find(user => user.id === expandedId),
    disabled: !directoryReady, show: (next: Filters) => { setMessage(''); setFilters(next) },
  }
}

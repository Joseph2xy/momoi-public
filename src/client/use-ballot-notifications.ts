import { useEffect, useRef } from 'react'
import { toast } from 'sonner'
import type { BallotState, PublicSession } from '../shared/contracts'
import type { PublicGame } from '../shared/contracts'

// Feedback follows the application-owned queue across route changes.
export function useBallotNotifications(
  controller: { getSnapshot(): BallotState; toggle(gameId: string): void },
  ballotState: BallotState,
  session: PublicSession | null | undefined,
  games: PublicGame[] | undefined,
  roundId?: string,
) {
  const editNotice = useRef<string | null>(null)

  useEffect(() => {
    editNotice.current = null
    toast.dismiss('ballot-save')
    toast.dismiss('ballot-limit')
  }, [controller, session?.user.id, roundId])

  useEffect(() => {
    if (!editNotice.current) return
    const options = { id: 'ballot-save', duration: 4500 }
    // A subscription update may finish in the same render as the save.
    if (ballotState.status === 'saved' || ballotState.status === 'ready' && !ballotState.message) {
      toast.success(editNotice.current, { ...options, description: 'All choices saved.' })
      editNotice.current = null
    } else if (ballotState.status === 'loading') {
      toast.loading('Checking your saved choices…', { id: 'ballot-save' })
    } else if (ballotState.status !== 'saving') {
      // Reconciliation confirms the server snapshot, not the discarded intent.
      toast.warning(ballotState.message, { ...options, duration: 8000, description: undefined })
      editNotice.current = null
    }
  }, [ballotState])

  function toggle(gameId: string) {
    const before = controller.getSnapshot()
    if (!session?.eligible || !['ready', 'saved', 'saving'].includes(before.status)) return
    const removing = before.selectedGameIds.includes(gameId)
    if (!removing && !games?.find(game => game.id === gameId)?.available) return
    if (!removing && before.selectedGameIds.length >= 3) {
      toast.warning('All 3 votes are used.', { id: 'ballot-limit', description: 'Remove one before voting for another game.' })
      return
    }
    controller.toggle(gameId)
    if (before.selectedGameIds === controller.getSnapshot().selectedGameIds) return
    const name = games?.find(game => game.id === gameId)?.name ?? 'Game'
    editNotice.current = removing ? `Vote removed for ${name}.` : `Vote added for ${name}.`
    toast.dismiss('ballot-limit')
    toast.loading(removing ? `Removing vote for ${name}…` : `Voting for ${name}…`, { id: 'ballot-save', description: 'Saving your choices…' })
  }

  return toggle
}

// Presentation shapes. Convex functions remain the authority for every rule.
import type { FunctionReturnType } from 'convex/server'
import type { api } from '../../convex/_generated/api'

export type PublicSession = {
  user: { id: string; displayName: string }
  eligible: boolean; banned: boolean; admin: boolean
}
export type BallotState = {
  session: PublicSession | null; selectedGameIds: string[]
  status: 'loading' | 'ready' | 'saving' | 'saved' | 'error' | 'expired'; message: string
}
export type PublicGame = FunctionReturnType<typeof api.voting.publicSnapshot>['games'][number]
export type AdminIntent =
  | { action: 'ban' | 'unban'; userId: string }
  | { action: 'exclude' | 'unexclude'; ballotId: string }
export type AdminData = FunctionReturnType<typeof api.voting.adminDirectory>
export type AdminGame = AdminData['games'][number]
export type AdminUser = AdminData['users'][number]

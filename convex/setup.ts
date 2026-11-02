import { internalMutation } from './_generated/server'
import { ConvexError } from 'convex/values'
import { requireReady } from './operations'

// Explicit first-time setup, never a startup hook or a vote reset.
export const initialize = internalMutation({ args: {}, handler: async ctx => {
  requireReady()
  for (const table of ['games', 'rounds', 'appState', 'ballots'] as const) {
    if (await ctx.db.query(table).first()) throw new ConvexError('ALREADY_INITIALIZED')
  }
  const now = Date.now()
  const roundId = crypto.randomUUID()
  await ctx.db.insert('rounds', {
    sourceId: roundId, status: 'open', winnerGameId: null, openedAt: now,
    closedAt: null, openedBy: null, closedBy: null,
  })
  await ctx.db.insert('appState', { key: 'current', roundId })
  return { roundId }
} })

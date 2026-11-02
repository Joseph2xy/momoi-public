import { internalMutation } from './_generated/server'
import { v } from 'convex/values'

export const remember = internalMutation({
  args: { sessionId: v.string(), gameId: v.string(), roundId: v.string() },
  handler: async (ctx, args) => { await ctx.db.insert('pendingChoices', args) },
})

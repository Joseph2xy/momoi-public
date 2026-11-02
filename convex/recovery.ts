import { internalMutation } from './_generated/server'
import { components } from './_generated/api'
import { ConvexError, v } from 'convex/values'

// Run only while the external restore lock is set, before restoring traffic.
// Auth tables are not durable voting history: all restored authority
// must be invalidated, including tokens from sessions revoked after the backup.
export const invalidateRestoredAuth = internalMutation({ args: { cursor: v.optional(v.string()) }, handler: async (ctx, { cursor }) => {
  if (process.env.MOMOI_MAINTENANCE !== 'restore') throw new ConvexError('RESTORE_LOCK_REQUIRED')
  let changed = 0
  for (const pairing of await ctx.db.query('playbackPairings').take(50)) { await ctx.db.delete(pairing._id); changed++ }
  for (const device of await ctx.db.query('playbackDevices').withIndex('revoked', q => q.eq('revoked', false)).take(50)) {
    await ctx.db.patch(device._id, { revoked: true }); changed++
  }
  for (const model of ['session', 'verification', 'jwks'] as const) {
    const result = await ctx.runQuery(components.betterAuth.adapter.findMany, { model, paginationOpts: { cursor: null, numItems: 50 } })
    for (const row of result.page) { await ctx.runMutation(components.betterAuth.adapter.deleteOne, { input: { model, where: [{ field: '_id', value: row._id }] } }); changed++ }
  }
  const accounts = await ctx.runQuery(components.betterAuth.adapter.findMany, { model: 'account', where: [{ field: 'providerId', value: 'twitch' }], paginationOpts: { cursor: cursor ?? null, numItems: 50 } })
  for (const account of accounts.page) if (account.accessToken || account.refreshToken || account.idToken) {
    await ctx.runMutation(components.betterAuth.adapter.updateOne, { input: { model: 'account', where: [{ field: '_id', value: account._id }], update: { accessToken: null, refreshToken: null, idToken: null, accessTokenExpiresAt: null, refreshTokenExpiresAt: null } } }); changed++
  }
  for (const pending of await ctx.db.query('pendingChoices').take(50)) { await ctx.db.delete(pending._id); changed++ }
  const work = await ctx.db.query('providerWork').withIndex('dueAt', q => q.lt('dueAt', Number.MAX_SAFE_INTEGER)).take(50)
  for (const item of work) { await ctx.db.patch(item._id, { revoked: true, generation: item.generation + 1, validUntil: 0, dueAt: Number.MAX_SAFE_INTEGER, claim: undefined, claimedUntil: undefined, invalidatedBefore: Date.now() }); changed++ }
  return { changed, nextCursor: accounts.isDone ? null : accounts.continueCursor }
} })

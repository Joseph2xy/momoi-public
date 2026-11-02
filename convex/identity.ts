import { ConvexError } from 'convex/values'
import { internalQuery, query, type QueryCtx } from './_generated/server'
import { components } from './_generated/api'
import { authComponent } from './auth'
import { requireReady } from './operations'

export async function requireIdentity(ctx: QueryCtx) {
  requireReady()
  const user = await authComponent.safeGetAuthUser(ctx)
  const jwt = await ctx.auth.getUserIdentity()
  if (!user || !jwt) throw new ConvexError('UNAUTHENTICATED')
  // Bind session ownership explicitly in addition to the integration's expiry lookup.
  const session = await ctx.runQuery(components.betterAuth.adapter.findOne, {
    model: 'session', where: [{ field: '_id', value: jwt.sessionId as string }],
  })
  if (!session || session.userId !== user._id || session.expiresAt <= Date.now()) throw new ConvexError('UNAUTHENTICATED')
  const account = await ctx.runQuery(components.betterAuth.adapter.findOne, {
    model: 'account', where: [{ field: 'userId', value: user._id }, { field: 'providerId', value: 'twitch' }],
  })
  if (!account) throw new ConvexError('UNAUTHENTICATED')
  const provider = await ctx.db.query('providerWork').withIndex('accountId', q => q.eq('accountId', account._id)).unique()
  if (!provider || provider.revoked || session.createdAt <= (provider.invalidatedBefore ?? 0)) throw new ConvexError('UNAUTHENTICATED')
  if (provider.validUntil <= Date.now()) throw new ConvexError('REAUTHENTICATION_REQUIRED')
  const profile = await ctx.db.query('twitchProfiles').withIndex('twitchId', q => q.eq('twitchId', account.accountId)).unique()
  if (!profile) throw new ConvexError('REAUTHENTICATION_REQUIRED')
  const admin = (process.env.ADMIN_TWITCH_IDS ?? '').split(',').map(id => id.trim()).includes(profile.twitchId)
  return { twitchId: profile.twitchId, name: user.name,
    ageEligible: Date.now() >= profile.createdAt + 30 * 86400000, banned: profile.banned ?? false, admin, sessionId: session._id }
}

export async function requireAdmin(ctx: QueryCtx) {
  const identity = await requireIdentity(ctx)
  if (!identity.admin) throw new ConvexError('FORBIDDEN')
  return identity
}

export const authorizeAdmin = internalQuery({ args: {}, handler: async ctx => { await requireAdmin(ctx) } })

export const viewer = query({ args: {}, handler: async ctx => {
  const { sessionId: _sessionId, ...identity } = await requireIdentity(ctx)
  return identity
} })

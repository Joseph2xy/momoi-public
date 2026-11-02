import { internalAction, internalMutation, internalQuery, type MutationCtx } from './_generated/server'
import { components, internal } from './_generated/api'
import { v } from 'convex/values'
import { symmetricDecrypt, symmetricEncrypt } from 'better-auth/crypto'
import { validateTwitchGrant } from './twitch'
import { isReady, requireReady } from './operations'

const INTERVAL = 40 * 60_000
const LEASE = 30_000
const NEVER = Number.MAX_SAFE_INTEGER
const claimArgs = { workId: v.id('providerWork'), claim: v.string() }

export const register = internalMutation({ args: { accountId: v.string() }, handler: async (ctx, { accountId }) => {
  requireReady()
  const account = await ctx.runQuery(components.betterAuth.adapter.findOne, { model: 'account', where: [{ field: '_id', value: accountId }] })
  if (!account || account.providerId !== 'twitch' || !account.accessToken) return
  const profile = await ctx.db.query('twitchProfiles').withIndex('twitchId', q => q.eq('twitchId', account.accountId)).unique()
  if (!profile) throw new Error('Validated Twitch profile is required')
  const existing = await ctx.db.query('providerWork').withIndex('accountId', q => q.eq('accountId', accountId)).unique()
  const fields = { accountId, userId: account.userId, twitchId: account.accountId, generation: (existing?.generation ?? 0) + 1,
    checkedAt: profile.validatedAt, validUntil: Math.min(profile.validatedAt + 3600000, profile.accessExpiresAt),
    dueAt: Math.max(Date.now(), Math.min(profile.validatedAt + INTERVAL, profile.accessExpiresAt - 300000)),
    claim: undefined, claimedUntil: undefined, failures: 0, revoked: false }
  const workId = existing?._id ?? await ctx.db.insert('providerWork', fields)
  if (existing) await ctx.db.patch(existing._id, fields)
  await ctx.scheduler.runAt(Math.max(Date.now(), fields.validUntil), internal.provider.expireAuthority, { workId })
} })

export const expireAuthority = internalMutation({ args: { workId: v.id('providerWork') }, handler: async (ctx, { workId }) => {
  const work = await ctx.db.get(workId)
  if (work && work.validUntil <= Date.now()) await ctx.db.patch(workId, { validUntil: 0 })
} })

async function deleteSession(ctx: MutationCtx, sessionId: string, userId: string) {
  await ctx.runMutation(components.betterAuth.adapter.deleteOne, { input: { model: 'session', where: [{ field: '_id', value: sessionId }] } })
  await ctx.runMutation(internal.provider.sessionRemoved, { sessionId, userId })
}
export const sessionTouched = internalMutation({ args: { sessionId: v.string(), expiresAt: v.number() }, handler: async (ctx, { sessionId, expiresAt }) => {
  await ctx.scheduler.runAt(Math.max(Date.now(), expiresAt), internal.provider.expireSession, { sessionId })
} })
export const expireSession = internalMutation({ args: { sessionId: v.string() }, handler: async (ctx, { sessionId }) => {
  const session = await ctx.runQuery(components.betterAuth.adapter.findOne, { model: 'session', where: [{ field: '_id', value: sessionId }] })
  if (session && session.expiresAt <= Date.now()) await deleteSession(ctx, sessionId, session.userId)
} })
export const sessionRemoved = internalMutation({ args: { sessionId: v.string(), userId: v.string() }, handler: async (ctx, { sessionId, userId }) => {
  const pending = await ctx.db.query('pendingChoices').withIndex('sessionId', q => q.eq('sessionId', sessionId)).unique()
  if (pending) await ctx.db.delete(pending._id)
  // Use the existing userId index; adding an expiresAt predicate makes the
  // adapter fall back to a global scan that findOne may stop prematurely.
  const now = Date.now()
  let cursor: string | null = null
  for (;;) {
    const sessions: { page: { expiresAt: number }[]; isDone: boolean; continueCursor: string } = await ctx.runQuery(components.betterAuth.adapter.findMany, {
      model: 'session', where: [{ field: 'userId', value: userId }],
      paginationOpts: { cursor, numItems: 50 },
    })
    if (sessions.page.some(session => session.expiresAt > now)) return
    if (sessions.isDone) break
    cursor = sessions.continueCursor
  }
  const account = await ctx.runQuery(components.betterAuth.adapter.findOne, { model: 'account', where: [{ field: 'userId', value: userId }, { field: 'providerId', value: 'twitch' }] })
  if (!account) return
  const work = await ctx.db.query('providerWork').withIndex('accountId', q => q.eq('accountId', account._id)).unique()
  if (work) await ctx.db.patch(work._id, { revoked: true, generation: work.generation + 1, dueAt: NEVER, validUntil: 0, claim: undefined, claimedUntil: undefined })
  await ctx.runMutation(components.betterAuth.adapter.updateOne, { input: { model: 'account', where: [{ field: '_id', value: account._id }], update: { accessToken: null, refreshToken: null, accessTokenExpiresAt: null, refreshTokenExpiresAt: null } } })
} })

export const sweep = internalMutation({ args: {}, handler: async ctx => {
  if (!isReady()) return
  const now = Date.now()
  const due = await ctx.db.query('providerWork').withIndex('dueAt', q => q.lte('dueAt', now)).take(25)
  for (const work of due) {
    if (work.revoked || (work.claimedUntil ?? 0) > now) continue
    const claim = crypto.randomUUID()
    await ctx.db.patch(work._id, { claim, claimedUntil: now + LEASE, dueAt: now + LEASE })
    await ctx.scheduler.runAfter(0, internal.provider.maintain, { workId: work._id, claim })
  }
  const expired = await ctx.runQuery(components.betterAuth.adapter.findMany, { model: 'session', where: [{ field: 'expiresAt', operator: 'lte', value: now }], paginationOpts: { cursor: null, numItems: 50 } })
  for (const session of expired.page) await deleteSession(ctx, session._id, session.userId)
  const verifications = await ctx.runQuery(components.betterAuth.adapter.findMany, { model: 'verification', where: [{ field: 'expiresAt', operator: 'lte', value: now }], paginationOpts: { cursor: null, numItems: 50 } })
  for (const entry of verifications.page) await ctx.runMutation(components.betterAuth.adapter.deleteOne, { input: { model: 'verification', where: [{ field: '_id', value: entry._id }] } })
  console.info('provider_sweep', { due: due.length,
    oldestDueSeconds: due.length ? Math.max(0, Math.floor((now - due[0].dueAt) / 1000)) : 0,
    oldestDueValidationSeconds: due.length ? Math.floor((now - Math.min(...due.map(work => work.checkedAt))) / 1000) : 0 })
} })

type Snapshot = { twitchId: string; generation: number; accessToken: string; refreshToken: string | null; expiresAt: number }
export const snapshot = internalQuery({ args: claimArgs, handler: async (ctx, { workId, claim }): Promise<Snapshot | null> => {
  if (!isReady()) return null
  const work = await ctx.db.get(workId)
  if (!work || work.revoked || work.claim !== claim || (work.claimedUntil ?? 0) <= Date.now()) return null
  const account = await ctx.runQuery(components.betterAuth.adapter.findOne, { model: 'account', where: [{ field: '_id', value: work.accountId }] })
  if (!account?.accessToken) return null
  return { twitchId: work.twitchId, generation: work.generation, accessToken: account.accessToken, refreshToken: account.refreshToken ?? null, expiresAt: account.accessTokenExpiresAt ?? 0 }
} })

export const finish = internalMutation({ args: { ...claimArgs, generation: v.number(), expectedAccess: v.string(), expectedRefresh: v.union(v.string(), v.null()),
  result: v.union(v.object({ kind: v.literal('success'), accessToken: v.string(), refreshToken: v.union(v.string(), v.null()), checkedAt: v.number(), expiresAt: v.number() }), v.object({ kind: v.literal('retry') }), v.object({ kind: v.literal('revoke') })) }, handler: async (ctx, args) => {
  if (!isReady()) return false
  const work = await ctx.db.get(args.workId)
  if (!work || work.revoked || work.claim !== args.claim || work.generation !== args.generation) return false
  const account = await ctx.runQuery(components.betterAuth.adapter.findOne, { model: 'account', where: [{ field: '_id', value: work.accountId }] })
  if (!account || account.accessToken !== args.expectedAccess || (account.refreshToken ?? null) !== args.expectedRefresh) {
    await ctx.db.patch(work._id, { dueAt: Date.now(), claim: undefined, claimedUntil: undefined }); return false
  }
  if (args.result.kind === 'retry') {
    const failures = work.failures + 1
    await ctx.db.patch(work._id, { failures, dueAt: Date.now() + Math.min(300000, 10000 * 2 ** Math.min(failures, 5)), claim: undefined, claimedUntil: undefined })
    console.warn('provider_retry', { failures }); return true
  }
  if (args.result.kind === 'revoke') {
    const invalidatedBefore = Date.now()
    await ctx.db.patch(work._id, { revoked: true, generation: work.generation + 1, invalidatedBefore, validUntil: 0, dueAt: NEVER, claim: undefined, claimedUntil: undefined })
    await ctx.runMutation(components.betterAuth.adapter.updateOne, { input: { model: 'account', where: [{ field: '_id', value: account._id }], update: { accessToken: null, refreshToken: null, accessTokenExpiresAt: null, refreshTokenExpiresAt: null } } })
    await ctx.scheduler.runAfter(0, internal.provider.revokeSessions, { userId: work.userId, invalidatedBefore })
    console.warn('provider_authorization_lost'); return true
  }
  const { checkedAt, expiresAt, accessToken, refreshToken } = args.result
  await ctx.runMutation(components.betterAuth.adapter.updateOne, { input: { model: 'account', where: [{ field: '_id', value: account._id }], update: { accessToken, refreshToken, accessTokenExpiresAt: expiresAt, updatedAt: Date.now() } } })
  await ctx.db.patch(work._id, { checkedAt, validUntil: Math.min(checkedAt + 3600000, expiresAt), failures: 0, dueAt: Math.max(Date.now() + 60000, Math.min(checkedAt + INTERVAL, expiresAt - 300000)), claim: undefined, claimedUntil: undefined })
  await ctx.scheduler.runAt(Math.max(Date.now(), Math.min(checkedAt + 3600000, expiresAt)), internal.provider.expireAuthority, { workId: work._id })
  return true
} })
export const revokeSessions = internalMutation({ args: { userId: v.string(), invalidatedBefore: v.number(), cursor: v.optional(v.string()) }, handler: async (ctx, { userId, invalidatedBefore, cursor }) => {
  const sessions = await ctx.runQuery(components.betterAuth.adapter.findMany, { model: 'session', where: [{ field: 'userId', value: userId }], paginationOpts: { cursor: cursor ?? null, numItems: 50 } })
  // The component indexes userId, but not createdAt. Filter each bounded page;
  // never add unsupported range predicates to the adapter or delete new logins.
  for (const session of sessions.page) if (session.createdAt <= invalidatedBefore) await deleteSession(ctx, session._id, session.userId)
  if (!sessions.isDone) await ctx.scheduler.runAfter(0, internal.provider.revokeSessions, { userId, invalidatedBefore, cursor: sessions.continueCursor })
} })

class LostAuthorization extends Error {}
export const maintain = internalAction({ args: claimArgs, handler: async (ctx, args): Promise<void> => {
  const current: Snapshot | null = await ctx.runQuery(internal.provider.snapshot, args)
  if (!current) return
  const key = process.env.BETTER_AUTH_SECRET!
  try {
    let access = await symmetricDecrypt({ key, data: current.accessToken })
    let refresh = current.refreshToken ? await symmetricDecrypt({ key, data: current.refreshToken }) : null
    async function refreshAccess() {
      if (!refresh) throw new LostAuthorization()
      const response = await fetch('https://id.twitch.tv/oauth2/token', { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(5000), headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refresh, client_id: process.env.TWITCH_CLIENT_ID!, client_secret: process.env.TWITCH_CLIENT_SECRET! }) })
      if (response.status === 400 || response.status === 401) throw new LostAuthorization()
      if (!response.ok) throw new Error('Provider unavailable')
      const tokens = await response.json() as { access_token?: string; refresh_token?: string }
      if (!tokens.access_token || !tokens.refresh_token) throw new Error('Invalid provider response')
      access = tokens.access_token; refresh = tokens.refresh_token
    }
    if (current.expiresAt <= Date.now() + 300000) await refreshAccess()
    let validated
    try { validated = await validateTwitchGrant(access, process.env.TWITCH_CLIENT_ID!) }
    catch (error) {
      if (!(error instanceof Error) || error.message !== 'TWITCH_UNAUTHORIZED') throw error
      await refreshAccess(); validated = await validateTwitchGrant(access, process.env.TWITCH_CLIENT_ID!)
    }
    if (validated.twitchId !== current.twitchId) throw new LostAuthorization()
    await ctx.runMutation(internal.provider.finish, { ...args, generation: current.generation, expectedAccess: current.accessToken, expectedRefresh: current.refreshToken,
      result: { kind: 'success', accessToken: await symmetricEncrypt({ key, data: access }), refreshToken: refresh ? await symmetricEncrypt({ key, data: refresh }) : null, checkedAt: validated.validatedAt, expiresAt: validated.accessExpiresAt } })
  } catch (error) {
    await ctx.runMutation(internal.provider.finish, { ...args, generation: current.generation, expectedAccess: current.accessToken, expectedRefresh: current.refreshToken,
      result: { kind: error instanceof LostAuthorization || error instanceof Error && ['TWITCH_UNAUTHORIZED', 'TWITCH_INVALID_AUTHORIZATION'].includes(error.message) ? 'revoke' : 'retry' } })
  }
} })

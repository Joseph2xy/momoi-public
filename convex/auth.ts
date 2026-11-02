import { betterAuth } from 'better-auth/minimal'
import { APIError, createAuthMiddleware, getOAuthState } from 'better-auth/api'
import { createClient } from '@convex-dev/better-auth'
import { convex } from '@convex-dev/better-auth/plugins'
import type { DataModel } from './_generated/dataModel'
import type { ActionCtx } from './_generated/server'
import { components, internal } from './_generated/api'
import authConfig from './auth.config'
import { readTwitchProfile, TwitchProfileError } from './twitch'

export const authComponent = createClient<DataModel>(components.betterAuth)

export const createAuth = (ctx: ActionCtx) => {
  // After-transaction database hooks run outside Better Auth's request state.
  // Capture the verified OAuth context before creation, scoped to this request.
  let pendingChoice: { gameId: string; roundId: string } | undefined
  return betterAuth({
  baseURL: process.env.SITE_URL!,
  secret: process.env.BETTER_AUTH_SECRET!,
  database: authComponent.adapter(ctx),
  trustedOrigins: [process.env.SITE_URL!],
  // State failures can occur before the per-flow errorCallbackURL is recovered.
  onAPIError: { errorURL: `${process.env.SITE_URL!}/` },
  logger: { disabled: true }, // Never log provider errors containing callback/token data.
  advanced: { useSecureCookies: true, cookiePrefix: 'momoi-convex', defaultCookieAttributes: { httpOnly: true, secure: true, sameSite: 'lax', path: '/' } },
  session: { expiresIn: 30 * 86400, updateAge: 86400, cookieCache: { enabled: false } },
  account: {
    encryptOAuthTokens: true,
    storeStateStrategy: 'database',
    accountLinking: { enabled: false, disableImplicitLinking: true },
  },
  socialProviders: {
    twitch: {
      clientId: process.env.TWITCH_CLIENT_ID!, clientSecret: process.env.TWITCH_CLIENT_SECRET!,
      disableDefaultScope: true, scope: ['user:read:email'],
      getUserInfo: async tokens => {
        if (!tokens.accessToken) {
          console.warn('twitch_sign_in_failed', { stage: 'token_validation', reason: 'missing_access_token' })
          return null
        }
        const startedAt = Date.now()
        let stage: 'profile_read' | 'profile_persistence' = 'profile_read'
        try {
          const { profile, createdAt, validatedAt, accessExpiresAt } = await readTwitchProfile(tokens.accessToken, process.env.TWITCH_CLIENT_ID!)
          stage = 'profile_persistence'
          await ctx.runMutation(internal.twitch.rememberProfile, { twitchId: profile.id, login: profile.login, createdAt, validatedAt, accessExpiresAt, displayName: profile.display_name, image: profile.profile_image_url })
          return { user: { id: profile.id, name: profile.display_name, email: profile.email, emailVerified: false, image: profile.profile_image_url }, data: profile }
        } catch (error) {
          // Never log the error object/message, provider payload, or credentials.
          console.warn('twitch_sign_in_failed', {
            stage: error instanceof TwitchProfileError ? error.stage : stage,
            reason: error instanceof TwitchProfileError ? error.reason : 'unexpected_error',
            ...(error instanceof TwitchProfileError && error.status !== undefined ? { status: error.status } : {}),
            durationMs: Date.now() - startedAt,
          })
          return null
        }
      },
    },
  },
  hooks: {
    before: createAuthMiddleware(async context => {
      if (context.path !== '/sign-in/social') return
      if (context.body?.provider !== 'twitch' || context.body?.idToken) throw new APIError('BAD_REQUEST', { message: 'Use Twitch sign-in' })
      const extra = context.body?.additionalData
      if (extra) {
        const pending = extra.pendingChoice
        if (Object.keys(extra).some(key => key !== 'pendingChoice') || !pending ||
            Object.keys(pending).some(key => !['gameId', 'roundId'].includes(key)) ||
            ![pending.gameId, pending.roundId].every(value => typeof value === 'string' && value.length > 0 && value.length <= 128)) {
          throw new APIError('BAD_REQUEST', { message: 'Invalid pending choice' })
        }
      }
    }),
  },
  databaseHooks: {
    account: {
      create: { after: async account => { if (account.providerId === 'twitch') await ctx.runMutation(internal.provider.register, { accountId: account.id }) } },
      update: { after: async account => { if (account.providerId === 'twitch') await ctx.runMutation(internal.provider.register, { accountId: account.id }) } },
    },
    session: { create: { before: async () => {
      pendingChoice = (await getOAuthState())?.pendingChoice as typeof pendingChoice
    }, after: async session => {
      if (pendingChoice) await ctx.runMutation(internal.pending.remember, { sessionId: session.id, ...pendingChoice })
      await ctx.runMutation(internal.provider.sessionTouched, { sessionId: session.id, expiresAt: new Date(session.expiresAt).getTime() })
    } }, update: { after: async session => { await ctx.runMutation(internal.provider.sessionTouched, { sessionId: session.id, expiresAt: new Date(session.expiresAt).getTime() }) } },
    delete: { after: async session => { await ctx.runMutation(internal.provider.sessionRemoved, { sessionId: session.id, userId: session.userId }) } } },
  },
  plugins: [convex({ authConfig, jwt: { expirationSeconds: 300, definePayload: () => ({}) } })],
  })
}

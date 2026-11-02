import { internalMutation } from './_generated/server'
import { v } from 'convex/values'
import { requireReady } from './operations'

export const rememberProfile = internalMutation({
  args: { twitchId: v.string(), login: v.string(), createdAt: v.number(), validatedAt: v.number(), accessExpiresAt: v.number(), displayName: v.optional(v.string()), image: v.optional(v.string()) },
  handler: async (ctx, profile) => {
    requireReady()
    const existing = await ctx.db.query('twitchProfiles').withIndex('twitchId', q => q.eq('twitchId', profile.twitchId)).unique()
    if (existing) await ctx.db.patch(existing._id, profile)
    else await ctx.db.insert('twitchProfiles', profile)
  },
})

// Identity comes from validated access + Helix, never an unverified ID token,
// email, browser profile, or Better Auth's local account creation date.
type TwitchStage = 'token_validation' | 'profile_lookup'
type TwitchFailure = 'timeout' | 'network_error' | 'unauthorized' | 'http_error' | 'invalid_json' |
  'client_mismatch' | 'invalid_subject' | 'invalid_expiry' | 'missing_email_scope' |
  'invalid_profile' | 'subject_mismatch' | 'missing_email' | 'invalid_creation_time'

// Only fixed classifications and HTTP status may enter sign-in logs.
// Keep the existing authorization messages used by provider maintenance.
export class TwitchProfileError extends Error {
  constructor(readonly stage: TwitchStage, readonly reason: TwitchFailure, message: string = reason, readonly status?: number) {
    super(message)
  }
}

async function twitchJson<T>(url: string, headers: Record<string, string>, stage: TwitchStage): Promise<T> {
  let response: Response
  try {
    response = await fetch(url, { headers, redirect: 'error', signal: AbortSignal.timeout(5000) })
  } catch (error) {
    const timeout = error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name)
    throw new TwitchProfileError(stage, timeout ? 'timeout' : 'network_error')
  }
  if (response.status === 401) throw new TwitchProfileError(stage, 'unauthorized', 'TWITCH_UNAUTHORIZED', response.status)
  if (!response.ok) throw new TwitchProfileError(stage, 'http_error', 'Twitch request failed', response.status)
  try {
    return await response.json() as T
  } catch (error) {
    const timeout = error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name)
    throw new TwitchProfileError(stage, timeout ? 'timeout' : 'invalid_json', undefined, response.status)
  }
}

export async function validateTwitchGrant(accessToken: string, clientId: string) {
  const grant = await twitchJson<{ client_id?: string; user_id?: string; expires_in?: number; scopes?: string[] } | null>(
    'https://id.twitch.tv/oauth2/validate', { Authorization: `OAuth ${accessToken}` }, 'token_validation')
  const invalidGrant: (reason: TwitchFailure) => never = reason => { throw new TwitchProfileError('token_validation', reason, 'TWITCH_INVALID_AUTHORIZATION') }
  if (!grant || grant.client_id !== clientId) invalidGrant('client_mismatch')
  if (typeof grant.user_id !== 'string' || !/^\d+$/.test(grant.user_id)) invalidGrant('invalid_subject')
  if (!Number.isFinite(grant.expires_in) || grant.expires_in! <= 0) invalidGrant('invalid_expiry')
  if (!Array.isArray(grant.scopes) || !grant.scopes.includes('user:read:email')) invalidGrant('missing_email_scope')
  const validatedAt = Date.now()
  return { twitchId: grant.user_id!, validatedAt, accessExpiresAt: validatedAt + grant.expires_in! * 1000 }
}

export async function readTwitchProfile(accessToken: string, clientId: string) {
  const grant = await validateTwitchGrant(accessToken, clientId)
  const result = await twitchJson<{ data?: Array<{ id: string; login: string; display_name: string; email: string; profile_image_url: string; created_at: string }> } | null>(
    'https://api.twitch.tv/helix/users', { Authorization: `Bearer ${accessToken}`, 'Client-Id': clientId }, 'profile_lookup')
  const data = result?.data
  if (!Array.isArray(data) || data.length !== 1 || !data[0]?.login) throw new TwitchProfileError('profile_lookup', 'invalid_profile')
  const profile = data[0]
  if (profile.id !== grant.twitchId) throw new TwitchProfileError('profile_lookup', 'subject_mismatch')
  if (!profile.email) throw new TwitchProfileError('profile_lookup', 'missing_email')
  const createdAt = Date.parse(profile.created_at ?? '')
  if (!Number.isFinite(createdAt) || createdAt > Date.now()) throw new TwitchProfileError('profile_lookup', 'invalid_creation_time')
  return { profile, createdAt, validatedAt: grant.validatedAt, accessExpiresAt: grant.accessExpiresAt }
}

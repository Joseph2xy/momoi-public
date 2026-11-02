import { httpRouter } from 'convex/server'
import { httpAction } from './_generated/server'
import { createAuth } from './auth'
import { splitSetCookieHeader } from 'better-auth/cookies'
import { isReady } from './operations'
import { device } from './playbackHttp'

const http = httpRouter()
const allowed = new Map([
  ['/sign-in/social', 'POST'], ['/callback/twitch', 'GET'], ['/get-session', 'GET'],
  ['/sign-out', 'POST'], ['/convex/token', 'GET'], ['/convex/jwks', 'GET'],
])

// Enforce at the backend too: bypassing the same-origin proxy must not expose
// Better Auth's get-access-token, refresh-token, account linking or bearer login.
export const authHandler = httpAction(async (ctx, request) => {
  const path = new URL(request.url).pathname.slice('/api/auth'.length)
  const headers = { 'Cache-Control': 'no-store' }
  if (allowed.get(path) !== request.method) return new Response('Not found', { status: 404, headers })
  if (request.headers.has('authorization')) return new Response('Cookie required', { status: 403, headers })
  if (request.method === 'POST' && request.headers.get('origin') !== process.env.SITE_URL) return new Response('Forbidden origin', { status: 403, headers })
  if (!isReady()) return new Response('Temporarily unavailable', { status: 503, headers })
  const response = await createAuth(ctx).handler(request)
  response.headers.set('Cache-Control', 'no-store')
  response.headers.delete('set-auth-token')
  // The integration also caches its JWT in a cookie for SSR by default. This
  // slice uses client-only private reads, so retain only the root/flow cookies.
  const cookies = splitSetCookieHeader(response.headers.get('set-cookie') ?? '')
  response.headers.delete('set-cookie')
  for (const cookie of cookies) {
    if (!/^(?:__Secure-)?momoi-convex\.convex_jwt=/.test(cookie)) response.headers.append('set-cookie', cookie)
  }
  if (path === '/get-session' && response.ok) {
    const data = await response.json() as { session?: { token?: string } } | null
    // Better Auth's default response includes the root bearer session token.
    // The React bridge needs session metadata, never that credential.
    if (data?.session) delete data.session.token
    return Response.json(data, { status: response.status, headers: response.headers })
  }
  return response
})
http.route({ pathPrefix: '/api/auth/', method: 'GET', handler: authHandler })
http.route({ pathPrefix: '/api/auth/', method: 'POST', handler: authHandler })
http.route({ path: '/playback/pair', method: 'POST', handler: device })
http.route({ path: '/playback/sync', method: 'POST', handler: device })
export default http

import { ConvexError } from 'convex/values'
import { httpAction } from './_generated/server'
import { internal } from './_generated/api'
import { digest } from './playback'
import { isReady } from './operations'

const headers = { 'Cache-Control': 'no-store', 'Content-Type': 'application/json' }
const secret = /^[a-f0-9]{64}$/

export const device = httpAction(async (ctx, request) => {
  if (!isReady()) return new Response('{"error":"Playback is temporarily unavailable."}', { status: 503, headers })
  // Extension workers use host permissions. No cookies, root sessions or website CORS.
  if (request.headers.get('content-type')?.split(';')[0] !== 'application/json') return new Response(null, { status: 415, headers })
  try {
    const text = await request.text()
    if (text.length > 4096) return new Response(null, { status: 413, headers })
    const body = JSON.parse(text)
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Invalid body')
    if (body.protocolVersion !== 4) return Response.json({ error: 'Update the Momoi Playback extension before connecting.' }, { status: 426, headers })
    if (new URL(request.url).pathname === '/playback/pair') {
      if (Object.keys(body).some(key => !['protocolVersion', 'code', 'token'].includes(key))) throw new Error('Invalid pairing')
      if (typeof body.code !== 'string' || !/^[a-f0-9]{32}$/.test(body.code) || typeof body.token !== 'string' || !secret.test(body.token)) throw new Error('Invalid pairing')
      const result = await ctx.runMutation(internal.playback.pair, { codeHash: await digest(body.code), tokenHash: await digest(body.token) })
      return Response.json(result, { headers })
    }
    const token = request.headers.get('authorization')?.replace(/^Bearer /, '')
    if (!token || !secret.test(token)) return Response.json({ error: 'Device authorization required.' }, { status: 401, headers })
    if (Object.keys(body).some(key => !['protocolVersion', 'report', 'knownSequenceId', 'observationId', 'retryResult'].includes(key))) throw new Error('Invalid body')
    const result = await ctx.runMutation(internal.playback.sync, {
      tokenHash: await digest(token), ...(body.report !== undefined ? { report: body.report } : {}),
      ...(body.knownSequenceId !== undefined ? { knownSequenceId: body.knownSequenceId } : {}),
      ...(body.observationId !== undefined ? { observationId: body.observationId } : {}),
      ...(body.retryResult !== undefined ? { retryResult: body.retryResult } : {}),
    })
    return Response.json(result, { headers })
  } catch (error) {
    const denied = error instanceof ConvexError && ['DEVICE_DENIED', 'PAIRING_DENIED'].includes(String(error.data))
    return Response.json({ error: denied ? 'Pairing expired or device access was revoked.' : 'Playback request was not accepted.' }, { status: denied ? 401 : 400, headers })
  }
})

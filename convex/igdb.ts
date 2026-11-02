import { ConvexError } from 'convex/values'

export type IgdbGame = {
  igdbId: number; name: string; slug: string; coverUrl: string | null
  year: number | null; platforms: string[]; aliases: string[]
}

// Best-effort reuse in a warm action isolate. This is an application token,
// never a user's OAuth grant, and correctness does not depend on this cache.
let cached: { clientId: string; secret: string; token: string; expiresAt: number } | undefined

export async function lookupGames(expression: string): Promise<IgdbGame[]> {
  const clientId = process.env.TWITCH_CLIENT_ID
  const secret = process.env.TWITCH_CLIENT_SECRET
  if (!clientId || !secret) throw new ConvexError('IGDB_NOT_CONFIGURED')
  try {
    if (!cached || cached.clientId !== clientId || cached.secret !== secret || cached.expiresAt <= Date.now()) {
      const response = await fetch('https://id.twitch.tv/oauth2/token', {
        method: 'POST', body: new URLSearchParams({ client_id: clientId, client_secret: secret, grant_type: 'client_credentials' }),
        redirect: 'error', signal: AbortSignal.timeout(5000),
      })
      if (!response.ok) throw new Error('token unavailable')
      const token = await response.json() as { access_token?: string; expires_in?: number }
      if (typeof token.access_token !== 'string' || !token.access_token || typeof token.expires_in !== 'number' || token.expires_in <= 60) throw new Error('invalid token')
      cached = { clientId, secret, token: token.access_token, expiresAt: Date.now() + (token.expires_in - 60) * 1000 }
    }
    const response = await fetch('https://api.igdb.com/v4/games', {
      method: 'POST', headers: { 'Client-ID': clientId, Authorization: `Bearer ${cached.token}`, 'Content-Type': 'text/plain' },
      body: `fields name,slug,cover.image_id,first_release_date,platforms.name,alternative_names.name; ${expression}`,
      redirect: 'error', signal: AbortSignal.timeout(8000),
    })
    if (response.status === 401) cached = undefined
    if (response.status === 429) throw new ConvexError('IGDB_RATE_LIMITED')
    if (!response.ok) throw new Error('lookup unavailable')
    const body: unknown = await response.json()
    if (!Array.isArray(body)) throw new Error('invalid games')
    return body.map((game): IgdbGame => {
      if (!Number.isSafeInteger(game.id) || game.id <= 0 || typeof game.name !== 'string' || !game.name.trim() || typeof game.slug !== 'string' || !/^[a-z0-9-]+$/.test(game.slug)) throw new Error('invalid game')
      const imageId = game.cover?.image_id
      const year = typeof game.first_release_date === 'number' ? new Date(game.first_release_date * 1000).getUTCFullYear() : NaN
      const names = (items: unknown): string[] => Array.isArray(items) ? items.flatMap(item => typeof item?.name === 'string' ? [item.name] : []) : []
      return { igdbId: game.id, name: game.name.trim(), slug: game.slug,
        coverUrl: typeof imageId === 'string' && /^[a-zA-Z0-9_]+$/.test(imageId) ? `https://images.igdb.com/igdb/image/upload/t_cover_big/${imageId}.jpg` : null,
        year: Number.isFinite(year) ? year : null, platforms: names(game.platforms), aliases: names(game.alternative_names) }
    })
  } catch (error) {
    if (error instanceof ConvexError) throw error
    // Do not leak provider responses, request details or credentials.
    throw new ConvexError('IGDB_UNAVAILABLE')
  }
}

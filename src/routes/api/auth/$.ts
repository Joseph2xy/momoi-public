import { createFileRoute } from '@tanstack/react-router'
import { convexBetterAuthReactStart } from '@convex-dev/better-auth/react-start'

async function handle(request: Request) {
  const convexUrl = import.meta.env.VITE_CONVEX_URL
  const convexSiteUrl = import.meta.env.VITE_CONVEX_SITE_URL
  if (!convexUrl || !convexSiteUrl) return new Response('Authentication is not configured', { status: 503 })
  return convexBetterAuthReactStart({ convexUrl, convexSiteUrl }).handler(request)
}

export const Route = createFileRoute('/api/auth/$')({
  server: { handlers: { GET: ({ request }) => handle(request), POST: ({ request }) => handle(request) } },
})

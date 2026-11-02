import { useState, type ReactNode } from 'react'
import { ConvexReactClient } from 'convex/react'
import { ConvexBetterAuthProvider, type AuthClient } from '@convex-dev/better-auth/react'
import { convexClient } from '@convex-dev/better-auth/client/plugins'
import { createAuthClient } from 'better-auth/react'

export const authClient = createAuthClient({ plugins: [convexClient()] })
// Adapter 0.12.5's exported client type intersects a plugin with client options,
// inferring useSession().data as never with Better Auth 1.6.30 / TS 6.
// Keep the upstream type workaround at this boundary; the real client remains typed.
const bridgeAuthClient = authClient as unknown as AuthClient

export function ConvexAuthRoot({ children }: { children: ReactNode }) {
  const [client] = useState(() => new ConvexReactClient(import.meta.env.VITE_CONVEX_URL))
  return <ConvexBetterAuthProvider client={client} authClient={bridgeAuthClient}>{children}</ConvexBetterAuthProvider>
}

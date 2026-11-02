import { HeadContent, Outlet, Scripts, createRootRoute } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import appCss from '../styles.css?url'
import { AppStateProvider } from '../client/app-state'
import { PageFrame } from '../components/shared'
import { ConvexAuthRoot } from '../client/convex-auth'

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'momoi' },
    ],
    links: [{ rel: 'stylesheet', href: appCss }, { rel: 'icon', type: 'image/webp', href: '/brand/momoi.webp' }],
  }),
  shellComponent: RootDocument,
  component: RootContent,
})

function RootContent() {
  return <AppStateProvider><PageFrame><Outlet /></PageFrame></AppStateProvider>
}

function RootDocument({ children }: { children: ReactNode }) {
  return <html lang="en"><head><HeadContent /></head><body><ConvexAuthRoot>{children}</ConvexAuthRoot><Scripts /></body></html>
}

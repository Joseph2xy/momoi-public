import { cloudflare } from '@cloudflare/vite-plugin'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), 'VITE_'), ...process.env }
  for (const name of ['VITE_CONVEX_URL', 'VITE_CONVEX_SITE_URL']) {
    if (!env[name]) throw new Error(`Set ${name} before starting or building Momoi.`)
  }
  return {
    server: { watch: { ignored: ['**/.wrangler/**'] } },
    ssr: { noExternal: ['@convex-dev/better-auth'] },
    resolve: { tsconfigPaths: true },
    plugins: [
      cloudflare({ viteEnvironment: { name: 'ssr' } }),
      tanstackStart(),
      react(),
    ],
  }
})

import { build } from 'esbuild'
import { copyFile, mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const root = new URL('../', import.meta.url)
const output = new URL('extension/dist/', root)
await mkdir(output, { recursive: true })
await build({
  absWorkingDir: fileURLToPath(root),
  entryPoints: ['extension/src/background.ts', 'extension/src/content.ts', 'extension/src/control.ts'],
  outdir: fileURLToPath(output), bundle: true, platform: 'browser',
  format: 'iife', target: 'chrome120', sourcemap: false, logLevel: 'info',
})
for (const file of ['manifest.json', 'control.html', 'control.css']) {
  await copyFile(new URL(`extension/${file}`, root), new URL(file, output))
}
await mkdir(new URL('assets/', output), { recursive: true })
for (const size of [16, 32, 48, 128]) {
  const file = `icon-${size}.png`
  await copyFile(new URL(`extension/assets/${file}`, root), new URL(`assets/${file}`, output))
}

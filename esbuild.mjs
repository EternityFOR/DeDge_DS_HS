import esbuild from 'esbuild'
import { rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const watch = process.argv.includes('--watch')
const root = dirname(fileURLToPath(import.meta.url))
const dist = join(root, 'dist')

await Promise.all([
  'extension.cjs',
  'extension.cjs.map',
  'webview.js',
  'webview.js.map',
].map(file => rm(join(dist, file), { force: true })))

const extension = {
  absWorkingDir: root,
  entryPoints: ['src/extension.ts'],
  outfile: 'dist/extension.cjs',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  minify: !watch,
  sourcemap: watch,
  sourcesContent: false,
  external: ['vscode'],
  define: { 'process.env.NODE_ENV': JSON.stringify(watch ? 'development' : 'production') },
  logLevel: 'info',
}

const webview = {
  absWorkingDir: root,
  entryPoints: ['src/ui/webview/main.ts'],
  outfile: 'dist/webview.js',
  bundle: true,
  platform: 'browser',
  format: 'iife',
  target: ['es2022'],
  minify: !watch,
  sourcemap: watch,
  sourcesContent: false,
  logLevel: 'info',
}

if (watch) {
  const [extensionContext, webviewContext] = await Promise.all([
    esbuild.context(extension),
    esbuild.context(webview),
  ])
  await Promise.all([extensionContext.watch(), webviewContext.watch()])
  console.log('Watching extension and webview bundles')
} else {
  await Promise.all([esbuild.build(extension), esbuild.build(webview)])
}

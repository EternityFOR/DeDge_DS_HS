import { rmSync } from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const groups = {
  temp: ['.tmp', '.playwright-cli', '.vscode-test', 'coverage', 'output', 'test-results'],
  build: ['.tmp', '.playwright-cli', '.vscode-test', 'coverage', 'output', 'test-results', 'dist', 'out'],
  dependencies: ['.tmp', '.playwright-cli', '.vscode-test', 'coverage', 'output', 'test-results', 'dist', 'out', 'node_modules', '.pnpm-store'],
}

const mode = process.argv[2] ?? 'temp'
const targets = groups[mode]
if (targets === undefined) throw new Error(`Unknown clean mode: ${mode}`)

for (const relative of targets) {
  const target = path.resolve(root, relative)
  if (!target.startsWith(`${root}${path.sep}`)) throw new Error(`Refusing to clean outside the repository: ${target}`)
  rmSync(target, { force: true, maxRetries: 3, recursive: true, retryDelay: 100 })
}

console.log(`Cleaned ${mode} outputs: ${targets.join(', ')}`)

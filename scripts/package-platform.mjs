import { spawnSync } from 'node:child_process'
import { accessSync, constants, mkdirSync, readFileSync, rmSync } from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { auditVsix } from './audit-vsix.mjs'

const targets = new Set(['win32-x64', 'win32-arm64', 'linux-x64', 'linux-arm64', 'darwin-x64', 'darwin-arm64'])
const target = `${process.platform}-${process.arch}`
if (!targets.has(target)) throw new Error(`Unsupported VSIX target: ${target}`)

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
const outputDir = path.join(root, 'out')
mkdirSync(outputDir, { recursive: true })
const output = path.join(outputDir, `${manifest.name}-${manifest.version}-${target}.vsix`)
const vsce = path.join(root, 'node_modules', '@vscode', 'vsce', 'vsce')
accessSync(vsce, constants.R_OK)
rmSync(output, { force: true })
run(process.execPath, [vsce, 'package', '--no-dependencies', '--target', target, '--allow-missing-repository', '--out', output])
auditVsix(output, target)
console.log(output)

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', windowsHide: true })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}

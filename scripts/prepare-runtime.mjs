import { spawnSync } from 'node:child_process'
import { accessSync, constants, copyFileSync, cpSync, existsSync, lstatSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
const platformKey = `${process.platform}-${process.arch}`
const supported = new Set(['win32-x64', 'win32-arm64', 'linux-x64', 'linux-arm64', 'darwin-x64', 'darwin-arm64'])
if (!supported.has(platformKey)) throw new Error(`Unsupported VSIX runtime target: ${platformKey}`)

const expectedDsh = dependencyVersion('@deepseek-ai/dsh')
const expectedNode = dependencyVersion('node')
const expectedPnpm = dependencyVersion('pnpm')
const sourcePnpm = path.join(root, 'node_modules', 'pnpm', 'bin', 'pnpm.mjs')
const nodeLicense = path.join(root, 'licenses', 'NODEJS-LICENSE.txt')
accessSync(sourcePnpm, constants.R_OK)
accessSync(nodeLicense, constants.R_OK)

const stageBase = path.join(root, '.tmp', 'package-runtime')
const stageParent = path.join(stageBase, `${platformKey}-${process.pid}-${Date.now()}`)
const stage = path.join(stageParent, 'install')
const runtimeRoot = path.join(root, 'dist', 'runtime')
mkdirSync(stage, { recursive: true })
for (const file of ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml']) {
  copyFileSync(path.join(root, file), path.join(stage, file))
}

runInherited(process.execPath, [
  sourcePnpm,
  '--dir', stage,
  'install',
  '--prod',
  '--frozen-lockfile',
  '--config.node-linker=hoisted',
])

const runtimeModules = path.join(stage, 'node_modules')
const node = path.join(runtimeModules, 'node', 'bin', process.platform === 'win32' ? 'node.exe' : 'node')
const nodeManifest = path.join(runtimeModules, 'node', 'package.json')
const dshManifest = path.join(runtimeModules, '@deepseek-ai', 'dsh', 'package.json')
const dshBin = path.join(runtimeModules, '@deepseek-ai', 'dsh', 'lib', 'bin.js')
const pnpm = path.join(runtimeModules, 'pnpm', 'bin', 'pnpm.mjs')
const pnpmManifest = path.join(runtimeModules, 'pnpm', 'package.json')
for (const file of [node, nodeManifest, dshManifest, dshBin, pnpm, pnpmManifest]) accessSync(file, constants.R_OK)
if (process.platform !== 'win32') accessSync(node, constants.X_OK)
for (const directory of [
  path.join(runtimeModules, '@deepseek-ai', 'dsh'),
  path.join(runtimeModules, 'node'),
  path.join(runtimeModules, 'pnpm'),
]) {
  if (lstatSync(directory).isSymbolicLink()) throw new Error(`Runtime deploy contains a symbolic link: ${directory}`)
}

const installedDsh = packageVersion(dshManifest)
const installedNode = packageVersion(nodeManifest)
const installedPnpm = packageVersion(pnpmManifest)
if (installedDsh !== expectedDsh) throw new Error(`DSH mismatch: expected ${expectedDsh}, installed ${installedDsh}`)
if (installedNode !== expectedNode) throw new Error(`Node package mismatch: expected ${expectedNode}, installed ${installedNode}`)
if (installedPnpm !== expectedPnpm) throw new Error(`pnpm package mismatch: expected ${expectedPnpm}, installed ${installedPnpm}`)

const nodeVersion = run(node, ['--version'])
if (nodeVersion.replace(/^v/u, '') !== expectedNode) {
  throw new Error(`Node executable mismatch: expected ${expectedNode}, reported ${nodeVersion}`)
}
const runtimeTarget = JSON.parse(run(node, ['-p', 'JSON.stringify({ platform: process.platform, arch: process.arch })']))
if (`${runtimeTarget.platform}-${runtimeTarget.arch}` !== platformKey) {
  throw new Error(`Bundled Node targets ${runtimeTarget.platform}-${runtimeTarget.arch}, expected ${platformKey}`)
}
const dshVersion = run(node, [dshBin, '--version']).replace(/^v/u, '')
if (dshVersion !== expectedDsh) throw new Error(`DSH executable mismatch: expected ${expectedDsh}, reported ${dshVersion}`)
const pnpmVersion = run(node, [pnpm, '--version'])
if (pnpmVersion !== expectedPnpm) throw new Error(`pnpm executable mismatch: expected ${expectedPnpm}, reported ${pnpmVersion}`)

for (const metadata of ['.modules.yaml', '.package-map.json', '.pnpm-workspace-state-v1.json', '.pnpm']) {
  rmSync(path.join(runtimeModules, metadata), { recursive: true, force: true })
}
for (const nodeShim of ['node', 'node.exe', 'node.cmd', 'node.ps1']) {
  rmSync(path.join(runtimeModules, '.bin', nodeShim), { force: true })
}
copyFileSync(nodeLicense, path.join(runtimeModules, 'node', 'LICENSE'))
const nodePtyPrebuilds = path.join(runtimeModules, 'node-pty', 'prebuilds')
const nodePtyTarget = process.platform === 'win32' || process.platform === 'darwin'
  ? `${process.platform}-${process.arch}`
  : undefined
for (const candidate of ['win32-x64', 'win32-arm64', 'darwin-x64', 'darwin-arm64']) {
  if (candidate !== nodePtyTarget) rmSync(path.join(nodePtyPrebuilds, candidate), { recursive: true, force: true })
}
for (const sourceDirectory of ['deps', 'scripts', 'src', 'third_party', 'typings']) {
  rmSync(path.join(runtimeModules, 'node-pty', sourceDirectory), { recursive: true, force: true })
}
if (nodePtyTarget !== undefined) rmSync(path.join(runtimeModules, 'node-pty', 'build'), { recursive: true, force: true })
rmSync(path.join(runtimeModules, 'node-pty', 'binding.gyp'), { force: true })
rmSync(path.join(runtimeModules, 'pnpm', 'artifacts'), { recursive: true, force: true })

const preparedRoot = path.join(stageParent, 'prepared-runtime')
cpSync(runtimeModules, path.join(preparedRoot, 'node_modules'), {
  recursive: true,
  dereference: true,
  force: true,
  preserveTimestamps: true,
})
mkdirSync(path.join(root, 'dist'), { recursive: true })
const previousRoot = path.join(stageParent, 'previous-runtime')
let previousMoved = false
if (existsSync(runtimeRoot)) {
  try {
    rmSync(runtimeRoot, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 })
  } catch {
    renameSync(runtimeRoot, previousRoot)
    previousMoved = true
  }
}
try {
  renameSync(preparedRoot, runtimeRoot)
} catch (error) {
  if (previousMoved && !existsSync(runtimeRoot) && existsSync(previousRoot)) renameSync(previousRoot, runtimeRoot)
  throw error
}
cleanupStage(stageParent)
writeFileSync(path.join(root, 'dist', 'runtime-manifest.json'), `${JSON.stringify({
  schemaVersion: 1,
  extension: manifest.version,
  platform: process.platform,
  arch: process.arch,
  dsh: dshVersion,
  node: nodeVersion,
  pnpm: pnpmVersion,
  runtimeRoot: 'dist/runtime',
}, null, 2)}\n`)
console.log(`Validated bundled runtime ${dshVersion} / ${nodeVersion} / pnpm ${pnpmVersion} for ${platformKey}`)

function cleanupStage(directory) {
  try {
    rmSync(directory, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 })
  } catch (error) {
    console.warn(`Runtime staging cleanup was deferred to ${directory}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function dependencyVersion(name) {
  const value = manifest.dependencies?.[name]
  if (typeof value !== 'string' || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(value)) {
    throw new Error(`Runtime dependency ${name} must use an exact version; found ${String(value)}`)
  }
  return value
}

function packageVersion(file) {
  const value = JSON.parse(readFileSync(file, 'utf8')).version
  return typeof value === 'string' ? value : '<missing>'
}

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', windowsHide: true })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed (${String(result.status)}): ${result.stderr}`)
  return result.stdout.trim()
}

function runInherited(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', windowsHide: true })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed with exit code ${String(result.status)}`)
}

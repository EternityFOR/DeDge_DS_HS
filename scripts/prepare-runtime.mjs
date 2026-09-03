import { spawnSync } from 'node:child_process'
import { accessSync, constants, copyFileSync, cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
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

// The official alpha.3 adapter uses a direct fetch + SSE pipeline. Some
// Windows gateways/proxies compress or reset event-stream bodies while the
// response is still active. Keep the upstream package and its version intact,
// but harden the one provider request at packaging time so every VSIX gets the
// same deterministic transport behavior. The exact markers make an upstream
// package drift fail loudly instead of silently shipping an unpatched runtime.
patchDeepSeekTransport(path.join(runtimeModules, '@deepseek-ai', 'dsh-llm-deepseek', 'lib', 'index.js'))
patchJobStopCommand(path.join(runtimeModules, '@deepseek-ai', 'dsh-tool-jobs', 'lib', 'index.js'))

for (const metadata of ['.modules.yaml', '.package-map.json', '.pnpm-workspace-state-v1.json', '.pnpm']) {
  rmSync(path.join(runtimeModules, metadata), { recursive: true, force: true })
}
removeCommandShimDirectories(runtimeModules)
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


function removeCommandShimDirectories(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const candidate = path.join(directory, entry.name)
    if (entry.name === '.bin') {
      rmSync(candidate, { recursive: true, force: true })
      continue
    }
    if (entry.isDirectory()) removeCommandShimDirectories(candidate)
  }
}
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

function patchDeepSeekTransport(file) {
  let source = readFileSync(file, 'utf8')
  const encodingMarker = '"accept": "text/event-stream",'
  if (source.split(encodingMarker).length !== 2) {
    throw new Error(`Unexpected alpha.3 DeepSeek adapter shape; cannot add SSE identity encoding: ${file}`)
  }
  source = source.replace(encodingMarker, `${encodingMarker}\n\t\t\t"accept-encoding": "identity",\n\t\t\t"connection": "close",`)

  const errorMarker = 'throw new LlmError(`DeepSeek API stream from ${connection.baseURL} failed`, "TRANSPORT", { cause: error });'
  if (source.split(errorMarker).length !== 2) {
    throw new Error(`Unexpected alpha.3 DeepSeek adapter shape; cannot add transport diagnostics: ${file}`)
  }
  const diagnostic = 'throw new LlmError(`DeepSeek API stream from ${connection.baseURL} failed (${transportDiagnostic(error)})`, "TRANSPORT", { cause: error });'
  source = source.replace(errorMarker, diagnostic)
  const helperMarker = 'var DeepSeekAdapter = class extends LlmAdapter {'
  if (source.split(helperMarker).length !== 2) {
    throw new Error(`Unexpected alpha.3 DeepSeek adapter shape; cannot add transport diagnostic helper: ${file}`)
  }
  const helper = [
    'function transportDiagnostic(error) {',
    '  if (error === null || error === undefined) return "unknown transport error";',
    '  const cause = error instanceof Error && error.cause instanceof Error ? `; cause=${error.cause.name}: ${error.cause.message}` : "";',
    '  const value = error instanceof Error ? `${error.name}: ${error.message}${cause}` : String(error);',
    '  return value.replace(/(?:Bearer\\s+|(?:api[-_ ]?key|token|secret)[=: ]+)\\S+/giu, "<redacted>").slice(0, 240);',
    '}',
    '',
  ].join('\n')
  source = source.replace(helperMarker, `${helper}${helperMarker}`)
  writeFileSync(file, source)
}

function patchJobStopCommand(file) {
  let source = readFileSync(file, 'utf8')
  const injectMarker = 'const inject = [\n\t"tools",\n\t"jobs",\n\t"systemPrompt"\n];'
  if (source.split(injectMarker).length !== 2) {
    throw new Error(`Unexpected alpha.3 tool-jobs shape; cannot add the stop-jobs command: ${file}`)
  }
  source = source.replace(injectMarker, 'const inject = [\n\t"commands",\n\t"tools",\n\t"jobs",\n\t"systemPrompt"\n];')
  const registrationMarker = '\tctx.jobs.attachController("tool-jobs");'
  if (source.split(registrationMarker).length !== 2) {
    throw new Error(`Unexpected alpha.3 tool-jobs shape; cannot add the stop-jobs registration: ${file}`)
  }
  const registration = [
    registrationMarker,
    '\tctx.commands.register({',
    '\t\tname: "stop-jobs",',
    '\t\tdescription: "Stop all running background jobs owned by this session",',
    '\t\thandler: (invocation) => {',
    '\t\t\tlet requested = 0;',
    '\t\t\tfor (const job of ctx.jobs.list(invocation.agent)) {',
    '\t\t\t\tif (job.ownerSession !== invocation.agent.id) continue;',
    '\t\t\t\tif (job.status !== "running") continue;',
    '\t\t\t\ttry {',
    '\t\t\t\t\tctx.jobs.kill(job.id, invocation.agent, "Stopped by the user from the VS Code workbench");',
    '\t\t\t\t\trequested += 1;',
    '\t\t\t\t} catch {',
    '\t\t\t\t\t// A job can settle between list() and kill(); keep stopping the rest.',
    '\t\t\t\t}',
    '\t\t\t}',
    '\t\t\treturn {',
    '\t\t\t\tkind: "success",',
    '\t\t\t\ttext: requested === 0 ? "No running background jobs." : `Requested cancellation for ${requested} background job${requested === 1 ? "" : "s"}.`',
    '\t\t\t};',
    '\t\t}',
    '\t});',
  ].join('\n')
  source = source.replace(registrationMarker, registration)
  writeFileSync(file, source)
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

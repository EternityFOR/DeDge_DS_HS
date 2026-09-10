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

// 0.1.3-alpha.2 needed local transport, stop-jobs, schedule-cancel, and
// legacy-origin compatibility patches. Official 0.1.5-rc.1 includes those
// fixes and ships the DeepSeek-V41-Flash model adapter, so do not apply the
// alpha-only source rewrites to the new upstream package.
if (expectedDsh === '0.1.3-alpha.2') {
  patchDeepSeekTransport(path.join(runtimeModules, '@deepseek-ai', 'dsh-llm-deepseek', 'lib', 'index.js'))
  patchJobStopCommand(path.join(runtimeModules, '@deepseek-ai', 'dsh-tool-jobs', 'lib', 'index.js'))
  patchScheduleCancelCommand(path.join(runtimeModules, '@deepseek-ai', 'dsh-schedule', 'lib', 'index.js'))
  patchLegacySessionOrigin(path.join(runtimeModules, '@deepseek-ai', 'dsh-session-format-v0-to-v1', 'lib', 'index.js'))
} else {
  console.log(`Using upstream Harness ${expectedDsh}; skipping alpha.2 compatibility patches.`)
}

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
    throw new Error(`Unexpected alpha.2 DeepSeek adapter shape; cannot add SSE identity encoding: ${file}`)
  }
  source = source.replace(encodingMarker, `${encodingMarker}\n\t\t\t"accept-encoding": "identity",\n\t\t\t"connection": "close",`)

  const errorMarker = 'throw new LlmError(`DeepSeek API stream from ${connection.baseURL} failed`, "TRANSPORT", { cause: error });'
  if (source.split(errorMarker).length !== 2) {
    throw new Error(`Unexpected alpha.2 DeepSeek adapter shape; cannot add transport diagnostics: ${file}`)
  }
  const diagnostic = 'throw new LlmError(`DeepSeek API stream from ${connection.baseURL} failed (${transportDiagnostic(error)})`, "TRANSPORT", { cause: error });'
  source = source.replace(errorMarker, diagnostic)
  const helperMarker = 'var DeepSeekAdapter = class extends LlmAdapter {'
  if (source.split(helperMarker).length !== 2) {
    throw new Error(`Unexpected alpha.2 DeepSeek adapter shape; cannot add transport diagnostic helper: ${file}`)
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
    throw new Error(`Unexpected alpha.2 tool-jobs shape; cannot add the stop-jobs command: ${file}`)
  }
  source = source.replace(injectMarker, 'const inject = [\n\t"commands",\n\t"tools",\n\t"jobs",\n\t"systemPrompt"\n];')
  const registrationMarker = '\tctx.jobs.attachController("tool-jobs");'
  if (source.split(registrationMarker).length !== 2) {
    throw new Error(`Unexpected alpha.2 tool-jobs shape; cannot add the stop-jobs registration: ${file}`)
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

function patchScheduleCancelCommand(file) {
  let source = readFileSync(file, 'utf8')
  const injectMarker = 'const inject = [\n\t"agents",\n\t"sessions",\n\t"tools",\n\t"sessionPersistence"\n];'
  if (source.split(injectMarker).length !== 2) {
    throw new Error(`Unexpected alpha.2 schedule shape; cannot add the schedule-cancel command: ${file}`)
  }
  source = source.replace(injectMarker, 'const inject = [\n\t"agents",\n\t"commands",\n\t"sessions",\n\t"tools",\n\t"sessionPersistence"\n];')
  const registrationMarker = 'function apply(ctx) {\n\tctx.inject(["sessionProjections"], (projectionCtx) => {'
  if (source.split(registrationMarker).length !== 2) {
    throw new Error(`Unexpected alpha.2 schedule apply shape; cannot add the schedule-cancel command: ${file}`)
  }
  const registration = [
    'function apply(ctx) {',
    '\tctx.commands.register({',
    '\t\tname: "schedule-cancel",',
    '\t\tdescription: "Cancel one or all active scheduled reminders in this session",',
    '\t\tinput: { hint: "[<schedule-id>|all]" },',
    '\t\thandler: (invocation) => runScheduleTransaction(invocation.agent, async () => {',
    '\t\t\tconst target = invocation.rawInput.trim();',
    '\t\t\tlet folded;',
    '\t\t\ttry {',
    '\t\t\t\tfolded = foldScheduleEvents(invocation.agent.session.ownEvents());',
    '\t\t\t} catch {',
    '\t\t\t\treturn { kind: "error", text: "The session schedule log is corrupt; no reminder was cancelled." };',
    '\t\t\t}',
    '\t\t\tconst active = target === "" || target === "all" ? [...folded.active] : folded.active.filter((record) => record.id === target);',
    '\t\t\tif (target !== "" && target !== "all" && active.length === 0) return { kind: "error", text: `No active scheduled reminder matched ${JSON.stringify(target)}.` };',
    '\t\t\tif (active.length === 0) return { kind: "success", text: "No active scheduled reminders." };',
    '\t\t\tif (invocation.signal.aborted) return { kind: "error", text: "Scheduled reminder cancellation was interrupted." };',
    '\t\t\ttry {',
    '\t\t\t\tfor (const record of active) invocation.agent.session.append("schedule/change", { version: 1, operation: "delete", id: record.id });',
    '\t\t\t\tawait flushSchedulePersistence(ctx, invocation.agent.session);',
    '\t\t\t} catch {',
    '\t\t\t\treturn { kind: "error", text: "Schedule persistence did not complete; retry before relying on cancellation." };',
    '\t\t\t}',
    '\t\t\treturn { kind: "success", text: active.length === 1 ? "Cancelled 1 scheduled reminder." : `Cancelled ${active.length} scheduled reminders.` };',
    '\t\t}),',
    '\t});',
    '\tctx.inject(["sessionProjections"], (projectionCtx) => {',
  ].join('\n')
  source = source.replace(registrationMarker, registration)
  writeFileSync(file, source)
}

/**
 * Alpha.3 emitted a legacy v0 permission/preset payload with an extra
 * `origin` member. Alpha.2's frozen v0 codec correctly rejects unknown
 * members, but the extension must still be able to migrate a copied legacy
 * session without touching the user's source home. Strip only this known
 * historical field at the v0->v1 migration boundary.
 */
function patchLegacySessionOrigin(file) {
  let source = readFileSync(file, 'utf8')
  const dispositionMarker = '"permission/preset": disposition(["preset"]),'
  if (source.split(dispositionMarker).length !== 2) {
    throw new Error(`Unexpected alpha.2 session migration shape; cannot admit legacy permission origin: ${file}`)
  }
  source = source.replace(dispositionMarker, '"permission/preset": disposition(["preset"], ["origin"]),')
  const normalizeMarker = 'const message = normalizeLegacyMessage(normalizeLegacyCompaction(normalizeLegacyRetry(normalizeLegacySteering(normalizeLegacyRequestHeader(normalizeLegacyTurnEnd(normalizeLegacyTurnStart(named, sessionId), sessionId), sessionId), sessionId), sessionId, state.retryIds), sessionId, state), sessionId, state.messageIds);'
  if (source.split(normalizeMarker).length !== 2) {
    throw new Error(`Unexpected alpha.2 session migration normalizer shape; cannot admit legacy permission origin: ${file}`)
  }
  const replacement = [
    normalizeMarker.replace('const message', 'let message'),
    'if (message.type === "permission/preset" && isSessionFormatJsonObject(message.data) && Object.hasOwn(message.data, "origin")) {',
    '\t\tmessage = { ...message, data: { preset: message.data["preset"] } };',
    '\t}',
  ].join('\n')
  source = source.replace(normalizeMarker, replacement)
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

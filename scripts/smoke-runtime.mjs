import { spawn, spawnSync } from 'node:child_process'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const smokeRoot = path.join(root, '.tmp', 'runtime-smoke')
const runtimeModules = path.join(root, 'dist', 'runtime', 'node_modules')
const node = path.join(runtimeModules, 'node', 'bin', process.platform === 'win32' ? 'node.exe' : 'node')
const dsh = path.join(runtimeModules, '@deepseek-ai', 'dsh', 'lib', 'bin.js')
const pnpm = path.join(runtimeModules, 'pnpm', 'bin', 'pnpm.mjs')
const overlayModule = path.join(smokeRoot, 'overlay.mjs')
const overlayPath = path.join(smokeRoot, 'vscode.patch.yml')
const home = path.join(smokeRoot, 'path with spaces', 'home')
const runtimeBin = path.join(smokeRoot, 'runtime-bin')

await rm(smokeRoot, { recursive: true, force: true })
await mkdir(runtimeBin, { recursive: true })

let child
try {
  await build({
    entryPoints: [path.join(root, 'src', 'runtime', 'overlay.ts')],
    outfile: overlayModule,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    logLevel: 'silent',
  })
  const { renderRuntimeOverlay } = await import(`${pathToFileURL(overlayModule).href}?smoke=${Date.now()}`)
  await writeFile(overlayPath, renderRuntimeOverlay({
    runtimeMode: 'bundled',
    runtimeCommand: '',
    runtimeNodePath: '',
    startTimeoutMs: 90_000,
    provider: 'deepseek-official',
    model: 'deepseek-v4-flash',
    reasoningEffort: 'high',
    agentPreset: 'standard',
    permissionMode: 'read-only',
    baseUrl: 'https://api.deepseek.com/',
    autoStart: false,
    contextMaxBytes: 32_768,
    contextWindowTokens: 1_000_000,
    codexHome: '${userHome}/.codex',
    claudeHome: '${userHome}/.claude',
    codexCommand: '',
    claudeCommand: '',
    handoffMaxBytes: 65_536,
  }), 'utf8')
  await writePnpmWrapper(runtimeBin)

  const env = { ...process.env }
  delete env.DEEPSEEK_API_KEY
  delete env.DEEPSEEK_BASE_URL
  Object.assign(env, {
    DSH_HOME: home,
    DSH_CWD: root,
    DSH_PERMISSION_MODE: 'read-only',
    DSH_TELEMETRY_DISABLED: '1',
    DSH_BUNDLED_NODE: node,
    DSH_BUNDLED_PNPM: pnpm,
    NO_COLOR: '1',
    PATH: [runtimeBin, path.dirname(node), env.PATH].filter(Boolean).join(path.delimiter),
  })

  child = spawn(node, [dsh, 'web', '--patch', overlayPath, '--host', '127.0.0.1', '--port', '0'], {
    cwd: root,
    env,
    shell: false,
    windowsHide: true,
    detached: process.platform !== 'win32',
  })
  const url = await waitForUrl(child, 90_000)
  const description = await rpc(url, 'host.describe', {})
  const session = await rpc(url, 'session.create', { cwd: root, agentPreset: 'standard' })
  if (typeof session?.sessionId !== 'string' || session.sessionId === '') {
    throw new Error(`session.create returned a malformed response: ${JSON.stringify(session)}`)
  }
  const command = await rpc(url, 'commands/execute', { args: { agentId: session.sessionId, line: '/compact' } })
  if (command?.result?.kind !== 'success' && command?.result?.kind !== 'error') {
    throw new Error(`commands/execute returned a malformed command result: ${JSON.stringify(command)}`)
  }
  console.log(`Runtime smoke passed at ${url} with Gateway ${String(description?.version ?? 'unknown')} and /compact RPC support`)
} finally {
  if (child !== undefined) await terminate(child)
  await rm(smokeRoot, { recursive: true, force: true })
}

async function writePnpmWrapper(directory) {
  const target = path.join(directory, process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm')
  const content = process.platform === 'win32'
    ? '@echo off\r\n"%DSH_BUNDLED_NODE%" "%DSH_BUNDLED_PNPM%" %*\r\n'
    : '#!/bin/sh\nexec "$DSH_BUNDLED_NODE" "$DSH_BUNDLED_PNPM" "$@"\n'
  await writeFile(target, content, { encoding: 'utf8', mode: 0o755 })
}

function waitForUrl(processHandle, timeoutMs) {
  return new Promise((resolve, reject) => {
    let stdout = ''
    let stderr = ''
    let settled = false
    const finish = (error, url) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      error === undefined ? resolve(url) : reject(error)
    }
    const timer = setTimeout(() => finish(new Error(`Runtime smoke timed out. stderr: ${stderr.slice(-2_000)}`)), timeoutMs)
    processHandle.stdout.on('data', chunk => {
      stdout += String(chunk)
      const url = /dsh web:\s+(http:\/\/127\.0\.0\.1:\d+)/u.exec(stdout)?.[1]
      if (url !== undefined) finish(undefined, url)
    })
    processHandle.stderr.on('data', chunk => { stderr += String(chunk) })
    processHandle.once('error', error => finish(error))
    processHandle.once('exit', (code, signal) => {
      finish(new Error(`Runtime exited before readiness (code=${String(code)}, signal=${String(signal)}). stderr: ${stderr.slice(-2_000)}`))
    })
  })
}

async function rpc(url, method, payload) {
  const rpcId = `runtime-smoke-${method}`
  const response = await fetch(new URL(`/api/${method}`, url), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId, method, payload }),
  })
  if (!response.ok) throw new Error(`${method} returned HTTP ${response.status}`)
  const body = await response.json()
  if (body?.type !== 'server-response' || body.rpcId !== rpcId || body.result?.ok !== true) {
    throw new Error(`${method} returned a malformed response: ${JSON.stringify(body)}`)
  }
  return body.result.value
}

async function terminate(processHandle) {
  if (processHandle.exitCode !== null || processHandle.pid === undefined) return
  const exited = new Promise(resolve => processHandle.once('exit', resolve))
  if (process.platform === 'win32') {
    const taskkill = process.env.SystemRoot === undefined ? 'taskkill.exe' : path.join(process.env.SystemRoot, 'System32', 'taskkill.exe')
    spawnSync(taskkill, ['/pid', String(processHandle.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
  } else {
    try {
      process.kill(-processHandle.pid, 'SIGTERM')
    } catch {
      processHandle.kill('SIGTERM')
    }
  }
  const stopped = await Promise.race([exited.then(() => true), delay(5_000).then(() => false)])
  if (!stopped && processHandle.exitCode === null) processHandle.kill('SIGKILL')
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

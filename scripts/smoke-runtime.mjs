import { spawn, spawnSync } from 'node:child_process'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import WebSocket from 'ws'
import { startMockModelServer, verifyForegroundSteering, verifyHostSchedules, waitUntil } from './steering-smoke.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const artifactArgument = process.argv.indexOf('--extension-root')
const artifactRoot = artifactArgument < 0 ? root : path.resolve(root, process.argv[artifactArgument + 1] ?? '')
const smokeRoot = path.join(root, '.tmp', 'runtime-smoke')
const runtimeModules = path.join(artifactRoot, 'dist', 'runtime', 'node_modules')
const node = path.join(runtimeModules, 'node', 'bin', process.platform === 'win32' ? 'node.exe' : 'node')
const dsh = path.join(runtimeModules, '@deepseek-ai', 'dsh', 'lib', 'bin.js')
const pnpm = path.join(runtimeModules, 'pnpm', 'bin', 'pnpm.mjs')
const runtimeVersion = JSON.parse(await readFile(path.join(runtimeModules, '@deepseek-ai', 'dsh', 'package.json'), 'utf8')).version
const overlayModule = path.join(smokeRoot, 'overlay.mjs')
const overlayPath = path.join(smokeRoot, 'vscode.patch.yml')
const hookConfigPath = path.join(smokeRoot, 'claude-hooks.json')
const gatewayClientModule = path.join(smokeRoot, 'gateway-client.mjs')
const home = path.join(smokeRoot, 'path with spaces', 'home')
const smokeWorkspace = path.join(smokeRoot, 'workspace with spaces')
const runtimeBin = path.join(smokeRoot, 'runtime-bin')

await rm(smokeRoot, { recursive: true, force: true })
await mkdir(runtimeBin, { recursive: true })
await mkdir(smokeWorkspace, { recursive: true })
await writeFile(hookConfigPath, `${JSON.stringify({ SessionStart: [] })}\n`, 'utf8')

let child
let mock
try {
  mock = await startMockModelServer()
  await build({
    entryPoints: [path.join(root, 'src', 'runtime', 'overlay.ts')],
    outfile: overlayModule,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    logLevel: 'silent',
  })
  await build({
    entryPoints: [path.join(root, 'src', 'gateway', 'gateway-client.ts')],
    outfile: gatewayClientModule,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    external: ['vscode', 'ws'],
    logLevel: 'silent',
  })
  const { renderRuntimeOverlay } = await import(`${pathToFileURL(overlayModule).href}?smoke=${Date.now()}`)
  const configuration = {
    runtimeMode: 'bundled',
    runtimeCommand: '',
    runtimeNodePath: '',
    startTimeoutMs: 90_000,
    provider: 'deepseek-official',
    model: 'deepseek-v4-flash',
    reasoningEffort: 'off',
    agentPreset: 'standard',
    permissionMode: 'danger-full-access',
    baseUrl: mock.baseUrl,
    scheduleEnabled: true,
    autoStart: false,
    contextMaxBytes: 32_768,
    contextWindowTokens: 1_000_000,
    codexHome: '${userHome}/.codex',
    claudeHome: '${userHome}/.claude',
    codexCommand: '',
    claudeCommand: '',
    handoffMaxBytes: 65_536,
  }
  const overlayOptions = {
    claudeHooksConfigPath: hookConfigPath,
    steeringPluginUrl: pathToFileURL(path.join(artifactRoot, 'dist', 'steering-interrupt.mjs')).href,
  }
  await writeFile(overlayPath, renderRuntimeOverlay(configuration, overlayOptions), 'utf8')
  await writePnpmWrapper(runtimeBin)

  const env = { ...process.env }
  delete env.DEEPSEEK_API_KEY
  delete env.DEEPSEEK_BASE_URL
  Object.assign(env, {
    DSH_HOME: home,
    DSH_CWD: smokeWorkspace,
    DSH_PERMISSION_MODE: 'danger-full-access',
    DEEPSEEK_API_KEY: 'runtime-smoke-placeholder',
    DEEPSEEK_BASE_URL: mock.baseUrl,
    DSH_TELEMETRY_DISABLED: '1',
    DSH_BUNDLED_NODE: node,
    DSH_BUNDLED_PNPM: pnpm,
    NO_COLOR: '1',
    PATH: [runtimeBin, path.dirname(node), env.PATH].filter(Boolean).join(path.delimiter),
  })

  child = spawn(node, [dsh, 'web', '--patch', overlayPath, '--host', '127.0.0.1', '--port', '0', '--no-open'], {
    // Keep the smoke isolated from the developer's checkout `.env` and workspace data.
    cwd: smokeWorkspace,
    env,
    shell: false,
    windowsHide: true,
    detached: process.platform !== 'win32',
  })
  const url = await waitForUrl(child, 90_000)
  const cookie = await bootstrapGatewayCookie(url)
  const description = { version: runtimeVersion }
  const listed = await rpc(url, 'session/list', { args: { _request: {} } }, cookie)
  if (!Array.isArray(listed?.items)) throw new Error(`session/list returned a malformed response: ${JSON.stringify(listed)}`)
  const session = await rpc(url, 'session/create', { args: { request: { cwd: smokeWorkspace, agentPreset: 'standard' } } }, cookie)
  if (typeof session?.sessionId !== 'string' || session.sessionId === '') {
    throw new Error(`session.create returned a malformed response: ${JSON.stringify(session)}`)
  }
  const commands = await rpc(url, 'commands/list', { args: { agentId: session.sessionId } }, cookie)
  if (!Array.isArray(commands) || !commands.every(command => typeof command?.name === 'string')) {
    throw new Error(`commands.list returned a malformed response: ${JSON.stringify(commands)}`)
  }
  // These are optional control commands: newer upstream presets may expose
  // their own equivalent or omit them when the corresponding plugin is not
  // mounted. The extension treats both as best-effort cancellation helpers.
  const optionalCommands = new Set(commands.map(command => command.name))
  const control = await readRemoteStreamItem(url, 'session/control', { args: {} }, cookie)
  if (control?.type !== 'baseline' || typeof control.value?.projections !== 'object') {
    throw new Error(`session/control returned a malformed baseline: ${JSON.stringify(control)}`)
  }
  const workspace = await readRemoteStreamItem(url, 'workspace/follow', { args: {} }, cookie)
  if (workspace?.type !== 'baseline' || typeof workspace.value?.archivedSessionIds === 'undefined') {
    throw new Error(`workspace/follow returned a malformed baseline: ${JSON.stringify(workspace)}`)
  }
  const remoteEvents = await readRemoteStreamItem(url, '$events', { args: {} }, cookie)
  if (remoteEvents?.type !== 'ready' || typeof remoteEvents.clientId !== 'string') {
    throw new Error(`$events returned a malformed opening frame: ${JSON.stringify(remoteEvents)}`)
  }
  const catalog = await rpc(url, 'session/modelCatalog', { args: {} }, cookie)
  const modelIds = new Set(catalog?.groups?.flatMap(group => group.models?.map(model => model.id) ?? []) ?? [])
  for (const model of ['deepseek-flash', 'deepseek-v4-flash', 'deepseek-v4-pro', 'deepseek-v4-flash-vision-exp']) {
    if (!modelIds.has(model)) throw new Error(`session.models did not advertise ${model}: ${JSON.stringify(catalog)}`)
  }
  const command = await rpc(url, 'commands/execute', { args: { agentId: session.sessionId, line: '/compact', submittedAttachments: [] } }, cookie)
  if (command?.result?.kind !== 'success' && command?.result?.kind !== 'error') {
    throw new Error(`commands/execute returned a malformed command result: ${JSON.stringify(command)}`)
  }
  if (optionalCommands.has('stop-jobs')) {
    const stopJobs = await rpc(url, 'commands/execute', { args: { agentId: session.sessionId, line: '/stop-jobs', submittedAttachments: [] } }, cookie)
    if (stopJobs?.result?.kind !== 'success' || typeof stopJobs.result.text !== 'string') {
      throw new Error(`stop-jobs command returned an unexpected result: ${JSON.stringify(stopJobs)}`)
    }
  }
  if (optionalCommands.has('schedule-cancel')) {
    const cancelSchedules = await rpc(url, 'commands/execute', { args: { agentId: session.sessionId, line: '/schedule-cancel all', submittedAttachments: [] } }, cookie)
    if (cancelSchedules?.result?.kind !== 'success' || typeof cancelSchedules.result.text !== 'string') {
      throw new Error(`schedule-cancel command returned an unexpected result: ${JSON.stringify(cancelSchedules)}`)
    }
  }
  const visionSession = await rpc(url, 'session/create', { args: { request: { cwd: smokeWorkspace, agentPreset: 'standard' } } }, cookie)
  await rpc(url, 'session/selectModel', { args: { request: { sessionId: visionSession.sessionId, provider: 'deepseek-official', model: 'deepseek-v4-flash-vision-exp', reasoningEffort: 'off' } } }, cookie)
  const imagePrompt = await rpc(url, 'session/prompt', { args: { request: {
    requestId: 'runtime-smoke-image',
    sessionId: visionSession.sessionId,
    mode: 'queue',
    content: [
      { type: 'image', mediaType: 'image/png', data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', name: 'smoke.png' },
    ],
  } } }, cookie)
  if (imagePrompt?.accepted !== true) throw new Error(`session.prompt did not accept native image content: ${JSON.stringify(imagePrompt)}`)
  // session.prompt acknowledges the accepted request before the append-only
  // history index necessarily contains the user event. Poll briefly so the
  // smoke check verifies the durable attachment contract instead of a race.
  const { history: imageHistory, entry: imageEntry } = await waitForImageHistory(url, visionSession.sessionId, 15_000, cookie)
  const imageBlock = imageEntry?.event?.data?.content?.find(block => block?.type === 'image')
  if (imageEntry?.event?.data?.source?.rpcId !== 'runtime-smoke-image') throw new Error('Image-only durable history lost the prompt request identity.')
  const attachmentId = imageBlock?.attachment?.attachmentId
  if (typeof attachmentId !== 'string' || attachmentId === '') throw new Error(`session.history did not retain a durable image attachment reference: ${JSON.stringify(imageHistory)}`)
  const imageAttachment = await rpc(url, 'session/attachment', { args: { request: { sessionId: visionSession.sessionId, attachmentId } } }, cookie)
  if (imageAttachment?.attachment?.attachmentId !== attachmentId || typeof imageAttachment.data !== 'string' || imageAttachment.data === '') {
    throw new Error(`session.attachment returned a malformed image payload: ${JSON.stringify({ attachment: imageAttachment?.attachment, hasData: typeof imageAttachment?.data === 'string' && imageAttachment.data !== '' })}`)
  }
  await rpc(url, 'session/cancel', { args: { request: { sessionId: visionSession.sessionId } } }, cookie)
  const { GatewayClient } = await import(`${pathToFileURL(gatewayClientModule).href}?smoke=${Date.now()}`)
  const clientFrames = []
  const clientHostFrames = []
  const client = new GatewayClient(url, { info() {}, warn() {}, error() {}, raw() {} })
  await client.connect({ onMux: frame => { clientFrames.push(frame) }, onHost: frame => { clientHostFrames.push(frame) }, onError: error => { throw error } })
  const clientSessions = await client.listSessions()
  if (!clientSessions.items.some(item => item.sessionId === session.sessionId)) throw new Error('GatewayClient did not list the created session')
  const clientWorkspace = await client.listWorkspaces()
  if (!Array.isArray(clientWorkspace.archivedSessionIds)) throw new Error('GatewayClient did not read the workspace baseline')
  const clientCatalog = await client.models(session.sessionId)
  if (!clientCatalog.groups.some(group => group.models.some(model => model.id === 'deepseek-v4-pro'))) throw new Error('GatewayClient did not parse the RC model catalog')
  const clientPresets = await client.presets()
  if (!clientPresets.presets.some(preset => preset.id === 'standard')) throw new Error('GatewayClient did not parse the RC preset roster')
  const clientHistory = await client.history(visionSession.sessionId)
  if (!clientHistory.events.some(item => item.event.type === 'user/message')) throw new Error('GatewayClient did not open the session follow snapshot')
  if (!clientFrames.some(frame => frame.type === 'session/queue')) throw new Error('GatewayClient did not consume the session control stream')
  if ((await client.listSchedules(session.sessionId)).length !== 0) throw new Error('Fresh smoke session unexpectedly contained a reminder')
  const steeringTiming = await verifyForegroundSteering(client, clientFrames, smokeWorkspace, mock)
  if (!clientFrames.some(frame => frame.type === 'session/assistant-stream' && frame.value.messages.length > 0)) throw new Error('Cursorless live assistant text never reached the client')
  await verifyHostSchedules(client, smokeWorkspace)
  if (!clientHostFrames.some(frame => frame.type === 'host/remote-event' && frame.event === 'schedule/changed')) throw new Error('Host schedule changes were not broadcast to the Gateway client')
  client.dispose()
  await terminate(child)
  child = undefined

  // Start a fresh synthetic Host through the legacy custom-gateway route.
  // The explicit overlay disables the native Messages adapter for this URL.
  const compatBase = `${mock.origin}/v1`
  await writeFile(overlayPath, renderRuntimeOverlay({ ...configuration, baseUrl: compatBase }, overlayOptions), 'utf8')
  child = spawn(node, [dsh, 'web', '--patch', overlayPath, '--host', '127.0.0.1', '--port', '0', '--no-open'], {
    cwd: smokeWorkspace,
    env: { ...env, DSH_HOME: path.join(smokeRoot, 'compat-home'), DEEPSEEK_BASE_URL: compatBase },
    shell: false,
    windowsHide: true,
    detached: process.platform !== 'win32',
  })
  const compatUrl = await waitForUrl(child, 90_000)
  const compatClient = new GatewayClient(compatUrl, { info() {}, warn() {}, error() {}, raw() {} })
  await compatClient.connect({ onMux() {}, onHost() {}, onError: error => { throw error } })
  const compatSession = await compatClient.createSession(smokeWorkspace, 'standard')
  await compatClient.prompt(compatSession.sessionId, 'SMOKE_COMPAT')
  await waitUntil(async () => {
    const history = await compatClient.history(compatSession.sessionId)
    return history.events.some(row => row.event.type === 'assistant/message' && JSON.stringify(row.event.data).includes('SMOKE_COMPAT_ACK'))
  }, 15_000, 'Custom OpenAI-compatible gateway did not complete its synthetic request')
  compatClient.dispose()
  if (!mock.paths.some(endpoint => endpoint.endsWith('/chat/completions'))) throw new Error('Custom endpoint was not kept on Chat Completions')
  const displayUrl = new URL(url)
  displayUrl.search = ''
  console.log(`Runtime smoke passed at ${displayUrl} with Gateway ${String(description?.version ?? 'unknown')}, authenticated RPC/streams, native images, scoped Host schedules, custom Chat Completions compatibility, and real foreground sleep interruption (${steeringTiming}) without losing the other ten queued prompts.`)
} finally {
  if (child !== undefined) await terminate(child)
  await mock?.close()
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
      const url = /dsh web:\s+(http:\/\/127\.0\.0\.1:\d+(?:[/?][^\s()]*)?)/u.exec(stdout)?.[1]
      if (url !== undefined) finish(undefined, url)
    })
    processHandle.stderr.on('data', chunk => { stderr += String(chunk) })
    processHandle.once('error', error => finish(error))
    processHandle.once('exit', (code, signal) => {
      finish(new Error(`Runtime exited before readiness (code=${String(code)}, signal=${String(signal)}). stderr: ${stderr.slice(-2_000)}`))
    })
  })
}

async function bootstrapGatewayCookie(baseUrl) {
  const endpoint = new URL(baseUrl)
  const token = endpoint.searchParams.get('token')
  if (token === null || token === '') return undefined
  endpoint.pathname = '/'
  endpoint.search = ''
  endpoint.searchParams.set('token', token)
  const response = await fetch(endpoint, { redirect: 'manual', headers: { accept: 'text/html' } })
  if (response.status !== 303) throw new Error(`Gateway authentication bootstrap returned HTTP ${response.status}`)
  const raw = response.headers.get('set-cookie')
  const cookie = raw?.split(';', 1)[0]?.trim()
  if (cookie === undefined || cookie === '' || !cookie.includes('=')) throw new Error('Gateway authentication bootstrap did not return a session cookie')
  return cookie
}

async function rpc(url, method, payload, cookie) {
  const rpcId = `runtime-smoke-${method}`
  const response = await fetch(new URL(`/api/${method}`, url), {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(cookie === undefined ? {} : { cookie }) },
    body: JSON.stringify({ type: 'client-request', rpcId, method, payload }),
  })
  if (!response.ok) throw new Error(`${method} returned HTTP ${response.status}`)
  const body = await response.json()
  if (body?.type !== 'server-response' || body.rpcId !== rpcId || body.result?.ok !== true) {
    throw new Error(`${method} returned a malformed response: ${JSON.stringify(body)}`)
  }
  return body.result.value
}

async function waitForImageHistory(url, sessionId, timeoutMs, cookie) {
  const deadline = Date.now() + timeoutMs
  let history
  while (Date.now() <= deadline) {
    const snapshot = await readRemoteStreamItem(url, 'session/follow', {
      args: { request: { address: { kind: 'session', sessionId }, maxMessages: 40 } },
    }, cookie)
    history = { events: snapshot?.records ?? [], hasMore: snapshot?.hasMore }
    const entry = snapshot?.records?.find(candidate => candidate?.type === 'event' && candidate.event?.type === 'user/message'
      && Array.isArray(candidate.event.data?.content)
      && candidate.event.data.content.some(block => block?.type === 'image' && typeof block.attachment?.attachmentId === 'string'))
    if (entry !== undefined) return { history, entry }
    await delay(250)
  }
  return { history, entry: undefined }
}

async function readRemoteStreamItem(baseUrl, endpoint, payload, cookie) {
  const url = new URL('/api/remote.mux', baseUrl)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  const streamId = `runtime-smoke-${Date.now()}-${Math.random().toString(16).slice(2)}`
  const socket = new WebSocket(url, cookie === undefined ? undefined : { headers: { cookie } })
  return await new Promise((resolve, reject) => {
    let settled = false
    const finish = (error, value) => {
      if (settled) return
      settled = true
      socket.close()
      error === undefined ? resolve(value) : reject(error)
    }
    socket.once('open', () => socket.send(JSON.stringify({ type: 'open', streamId, endpoint, payload })))
    socket.on('message', data => {
      let frame
      try { frame = JSON.parse(data.toString()) } catch (error) { finish(error); return }
      if (frame?.streamId !== streamId) return
      if (frame.type === 'item') finish(undefined, frame.value)
      else if (frame.type === 'error') finish(new Error(frame.error?.message ?? 'Remote stream failed'))
      else if (frame.type === 'end') finish(new Error('Remote stream ended without an item'))
    })
    socket.once('error', finish)
    socket.once('close', () => { if (!settled) finish(new Error('Remote stream closed before an item arrived')) })
  })
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

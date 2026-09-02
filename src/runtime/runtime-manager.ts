import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { copyFile, cp, mkdir, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { constants as fsConstants } from 'node:fs'
import * as path from 'node:path'
import * as vscode from 'vscode'
import type { ConfigurationService, HarnessConfiguration } from '../config/configuration.js'
import type { Logger } from '../platform/logger.js'
import { errorMessage } from '../platform/logger.js'
import type { StorageLayout } from '../platform/storage.js'
import { versionedHome } from '../platform/storage.js'
import type { CredentialStore } from '../security/credentials.js'
import { EXPECTED_DSH_VERSION, type RuntimeResolver } from './bundled-runtime.js'
import { renderRuntimeOverlay } from './overlay.js'
import { terminateProcessId, terminateProcessTree } from './process-tree.js'
import type { RuntimeLaunch, RuntimeState } from './types.js'
import {
  clearGatewayLease,
  defaultGatewayLeasePath,
  hasLiveGatewayClients,
  isProcessRunning,
  registerGatewayClient,
  readGatewayLease,
  tryAcquireGatewayStartupLock,
  writeGatewayLease,
  type GatewayClientRegistration,
  type GatewayLease,
  type GatewayStartupLock,
  gatewayLeaseMatchesVersion,
} from './gateway-lease.js'
import { checkWindowsCompatibility, describeWindowsExitCode } from './windows-compat.js'

// alpha.3 prints an authenticated root URL (`/?token=...`); keep the token
// because the Gateway exchanges it for the API session cookie.
const URL_PATTERN = /dsh web:\s+(http:\/\/127\.0\.0\.1:\d+(?:[/?][^\s()]*)?)/u

export class RuntimeManager implements vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<RuntimeState>()
  private child: ChildProcessWithoutNullStreams | undefined
  private stateValue: RuntimeState = { phase: 'idle' }
  private startTask: Promise<string> | undefined
  private stopTask: Promise<void> | undefined
  private launchIdentity: string | undefined
  private readonly gatewayLease = defaultGatewayLeasePath()
  private ownedLeasePid: number | undefined
  private clientRegistration: GatewayClientRegistration | undefined
  private attachedLeaseMonitor: ReturnType<typeof setInterval> | undefined
  private disposed = false

  readonly onDidChangeState = this.changed.event

  constructor(
    private readonly configuration: ConfigurationService,
    private readonly credentials: CredentialStore,
    private readonly resolver: RuntimeResolver,
    private readonly layout: StorageLayout,
    private readonly logger: Logger,
  ) {}

  get state(): RuntimeState {
    return this.stateValue
  }

  async start(): Promise<string> {
    if (this.disposed) throw new Error('The Harness runtime manager has been disposed.')
    if (!vscode.workspace.isTrusted) {
      throw new Error('DeepSeek Harness is disabled in an untrusted workspace because it can execute commands and edit files.')
    }
    if (this.stopTask !== undefined) await this.stopTask
    if (this.startTask !== undefined) return this.startTask

    const task = this.startInternal()
    this.startTask = task
    try {
      return await task
    } finally {
      if (this.startTask === task) this.startTask = undefined
    }
  }

  async restart(): Promise<string> {
    await this.stop()
    return this.start()
  }

  stop(): Promise<void> {
    this.stopTask ??= this.stopInternal().finally(() => { this.stopTask = undefined })
    return this.stopTask
  }

  async dispose(): Promise<void> {
    this.disposed = true
    const pendingStart = this.startTask
    // A Gateway can be shared by multiple VS Code windows. Release this
    // extension host first; only terminate the process when no other host is
    // still registered. This keeps an active session controllable after the
    // window that started it is closed.
    await this.stopForDispose()
    if (pendingStart !== undefined) await pendingStart.catch(() => undefined)
    this.changed.dispose()
  }

  private async startInternal(): Promise<string> {
    if (this.stateValue.phase === 'ready' && this.stateValue.url !== undefined) return this.stateValue.url
    const configuration = this.configuration.get()
    const workspace = workspaceDirectory()
    const apiKey = await this.credentials.getApiKey(configuration.baseUrl)
    this.setState({ phase: 'resolving' })

    const shared = await this.waitForSharedRuntimeOrLock(configuration.startTimeoutMs)
    if ('lease' in shared) return this.attachSharedRuntime(shared.lease)

    try {
      await checkWindowsCompatibility(workspace, this.layout, this.logger).catch(error => this.fail(error))

      let launch: RuntimeLaunch
      try {
        launch = await this.resolver.resolve(configuration)
      } catch (error) {
        return this.fail(error)
      }
      if (this.disposed) throw new Error('The Harness runtime manager was disposed before launch.')

      const identity = JSON.stringify({ workspace, launch: launch.diagnostics, configuration, hasApiKey: apiKey !== undefined })
      if (this.stateValue.phase === 'ready' && this.launchIdentity === identity && this.stateValue.url !== undefined) {
        return this.stateValue.url
      }
      if (this.child !== undefined) await this.stopInternal()
      this.launchIdentity = identity

      const home = versionedHome(this.layout, launch.version)
      await migrateHarnessHomeIfNeeded(this.layout, home, launch.version, this.logger).catch(error => this.logger.warn(`Harness home migration skipped: ${errorMessage(error)}`))
      const generatedDir = path.join(this.layout.generated, launch.version)
      const overlay = path.join(generatedDir, 'vscode.patch.yml')
      await Promise.all([mkdir(home, { recursive: true }), mkdir(generatedDir, { recursive: true })])
      await writeAtomic(overlay, renderRuntimeOverlay(configuration))

      const args = [...launch.args, 'web', '--patch', overlay, '--host', '127.0.0.1', '--port', '0', '--no-open']
      const env: NodeJS.ProcessEnv = {
        ...launch.environment,
        DSH_HOME: home,
        DSH_CWD: workspace,
        DSH_PERMISSION_MODE: configuration.permissionMode,
        DSH_TELEMETRY_DISABLED: '1',
        ...apiKey === undefined || apiKey === '' ? {} : { DEEPSEEK_API_KEY: apiKey },
        // alpha.3 appends `/chat/completions` directly. Keep the configured
        // URL stable in VS Code, but give the provider a slash-free namespace
        // so official and OpenAI-compatible endpoints never receive `//...`.
        DEEPSEEK_BASE_URL: normalizeProviderBaseUrl(configuration.baseUrl),
      }
      this.logger.info(`Starting ${launch.source} Harness ${launch.version} in ${workspace}`)
      this.setState({ phase: 'starting', version: launch.version })

      if (this.disposed) throw new Error('The Harness runtime manager was disposed before launch.')

      const child = spawn(launch.command, args, {
        cwd: workspace,
        env,
        shell: false,
        windowsHide: true,
        detached: process.platform !== 'win32',
      })
      this.child = child
      this.ownedLeasePid = child.pid

      const ready = new Promise<string>((resolve, reject) => {
        let settled = false
        let stdoutBuffer = ''
        const timeout = setTimeout(() => settle(new Error(`Harness did not become ready within ${configuration.startTimeoutMs} ms.`)), configuration.startTimeoutMs)

        const settle = (result: string | Error): void => {
          if (settled) return
          settled = true
          clearTimeout(timeout)
          typeof result === 'string' ? resolve(result) : reject(result)
        }

        child.stdout.on('data', (chunk: Buffer | string) => {
          const text = String(chunk)
          this.logger.raw(text)
          stdoutBuffer += text
          const lines = stdoutBuffer.split(/\r?\n/u)
          stdoutBuffer = lines.pop() ?? ''
          for (const line of lines) {
            const url = URL_PATTERN.exec(line)?.[1]
            if (url !== undefined) settle(url)
          }
        })
        child.stderr.on('data', (chunk: Buffer | string) => this.logger.raw(String(chunk)))
        child.once('error', error => settle(error))
        child.once('exit', (code, signal) => {
          if (this.child === child) this.child = undefined
          if (this.ownedLeasePid === child.pid) this.ownedLeasePid = undefined
          if (child.pid !== undefined) {
            void clearGatewayLease(this.gatewayLease, child.pid).catch(error => this.logger.error('Failed to clear the Harness gateway lease', error))
          }
          const windowsDetail = describeWindowsExitCode(code)
          const message = `Harness exited (code=${String(code)}, signal=${String(signal)}).${windowsDetail === undefined ? '' : ` ${windowsDetail}`}`
          if (!settled) settle(new Error(message))
          else if (!this.disposed && this.stateValue.phase !== 'stopping' && this.stateValue.phase !== 'idle') {
            this.logger.error(message)
            this.setState({ phase: 'error', version: launch.version, error: message })
          }
        })
      })

      try {
        const url = await ready
        if (child.pid !== undefined) {
          await writeGatewayLease(this.gatewayLease, { url, pid: child.pid, version: launch.version, workspace })
            .catch(error => this.logger.error('Failed to publish the Harness gateway lease', error))
        }
        this.setState({ phase: 'ready', version: launch.version, url, ...(child.pid === undefined ? {} : { pid: child.pid }) })
        await this.registerClient()
        return url
      } catch (error) {
        await terminateProcessTree(child).catch(cause => this.logger.error('Failed to clean up a failed runtime start', cause))
        if (this.child === child) this.child = undefined
        if (this.ownedLeasePid === child.pid) this.ownedLeasePid = undefined
        return this.fail(error, launch.version)
      }
    } finally {
      await shared.lock.release().catch(error => this.logger.error('Failed to release the Harness startup lock', error))
    }
  }

  private async stopInternal(): Promise<void> {
    this.stopAttachedLeaseMonitor()
    const child = this.child
    this.child = undefined
    this.launchIdentity = undefined
    if (child === undefined) {
      if (this.ownedLeasePid !== undefined) {
        await clearGatewayLease(this.gatewayLease, this.ownedLeasePid).catch(error => this.logger.error('Failed to clear the Harness gateway lease', error))
      }
      this.ownedLeasePid = undefined
      this.setState({ phase: 'idle' })
      return
    }
    this.setState({ phase: 'stopping', ...(this.stateValue.version === undefined ? {} : { version: this.stateValue.version }) })
    await terminateProcessTree(child).catch(error => this.logger.error('Failed to terminate the Harness process tree', error))
    if (child.pid !== undefined) {
      await clearGatewayLease(this.gatewayLease, child.pid).catch(error => this.logger.error('Failed to clear the Harness gateway lease', error))
    }
    this.ownedLeasePid = undefined
    this.setState({ phase: 'idle' })
  }

  private async stopForDispose(): Promise<void> {
    await this.releaseClient()
    if (await hasLiveGatewayClients(this.gatewayLease)) {
      // Detach from a still-shared child. Its exit handler will clear the
      // lease, but this disposed manager must not publish state afterwards.
      this.stopAttachedLeaseMonitor()
      this.child = undefined
      this.ownedLeasePid = undefined
      this.launchIdentity = undefined
      return
    }
    // An attached manager has no ChildProcess handle. As the final consumer it
    // still needs to terminate the recorded loopback process during shutdown.
    if (this.child === undefined && this.stateValue.phase === 'ready' && this.stateValue.pid !== undefined) {
      const pid = this.stateValue.pid
      await terminateProcessId(pid).catch(error => this.logger.warn(`Could not stop shared Harness ${pid}: ${errorMessage(error)}`))
      await clearGatewayLease(this.gatewayLease, pid).catch(error => this.logger.error('Failed to clear the Harness gateway lease', error))
      this.setState({ phase: 'idle' })
      return
    }
    // No other extension host is using this runtime. Reuse the normal process
    // tree cleanup path so an orphaned bundled Harness cannot survive the last
    // VS Code window.
    await this.stopInternal()
  }

  private async waitForSharedRuntimeOrLock(timeoutMs: number): Promise<{ readonly lease: GatewayLease } | { readonly lock: GatewayStartupLock }> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      if (this.disposed) throw new Error('The Harness runtime manager was disposed before launch.')
      const lease = await this.readLiveGatewayLease()
      if (lease !== undefined) return { lease }
      const lock = await tryAcquireGatewayStartupLock(this.gatewayLease)
      if (lock !== undefined) {
        const racedLease = await this.readLiveGatewayLease()
        if (racedLease === undefined) return { lock }
        await lock.release()
        return { lease: racedLease }
      }
      await delay(250)
    }
    throw new Error(`Another VS Code window did not finish starting DeepSeek Harness within ${timeoutMs} ms.`)
  }

  private async readLiveGatewayLease(): Promise<GatewayLease | undefined> {
    try {
      const lease = await readGatewayLease(this.gatewayLease)
      if (!isProcessRunning(lease.pid) || !await probeGateway(lease.url)) return undefined
      if (this.configuration.get().runtimeMode === 'bundled' && !gatewayLeaseMatchesVersion(lease, EXPECTED_DSH_VERSION)) {
        this.logger.warn(`Discarding shared Harness ${lease.version}; bundled extension requires ${EXPECTED_DSH_VERSION}.`)
        await clearGatewayLease(this.gatewayLease, lease.pid)
        await terminateProcessId(lease.pid).catch(error => this.logger.warn(`Could not stop incompatible shared Harness ${lease.pid}: ${errorMessage(error)}`))
        return undefined
      }
      return lease
    } catch {
      return undefined
    }
  }

  private async attachSharedRuntime(lease: GatewayLease): Promise<string> {
    await repairSharedRuntimeAttachments(this.layout, lease.version, this.logger)
      .catch(error => this.logger.warn(`Shared Harness attachment recovery skipped: ${errorMessage(error)}`))
    this.child = undefined
    this.ownedLeasePid = undefined
    this.launchIdentity = undefined
    this.setState({ phase: 'ready', version: lease.version, url: lease.url, pid: lease.pid })
    this.startAttachedLeaseMonitor(lease)
    await this.registerClient()
    this.logger.info(`Attached to shared Harness ${lease.version} on loopback port ${new URL(lease.url).port}`)
    return lease.url
  }

  private async registerClient(): Promise<void> {
    if (this.disposed || this.clientRegistration !== undefined) return
    try {
      const registration = await registerGatewayClient(this.gatewayLease)
      if (this.disposed) {
        await registration.release()
        return
      }
      this.clientRegistration = registration
    } catch (error) {
      // Sharing is an optimization; failure to write the local marker should
      // not prevent the runtime itself from starting.
      this.logger.warn(`Could not register this VS Code host with the shared Harness runtime: ${errorMessage(error)}`)
    }
  }

  private async releaseClient(): Promise<void> {
    const registration = this.clientRegistration
    this.clientRegistration = undefined
    if (registration === undefined) return
    await registration.release().catch(error => this.logger.warn(`Could not release the shared Harness client marker: ${errorMessage(error)}`))
  }

  private startAttachedLeaseMonitor(expected: GatewayLease): void {
    this.stopAttachedLeaseMonitor()
    this.attachedLeaseMonitor = setInterval(() => {
      void readGatewayLease(this.gatewayLease).then(async current => {
        if (this.disposed || this.child !== undefined || this.stateValue.phase !== 'ready' || this.stateValue.pid !== expected.pid) return
        if (current.pid === expected.pid && current.url === expected.url && isProcessRunning(current.pid) && await probeGateway(current.url)) return
        if (this.disposed || this.child !== undefined || this.stateValue.phase !== 'ready' || this.stateValue.pid !== expected.pid) return
        this.stopAttachedLeaseMonitor()
        this.setState({ phase: 'idle' })
      }).catch(() => {
        if (this.disposed || this.child !== undefined || this.stateValue.phase !== 'ready' || this.stateValue.pid !== expected.pid) return
        this.stopAttachedLeaseMonitor()
        this.setState({ phase: 'idle' })
      })
    }, 2_000)
    this.attachedLeaseMonitor.unref()
  }

  private stopAttachedLeaseMonitor(): void {
    if (this.attachedLeaseMonitor !== undefined) clearInterval(this.attachedLeaseMonitor)
    this.attachedLeaseMonitor = undefined
  }

  private fail(error: unknown, version?: string): never {
    const message = errorMessage(error)
    this.logger.error('Harness runtime failure', error)
    this.setState({ phase: 'error', error: message, ...(version === undefined ? {} : { version }) })
    throw error instanceof Error ? error : new Error(message)
  }

  private setState(state: RuntimeState): void {
    this.stateValue = state
    this.changed.fire(state)
  }
}

/** Repair attachment objects before a new extension host reuses a live shared runtime. */
async function repairSharedRuntimeAttachments(layout: StorageLayout, version: string, logger: Logger): Promise<void> {
  const target = versionedHome(layout, version)
  try {
    await stat(target)
  } catch {
    return
  }
  let entries: string[]
  try {
    entries = await readdir(layout.harnessHomes)
  } catch {
    return
  }
  const targetName = version.replace(/[^a-zA-Z0-9._-]/gu, '_') || 'unknown'
  const candidates = entries.filter(name => name !== targetName).sort()
  const copied = await recoverMissingAttachments(layout.harnessHomes, candidates, target)
  if (copied > 0) logger.info(`Recovered ${String(copied)} missing Harness attachment object${copied === 1 ? '' : 's'} before attaching to shared runtime`)
}

/** alpha.3 joins its provider namespace with `/chat/completions` itself. */
export function normalizeProviderBaseUrl(value: string): string {
  return value.replace(/\/+$/u, '')
}

function workspaceDirectory(): string {
  const active = vscode.window.activeTextEditor?.document.uri
  if (active !== undefined) {
    const folder = vscode.workspace.getWorkspaceFolder(active)
    if (folder !== undefined) return folder.uri.fsPath
  }
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd()
}

async function probeGateway(baseUrl: string): Promise<boolean> {
  try {
    const endpoint = new URL(baseUrl)
    endpoint.pathname = '/'
    endpoint.hash = ''
    const response = await fetch(endpoint, {
      method: 'GET',
      redirect: 'manual',
      signal: AbortSignal.timeout(2_000),
    })
    // alpha.3 returns 303 after accepting the process token. Older compatible
    // external runtimes may serve the index directly with a 2xx response.
    return response.status === 303 || response.ok
  } catch {
    return false
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, milliseconds))
}

async function writeAtomic(target: string, content: string): Promise<void> {
  const temporary = `${target}.tmp-${process.pid}`
  await writeFile(temporary, content, 'utf8')
  await rm(target, { force: true })
  await rename(temporary, target)
}

async function migrateHarnessHomeIfNeeded(layout: StorageLayout, target: string, version: string, logger: Logger): Promise<void> {
  const targetName = version.replace(/[^a-zA-Z0-9._-]/gu, '_') || 'unknown'
  let targetExists = true
  try {
    await stat(target)
  } catch {
    // target home does not exist yet
    targetExists = false
  }
  let entries
  try {
    entries = await readdir(layout.harnessHomes)
  } catch {
    return
  }
  const candidates = entries.filter(name => name !== targetName).sort()
  if (targetExists) {
    // Older releases migrated sessions and settings but forgot the durable
    // content-addressed image store. Merge only missing objects from the most
    // recent prior home that still has an attachment tree; never overwrite the
    // current home or touch session logs.
    const copied = await recoverMissingAttachments(layout.harnessHomes, candidates, target)
    if (copied > 0) logger.info(`Recovered ${String(copied)} missing Harness attachment object${copied === 1 ? '' : 's'} from prior Harness homes`)
    return
  }
  const sourceName = candidates[candidates.length - 1]
  if (sourceName === undefined) return
  const source = path.join(layout.harnessHomes, sourceName)
  await mkdir(target, { recursive: true })
  for (const part of ['sessions', 'storages', 'settings.yaml', '.anonymous-user-id']) {
    const from = path.join(source, part)
    try {
      await stat(from)
    } catch {
      continue
    }
    await cp(from, path.join(target, part), { recursive: true })
  }
  const copied = await recoverMissingAttachments(layout.harnessHomes, candidates, target)
  if (copied > 0) logger.info(`Recovered ${String(copied)} Harness attachment object${copied === 1 ? '' : 's'} during migration`)
  logger.info(`Migrated Harness home data from ${sourceName} to ${version}`)
}

export async function recoverMissingAttachments(homes: string, candidates: readonly string[], target: string): Promise<number> {
  let copied = 0
  for (const name of [...candidates].reverse()) {
    try {
      await stat(path.join(homes, name, 'attachments'))
    } catch {
      // Try the next older version; an absent tree is normal for pre-image homes.
      continue
    }
    copied += await copyMissingTree(
      path.join(homes, name, 'attachments'),
      path.join(target, 'attachments'),
    )
  }
  return copied
}

/** Merge a trusted old attachment tree without replacing current objects. */
export async function copyMissingTree(source: string, target: string): Promise<number> {
  let entries
  try {
    entries = await readdir(source, { withFileTypes: true })
  } catch {
    return 0
  }
  await mkdir(target, { recursive: true })
  let copied = 0
  for (const entry of entries) {
    const from = path.join(source, entry.name)
    const to = path.join(target, entry.name)
    if (entry.isDirectory()) {
      copied += await copyMissingTree(from, to)
      continue
    }
    if (!entry.isFile()) continue
    try {
      await stat(to)
      continue
    } catch {
      // The object is absent in the current versioned home.
    }
    try {
      await copyFile(from, to, fsConstants.COPYFILE_EXCL)
      copied += 1
    } catch (error: unknown) {
      // Another VS Code window may have restored the same object first.
      if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error
    }
  }
  return copied
}

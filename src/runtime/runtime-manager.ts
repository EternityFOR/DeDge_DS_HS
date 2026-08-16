import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import * as vscode from 'vscode'
import type { ConfigurationService, HarnessConfiguration } from '../config/configuration.js'
import type { Logger } from '../platform/logger.js'
import { errorMessage } from '../platform/logger.js'
import type { StorageLayout } from '../platform/storage.js'
import { versionedHome } from '../platform/storage.js'
import type { CredentialStore } from '../security/credentials.js'
import type { RuntimeResolver } from './bundled-runtime.js'
import { renderRuntimeOverlay } from './overlay.js'
import { terminateProcessTree } from './process-tree.js'
import type { RuntimeLaunch, RuntimeState } from './types.js'
import { clearGatewayLease, defaultGatewayLeasePath, writeGatewayLease } from './gateway-lease.js'
import { checkWindowsCompatibility, describeWindowsExitCode } from './windows-compat.js'

const URL_PATTERN = /dsh web:\s+(http:\/\/127\.0\.0\.1:\d+)/u

export class RuntimeManager implements vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<RuntimeState>()
  private child: ChildProcessWithoutNullStreams | undefined
  private stateValue: RuntimeState = { phase: 'idle' }
  private startTask: Promise<string> | undefined
  private stopTask: Promise<void> | undefined
  private launchIdentity: string | undefined
  private readonly gatewayLease = defaultGatewayLeasePath()
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
    // Stop first so an in-flight resolver cannot leave a child behind after
    // the extension host has begun shutting down. startInternal checks the
    // flag again immediately before spawning.
    await this.stop()
    const pendingStart = this.startTask
    if (pendingStart !== undefined) await pendingStart.catch(() => undefined)
    this.changed.dispose()
  }

  private async startInternal(): Promise<string> {
    const configuration = this.configuration.get()
    const workspace = workspaceDirectory()
    const apiKey = await this.credentials.getApiKey()
    this.setState({ phase: 'resolving' })

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
    const generatedDir = path.join(this.layout.generated, launch.version)
    const overlay = path.join(generatedDir, 'vscode.patch.yml')
    await Promise.all([mkdir(home, { recursive: true }), mkdir(generatedDir, { recursive: true })])
    await writeAtomic(overlay, renderRuntimeOverlay(configuration))

    const args = [...launch.args, 'web', '--patch', overlay, '--host', '127.0.0.1', '--port', '0']
    const env: NodeJS.ProcessEnv = {
      ...launch.environment,
      DSH_HOME: home,
      DSH_CWD: workspace,
      DSH_PERMISSION_MODE: configuration.permissionMode,
      DSH_TELEMETRY_DISABLED: '1',
      ...apiKey === undefined || apiKey === '' ? {} : { DEEPSEEK_API_KEY: apiKey },
      DEEPSEEK_BASE_URL: configuration.baseUrl,
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
        if (child.pid !== undefined) {
          void clearGatewayLease(this.gatewayLease, child.pid).catch(error => this.logger.error('Failed to clear the Harness gateway lease', error))
        }
        const windowsDetail = describeWindowsExitCode(code)
        const message = `Harness exited (code=${String(code)}, signal=${String(signal)}).${windowsDetail === undefined ? '' : ` ${windowsDetail}`}`
        if (!settled) settle(new Error(message))
        else if (this.stateValue.phase !== 'stopping' && this.stateValue.phase !== 'idle') {
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
      return url
    } catch (error) {
      await terminateProcessTree(child).catch(cause => this.logger.error('Failed to clean up a failed runtime start', cause))
      if (this.child === child) this.child = undefined
      return this.fail(error, launch.version)
    }
  }

  private async stopInternal(): Promise<void> {
    const child = this.child
    this.child = undefined
    this.launchIdentity = undefined
    if (child === undefined) {
      if (this.stateValue.pid !== undefined) {
        await clearGatewayLease(this.gatewayLease, this.stateValue.pid).catch(error => this.logger.error('Failed to clear the Harness gateway lease', error))
      }
      this.setState({ phase: 'idle' })
      return
    }
    this.setState({ phase: 'stopping', ...(this.stateValue.version === undefined ? {} : { version: this.stateValue.version }) })
    await terminateProcessTree(child).catch(error => this.logger.error('Failed to terminate the Harness process tree', error))
    if (child.pid !== undefined) {
      await clearGatewayLease(this.gatewayLease, child.pid).catch(error => this.logger.error('Failed to clear the Harness gateway lease', error))
    }
    this.setState({ phase: 'idle' })
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

function workspaceDirectory(): string {
  const active = vscode.window.activeTextEditor?.document.uri
  if (active !== undefined) {
    const folder = vscode.workspace.getWorkspaceFolder(active)
    if (folder !== undefined) return folder.uri.fsPath
  }
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd()
}

async function writeAtomic(target: string, content: string): Promise<void> {
  const temporary = `${target}.tmp-${process.pid}`
  await writeFile(temporary, content, 'utf8')
  await rm(target, { force: true })
  await rename(temporary, target)
}

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import * as vscode from 'vscode'
import type { ConfigurationService } from '../config/configuration.js'
import type { StorageLayout } from '../platform/storage.js'
import type { RuntimeManager } from './runtime-manager.js'
import { resolvePowerShell } from './windows-compat.js'

const execFileAsync = promisify(execFile)

export class RuntimeDiagnostics {
  constructor(
    private readonly configuration: ConfigurationService,
    private readonly runtime: RuntimeManager,
    private readonly layout: StorageLayout,
  ) {}

  async generate(): Promise<string> {
    const config = this.configuration.get()
    const workspace = vscode.workspace.workspaceFolders?.map(folder => folder.uri.fsPath).join(' | ') ?? '<none>'
    const powershell = process.platform === 'win32' ? await resolvePowerShell() : undefined
    const [git, node] = await Promise.all([versionOf('git', ['--version']), versionOf(process.execPath, ['--version'])])
    return [
      'DeDge DeepSeek Harness diagnostics',
      `Generated: ${new Date().toISOString()}`,
      `VS Code: ${vscode.version}`,
      `Extension host Node: ${process.versions.node}`,
      `Platform: ${process.platform}-${process.arch}`,
      `Remote name: ${vscode.env.remoteName ?? '<local>'}`,
      `Workspace trusted: ${String(vscode.workspace.isTrusted)}`,
      `Workspace folders: ${workspace}`,
      `Runtime mode: ${config.runtimeMode}`,
      `Runtime state: ${JSON.stringify(this.runtime.state)}`,
      `Permission mode: ${config.permissionMode}`,
      `Configured context window: ${String(config.contextWindowTokens)} tokens`,
      `Configured endpoint: ${redactUrl(config.baseUrl)}`,
      `PowerShell: ${powershell ?? '<not applicable or not found>'}`,
      `Git: ${git}`,
      `Host executable: ${node}`,
      `Global storage: ${this.layout.root}`,
      `ComSpec: ${process.env.ComSpec ?? process.env.comspec ?? '<unset>'}`,
      `PATHEXT: ${process.env.PATHEXT ?? '<unset>'}`,
      '',
      'No API keys or credential values are included.',
    ].join('\n')
  }
}

async function versionOf(command: string, args: string[]): Promise<string> {
  try {
    const result = await execFileAsync(command, args, { windowsHide: true, timeout: 8_000, encoding: 'utf8' })
    return result.stdout.trim() || '<no output>'
  } catch (error) {
    return `<unavailable: ${error instanceof Error ? error.message : String(error)}>`
  }
}

function redactUrl(value: string): string {
  try {
    const url = new URL(value)
    url.username = ''
    url.password = ''
    url.search = ''
    url.hash = ''
    return url.toString()
  } catch {
    return '<invalid URL>'
  }
}

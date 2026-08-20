import { mkdir, writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import * as vscode from 'vscode'
import type { ConfigurationService } from '../config/configuration.js'
import { errorMessage, type Logger } from '../platform/logger.js'
import type { StorageLayout } from '../platform/storage.js'
import type { WorkbenchController } from '../session/workbench-controller.js'
import { listCodexSessionsViaAppServer } from './codex-app-server.js'
import { createHandoffPackage, createStagedHandoff, platformName, renderHandoffMarkdown, renderTargetPrompt } from './handoff-format.js'
import { launchHandoffTarget, resolveAgentCli } from './cli-launcher.js'
import { groupExternalSessions } from './session-groups.js'
import { expandUserPath, listExternalSessions as listJsonlSessions, readExternalSession } from './session-readers.js'
import type { AgentPlatform, ExternalAgentPlatform, ExternalSessionDescriptor, HandoffSource, StagedHandoff, StoredHandoff } from './types.js'

export class HandoffService {
  constructor(
    private readonly configuration: ConfigurationService,
    private readonly controller: WorkbenchController,
    private readonly layout: StorageLayout,
    private readonly logger: Logger,
    private readonly globalState?: vscode.Memento,
  ) {}

  async run(): Promise<StagedHandoff | undefined> {
    const source = await this.pickSource()
    if (source === undefined) return undefined
    const target = await this.pickTarget(source.platform)
    if (target === undefined) return undefined
    return this.execute(source, target)
  }

  async loadIntoHarness(platform: ExternalAgentPlatform): Promise<StagedHandoff | undefined> {
    const source = await this.pickExternalSource(platform)
    if (source === undefined) return undefined
    return this.execute(source, 'deepseek-harness')
  }

  async handoffCurrentHarness(): Promise<StagedHandoff | undefined> {
    const source = this.currentHarnessSource()
    const target = await this.pickTarget('deepseek-harness')
    if (target === undefined) return undefined
    return this.execute(source, target)
  }

  private async execute(source: HandoffSource, target: AgentPlatform): Promise<StagedHandoff | undefined> {
    if (source.turns.length === 0) throw new Error(`${platformName(source.platform)} session has no user/assistant text to hand off.`)
    const folders = vscode.workspace.workspaceFolders?.map(folder => folder.uri.fsPath) ?? []
    const value = createHandoffPackage(source, folders, this.configuration.get().handoffMaxBytes)
    const stored = await this.store(value)
    let staged: StagedHandoff | undefined
    if (target === 'deepseek-harness') {
      await this.controller.newSession()
      const activeId = this.controller.snapshot().activeSessionId
      if (activeId !== undefined) {
        const label = platformName(value.source.platform)
        const title = `${label}: ${value.source.title.trim() || `${label} session`}`.slice(0, 100)
        await this.controller.renameSession(activeId, title)
          .catch(error => this.logger.warn(`Could not rename the imported ${label} session: ${errorMessage(error)}`))
      }
      staged = createStagedHandoff(value)
    } else {
      const label = platformName(target)
      const defaultClipboard = this.configuration.get().handoffLaunchMode !== 'cli'
      const mode = await vscode.window.showQuickPick([
        {
          label: '$(clippy) Copy take-over prompt to clipboard',
          description: 'Paste it into a new session in your VS Code extension',
          detail: 'Recommended: no terminal is spawned and the original sessions stay untouched.',
          mode: 'clipboard',
          ...(defaultClipboard ? { picked: true } : {}),
        },
        {
          label: '$(terminal) Launch CLI session with the prompt',
          description: 'Spawns the native CLI or extension executable directly',
          mode: 'cli',
          ...(defaultClipboard ? {} : { picked: true }),
        },
      ], {
        title: `Hand off to ${label}`,
        placeHolder: 'Choose how to continue the task on the target platform',
      })
      if (mode === undefined) return undefined
      if (mode.mode === 'cli') {
        await launchHandoffTarget(target, stored, this.configuration.get())
      } else {
        await vscode.env.clipboard.writeText(renderTargetPrompt(value))
        void vscode.window.showInformationMessage(`${label} take-over prompt copied to the clipboard. Open a new ${label} session in your ${label} VS Code extension and paste it to continue.`)
        this.logger.info(`Copied ${label} handoff ${value.id} take-over prompt to the clipboard`)
      }
    }
    this.logger.info(`Created isolated handoff ${value.id}: ${platformName(source.platform)} -> ${platformName(target)}`)
    return staged
  }

  private async pickSource(): Promise<HandoffSource | undefined> {
    const snapshot = this.controller.snapshot()
    const active = snapshot.sessions.find(session => session.id === snapshot.activeSessionId)
    const items: { readonly label: string; readonly description: string; readonly platform: AgentPlatform }[] = []
    if (active !== undefined) items.push({ label: 'Current DeepSeek Harness session', description: active.title, platform: 'deepseek-harness' })
    items.push(
      { label: 'Local Codex session', description: 'Read-only copy; the Codex transcript is never changed', platform: 'codex' },
      { label: 'Local Claude Code session', description: 'Read-only copy; the Claude transcript is never changed', platform: 'claude' },
    )
    const picked = await vscode.window.showQuickPick(items, { title: 'Hand off from', matchOnDescription: true })
    if (picked === undefined) return undefined
    if (picked.platform === 'deepseek-harness') return this.currentHarnessSource()
    return this.pickExternalSource(picked.platform)
  }

  private currentHarnessSource(): HandoffSource {
    const snapshot = this.controller.snapshot()
    const active = snapshot.sessions.find(session => session.id === snapshot.activeSessionId)
    if (active === undefined) throw new Error('No DeepSeek Harness session is active.')
    return {
      platform: 'deepseek-harness',
      sessionId: active.id,
      title: active.title,
      turns: snapshot.messages
        .filter(message => message.role === 'user' || message.role === 'assistant')
        .map(message => ({ role: message.role as 'user' | 'assistant', text: message.text })),
      ...(active.cwd === undefined ? {} : { cwd: active.cwd }),
    }
  }

  private async pickExternalSource(platform: ExternalAgentPlatform): Promise<HandoffSource | undefined> {
    const configuration = this.configuration.get()
    const home = platform === 'codex' ? configuration.codexHome : configuration.claudeHome
    const sessions = await vscode.window.withProgress({
      location: vscode.ProgressLocation.Window,
      title: `Reading ${platformName(platform)} sessions`,
    }, () => this.discoverExternalSessions(platform, home))
    if (sessions.length === 0) throw new Error(`No active root ${platformName(platform)} sessions were found in the configured home.`)
    const workspaceFolders = vscode.workspace.workspaceFolders?.map(folder => folder.uri.fsPath) ?? []
    const items = groupExternalSessions(sessions, workspaceFolders).flatMap(group => [
      { label: group.label, kind: vscode.QuickPickItemKind.Separator },
      ...group.sessions.map(session => sessionItem(session)),
    ])
    const picked = await vscode.window.showQuickPick(items, {
      title: `Select active ${platformName(platform)} root session`,
      placeHolder: 'Search by session title, project, date, or ID',
      matchOnDescription: true,
      matchOnDetail: true,
    })
    if (picked === undefined || !('session' in picked)) return undefined
    if (!await this.confirmExternalLoad(platform, picked.session)) return undefined
    return vscode.window.withProgress({
      location: vscode.ProgressLocation.Window,
      title: `Preparing ${platformName(platform)} handoff`,
    }, () => readExternalSession(picked.session, configuration.handoffMaxBytes))
  }

  private async discoverExternalSessions(platform: ExternalAgentPlatform, configuredHome: string): Promise<ExternalSessionDescriptor[]> {
    if (platform === 'codex') {
      try {
        const configuration = this.configuration.get()
        const executable = await resolveAgentCli('codex', configuration)
        const sessions = await listCodexSessionsViaAppServer(executable, expandUserPath(configuredHome))
        this.logger.info(`Codex app-server returned ${String(sessions.length)} active current-provider root sessions.`)
        return sessions
      } catch (error) {
        this.logger.warn(`Codex app-server history discovery unavailable; using filtered JSONL fallback: ${errorMessage(error)}`)
      }
    }
    return listJsonlSessions(platform, configuredHome)
  }

  private async confirmExternalLoad(platform: ExternalAgentPlatform, session: ExternalSessionDescriptor): Promise<boolean> {
    const key = `handoff.readOnlyNotice.${platform}`
    if (this.globalState?.get<boolean>(key, false) === true) return true
    const source = platformName(platform)
    const resume = platform === 'codex' ? 'Codex /resume' : 'Claude Code --resume'
    const choice = await vscode.window.showInformationMessage(
      `Load "${session.title}" as an isolated read-only handoff? The extension only reads a bounded text copy and creates a new DeepSeek Harness session with an unsent draft. It never writes to ${source} session files or starts a model turn until you press Send. You can return to the untouched original with ${resume}; hand off the DeepSeek result back to continue in a separate new ${source} session.`,
      { modal: true },
      'Load Read-Only',
    )
    if (choice !== 'Load Read-Only') return false
    await this.globalState?.update(key, true)
    return true
  }

  private async pickTarget(source: AgentPlatform): Promise<AgentPlatform | undefined> {
    const items = ([
      { platform: 'deepseek-harness', label: 'DeepSeek Harness', description: 'Create an isolated DSH session' },
      { platform: 'codex', label: 'Codex', description: 'Start the native CLI in a new VS Code terminal' },
      { platform: 'claude', label: 'Claude Code', description: 'Start the native CLI in a new VS Code terminal' },
    ] as const).filter(item => item.platform !== source)
    return (await vscode.window.showQuickPick(items, { title: 'Continue in', matchOnDescription: true }))?.platform
  }

  private async store(value: ReturnType<typeof createHandoffPackage>): Promise<StoredHandoff> {
    const directory = path.join(this.layout.handoffs, value.id)
    const jsonPath = path.join(directory, 'handoff.json')
    const markdownPath = path.join(directory, 'handoff.md')
    await mkdir(directory, { recursive: false })
    await Promise.all([
      writeFile(jsonPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' }),
      writeFile(markdownPath, renderHandoffMarkdown(value), { encoding: 'utf8', flag: 'wx' }),
    ])
    return { value, directory, jsonPath, markdownPath }
  }
}

function sessionItem(session: ExternalSessionDescriptor): vscode.QuickPickItem & { readonly session: ExternalSessionDescriptor } {
  return {
    label: session.title,
    description: `${formatPickerTime(session.updatedAt)}  ${session.id.slice(0, 8)}`,
    detail: `${session.cwd === undefined ? 'Workspace not recorded' : session.cwd}  -  Read-only; source transcript stays untouched.`,
    session,
  }
}

function formatPickerTime(value: number): string {
  return new Date(value).toLocaleString(undefined, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

import * as vscode from 'vscode'
import { ConfigurationService, normalizeBaseUrl, parseTokenCount } from './config/configuration.js'
import { ChangeReviewService } from './diff/change-review.js'
import { HandoffService } from './handoff/handoff-service.js'
import { Logger, errorMessage } from './platform/logger.js'
import { createStorageLayout } from './platform/storage.js'
import { RuntimeResolver } from './runtime/bundled-runtime.js'
import { RuntimeDiagnostics } from './runtime/diagnostics.js'
import { RuntimeManager } from './runtime/runtime-manager.js'
import { CredentialStore } from './security/credentials.js'
import { WorkbenchController } from './session/workbench-controller.js'
import { SessionTrashService } from './session/session-trash.js'
import { ChatViewProvider } from './ui/chat-view.js'

let activeController: WorkbenchController | undefined
let activeRuntime: RuntimeManager | undefined

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  await vscode.commands.executeCommand('setContext', 'dedgeDeepSeekHarness.enabled', true)
  const layout = await createStorageLayout(context)
  const logger = new Logger(vscode.window.createOutputChannel('DeDge DeepSeek Harness', { log: true }))
  const configuration = new ConfigurationService()
  const credentials = new CredentialStore(context.secrets)
  const resolver = new RuntimeResolver(context, layout, logger)
  const runtime = new RuntimeManager(configuration, credentials, resolver, layout, logger)
  const sessionTrash = new SessionTrashService(layout)
  const controller = new WorkbenchController(context, configuration, credentials, runtime, logger, sessionTrash)
  const review = new ChangeReviewService(layout)
  const diagnostics = new RuntimeDiagnostics(configuration, runtime, layout)
  const handoff = new HandoffService(configuration, controller, layout, logger, context.globalState)
  activeController = controller
  activeRuntime = runtime

  const setApiKey = async (): Promise<void> => {
    const endpoint = await vscode.window.showInputBox({
      title: 'DeepSeek connection [1/2] - API base URL',
      prompt: 'Use the official endpoint or an http/https OpenAI-compatible sub2 endpoint.',
      value: configuration.get().baseUrl,
      ignoreFocusOut: true,
      validateInput: input => {
        try {
          normalizeBaseUrl(input)
          return undefined
        } catch (error) {
          return errorMessage(error)
        }
      },
    })
    if (endpoint === undefined) return
    const existing = await credentials.getApiKey()
    const value = await vscode.window.showInputBox({
      title: 'DeepSeek connection [2/2] - API key',
      prompt: existing === undefined
        ? 'Stored only in VS Code SecretStorage and passed to the local Harness process.'
        : 'Enter a replacement key, or leave blank to keep the existing SecretStorage value.',
      password: true,
      ignoreFocusOut: true,
      validateInput: input => existing === undefined && input.trim() === '' ? 'The API key cannot be empty.' : undefined,
    })
    if (value === undefined) return
    const normalizedEndpoint = normalizeBaseUrl(endpoint)
    if (value.trim() !== '') await credentials.setApiKey(value.trim())
    await configuration.update('baseUrl', normalizedEndpoint)
    if (runtime.state.phase === 'ready') await controller.restart()
    void vscode.window.showInformationMessage('DeepSeek API credentials configured. The key remains in SecretStorage.')
  }

  const showDiagnostics = async (): Promise<void> => {
    const text = await diagnostics.generate()
    const document = await vscode.workspace.openTextDocument({ language: 'plaintext', content: text })
    await vscode.window.showTextDocument(document, { preview: true })
  }

  const configureContextWindow = async (): Promise<void> => {
    const current = configuration.get().contextWindowTokens
    const preset = controller.snapshot().agentPreset
    const value = await vscode.window.showInputBox({
      title: 'Context capacity and automatic compaction',
      prompt: contextConfigurationPrompt(current, preset),
      value: formatTokenCount(current),
      ignoreFocusOut: true,
      validateInput: input => {
        try {
          parseTokenCount(input)
          return undefined
        } catch (error) {
          return errorMessage(error)
        }
      },
    })
    if (value === undefined) return
    const tokens = parseTokenCount(value)
    if (tokens === current) return
    const ready = runtime.state.phase === 'ready'
    if (ready) {
      const choice = await vscode.window.showWarningMessage(
        contextApplyMessage(tokens, preset),
        { modal: true },
        'Apply and Restart',
      )
      if (choice !== 'Apply and Restart') return
    }
    await configuration.updateContextWindowTokens(tokens)
    if (ready) await controller.restart()
    else void vscode.window.showInformationMessage(`Context window set to ${formatTokenCount(tokens)}. It will apply on the next runtime start.`)
  }

  const view = new ChatViewProvider(context, controller, review, logger, {
    setApiKey,
    diagnose: showDiagnostics,
    handoff: () => handoff.run(),
    loadCodexSession: () => handoff.loadIntoHarness('codex'),
    loadClaudeSession: () => handoff.loadIntoHarness('claude'),
    handoffCurrentSession: () => handoff.handoffCurrentHarness(),
    configureContextWindow,
  })
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 20)
  status.name = 'DeepSeek Harness'
  status.command = 'dedgeDeepSeekHarness.openChat'
  status.tooltip = 'Open DeepSeek Harness workbench'
  status.text = '$(sparkle) DSH'
  status.show()

  const updateStatus = (): void => {
    const state = runtime.state
    status.text = state.phase === 'ready'
      ? '$(sparkle-filled) DSH'
      : state.phase === 'error' ? '$(error) DSH' : state.phase === 'starting' || state.phase === 'resolving' ? '$(loading~spin) DSH' : '$(sparkle) DSH'
    status.backgroundColor = state.phase === 'error' ? new vscode.ThemeColor('statusBarItem.errorBackground') : undefined
    status.tooltip = state.error ?? `DeepSeek Harness: ${state.phase}`
  }

  const run = async (action: () => Promise<unknown>): Promise<void> => {
    try {
      await action()
    } catch (error) {
      logger.error('Command failed', error)
      void vscode.window.showErrorMessage(`DeepSeek Harness: ${errorMessage(error)}`, 'Show Logs').then(choice => {
        if (choice === 'Show Logs') logger.show()
      })
    }
  }

  let autoStartSuppressed = false
  let autoStartTimer: ReturnType<typeof setTimeout> | undefined
  let autoStartTask: Promise<void> | undefined
  let autoStartDelayMs = 1_000
  const clearAutoStartTimer = (): void => {
    if (autoStartTimer !== undefined) clearTimeout(autoStartTimer)
    autoStartTimer = undefined
  }
  const scheduleAutoStart = (delayMs = 0): void => {
    if (autoStartSuppressed || !vscode.workspace.isTrusted || !configuration.get().autoStart ||
      autoStartTimer !== undefined || autoStartTask !== undefined ||
      (runtime.state.phase !== 'idle' && runtime.state.phase !== 'error')) return
    autoStartTimer = setTimeout(() => {
      autoStartTimer = undefined
      if (autoStartSuppressed || !vscode.workspace.isTrusted || !configuration.get().autoStart ||
        (runtime.state.phase !== 'idle' && runtime.state.phase !== 'error')) return
      const task = controller.start().then(() => {
        autoStartDelayMs = 1_000
      }).catch(error => {
        logger.error('Automatic Harness startup failed', error)
        autoStartDelayMs = Math.min(autoStartDelayMs * 2, 30_000)
      }).finally(() => {
        if (autoStartTask === task) autoStartTask = undefined
        if (runtime.state.phase === 'idle' || runtime.state.phase === 'error') scheduleAutoStart(autoStartDelayMs)
      })
      autoStartTask = task
    }, delayMs)
  }
  const allowAndStart = (): Promise<void> => {
    autoStartSuppressed = false
    clearAutoStartTimer()
    return controller.start()
  }
  const stopAndSuppress = async (): Promise<void> => {
    autoStartSuppressed = true
    clearAutoStartTimer()
    await controller.stop()
  }

  context.subscriptions.push(
    logger,
    configuration,
    view,
    status,
    runtime.onDidChangeState(state => {
      updateStatus()
      if (state.phase === 'ready') autoStartDelayMs = 1_000
      else if (state.phase === 'idle' || state.phase === 'error') scheduleAutoStart(state.phase === 'error' ? autoStartDelayMs : 250)
    }),
    configuration.onDidChange(next => {
      if (!next.autoStart) {
        autoStartSuppressed = true
        clearAutoStartTimer()
        return
      }
      autoStartSuppressed = false
      scheduleAutoStart()
    }),
    { dispose: clearAutoStartTimer },
    vscode.window.registerWebviewViewProvider(ChatViewProvider.viewType, view, { webviewOptions: { retainContextWhenHidden: true } }),
    vscode.commands.registerCommand('dedgeDeepSeekHarness.openChat', () => view.focus()),
    vscode.commands.registerCommand('dedgeDeepSeekHarness.newSession', () => run(() => controller.newSession())),
    vscode.commands.registerCommand('dedgeDeepSeekHarness.selectSession', () => run(() => view.pickSession())),
    vscode.commands.registerCommand('dedgeDeepSeekHarness.manageSession', () => run(() => view.manageSession())),
    vscode.commands.registerCommand('dedgeDeepSeekHarness.start', () => run(allowAndStart)),
    vscode.commands.registerCommand('dedgeDeepSeekHarness.stop', () => run(stopAndSuppress)),
    vscode.commands.registerCommand('dedgeDeepSeekHarness.restart', () => run(async () => {
      autoStartSuppressed = false
      clearAutoStartTimer()
      await controller.restart()
    })),
    vscode.commands.registerCommand('dedgeDeepSeekHarness.setApiKey', () => run(setApiKey)),
    vscode.commands.registerCommand('dedgeDeepSeekHarness.clearApiKey', () => run(async () => {
      const clear = await vscode.window.showWarningMessage('Clear the DeepSeek API key from VS Code SecretStorage?', { modal: true }, 'Clear')
      if (clear !== 'Clear') return
      await credentials.clearApiKey()
      if (runtime.state.phase === 'ready') await controller.restart()
    })),
    vscode.commands.registerCommand('dedgeDeepSeekHarness.addSelection', () => run(() => view.attachSelection())),
    vscode.commands.registerCommand('dedgeDeepSeekHarness.addFile', (uri?: vscode.Uri, selected?: vscode.Uri[]) => run(async () => {
      const active = vscode.window.activeTextEditor?.document.uri
      const targets = selected !== undefined && selected.length > 0 ? selected : uri === undefined ? (active === undefined ? [] : [active]) : [uri]
      if (targets.length === 0) throw new Error('No file is available to attach.')
      await view.attachUris(targets)
    })),
    vscode.commands.registerCommand('dedgeDeepSeekHarness.handoff', () => run(() => view.handoff())),
    vscode.commands.registerCommand('dedgeDeepSeekHarness.reviewChanges', () => run(() => review.open())),
    vscode.commands.registerCommand('dedgeDeepSeekHarness.diagnose', () => run(showDiagnostics)),
    vscode.commands.registerCommand('dedgeDeepSeekHarness.showLogs', () => logger.show()),
    vscode.workspace.onDidGrantWorkspaceTrust(() => {
      updateStatus()
      autoStartSuppressed = false
      scheduleAutoStart()
    }),
  )
  updateStatus()
  scheduleAutoStart()
}

export async function deactivate(): Promise<void> {
  await activeController?.stop().catch(() => undefined)
  await activeController?.dispose()
  await activeRuntime?.dispose()
  activeController = undefined
  activeRuntime = undefined
}

function formatTokenCount(tokens: number): string {
  if (tokens % 1_000_000 === 0) return `${String(tokens / 1_000_000)}M`
  if (tokens % 1_000 === 0) return `${String(tokens / 1_000)}K`
  return String(tokens)
}

function compactionTrigger(capacity: number): number {
  return Math.floor(capacity * 0.8)
}

function contextConfigurationPrompt(capacity: number, preset: string): string {
  const base = 'DeepSeek defaults to the maximum 1M capacity.'
  if (preset === 'minimal') return `${base} The Minimal preset has no automatic or manual compaction.`
  if (preset === 'standard' || preset === 'code' || preset === 'cordis') {
    return `${base} The ${preset} preset automatically compacts at 80% (${formatTokenCount(compactionTrigger(capacity))} currently) to preserve response headroom. Manual compaction may run earlier whenever the session is idle and has a useful completed range.`
  }
  return `${base} Automatic compaction support and its trigger are defined by the selected custom preset.`
}

function contextApplyMessage(capacity: number, preset: string): string {
  const formatted = formatTokenCount(capacity)
  if (preset === 'minimal') return `Apply ${formatted} context capacity and restart the local Harness runtime? The Minimal preset has no compaction.`
  if (preset === 'standard' || preset === 'code' || preset === 'cordis') {
    return `Apply ${formatted} context capacity (automatic compaction at ${formatTokenCount(compactionTrigger(capacity))}) and restart the local Harness runtime?`
  }
  return `Apply ${formatted} context capacity and restart the local Harness runtime? The selected custom preset controls automatic compaction.`
}

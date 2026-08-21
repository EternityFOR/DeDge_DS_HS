import { randomBytes } from 'node:crypto'
import * as vscode from 'vscode'
import type { ContextAttachment } from '../context/context-collector.js'
import type { ChangeReviewService } from '../diff/change-review.js'
import { errorMessage, type Logger } from '../platform/logger.js'
import type { WorkbenchController } from '../session/workbench-controller.js'
import type { WorkbenchSession } from '../session/types.js'
import { isRecord } from '../gateway/protocol.js'
import type { HostToWebviewMessage, WebviewToHostMessage, WorkbenchSettings } from './webview-protocol.js'
import type { StagedHandoff } from '../handoff/types.js'
import { parsePendingHandoffState, type PendingHandoffState } from '../handoff/pending-handoff.js'

const PENDING_HANDOFF_KEY = 'pendingHandoff.v1'

export interface ChatViewActions {
  readonly setApiKey: () => Promise<void>
  readonly diagnose: () => Promise<void>
  readonly handoff: () => Promise<StagedHandoff | undefined>
  readonly loadCodexSession: () => Promise<StagedHandoff | undefined>
  readonly loadClaudeSession: () => Promise<StagedHandoff | undefined>
  readonly handoffCurrentSession: () => Promise<StagedHandoff | undefined>
  readonly configureContextWindow: () => Promise<void>
  readonly getSettings: () => Promise<WorkbenchSettings>
  readonly saveSettings: (settings: WorkbenchSettings & { readonly apiKey?: string; readonly visionApiKey?: string }) => Promise<void>
}

type SessionPickerAction = 'new-session' | 'browse-sessions' | 'load-codex' | 'load-claude' | 'handoff-current'
type SessionPickerItem = vscode.QuickPickItem & ({ readonly sessionId: string } | { readonly action: SessionPickerAction } | Record<never, never>)

export class ChatViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  static readonly viewType = 'dedgeDeepSeekHarness.chat'

  private view: vscode.WebviewView | undefined
  private attachments: ContextAttachment[] = []
  private readonly managingSessions = new Set<string>()
  private readonly controllerSubscription: vscode.Disposable
  private pendingHandoff: PendingHandoffState | undefined
  private restoredHandoffSessionId: string | undefined
  private statePostTimer: ReturnType<typeof setTimeout> | undefined
  private statePostScheduled = false
  private pendingImageFiles: readonly { readonly name: string; readonly dataUrl: string }[] = []

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly controller: WorkbenchController,
    private readonly review: ChangeReviewService,
    private readonly logger: Logger,
    private readonly actions: ChatViewActions,
  ) {
    this.pendingHandoff = parsePendingHandoffState(context.workspaceState.get<unknown>(PENDING_HANDOFF_KEY))
    this.controllerSubscription = controller.onDidChange(() => {
      this.scheduleStatePost()
    })
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'dist')],
    }
    view.webview.html = renderHtml(view.webview, this.context.extensionUri)
    view.webview.onDidReceiveMessage(message => { void this.handleMessage(message) }, undefined, this.context.subscriptions)
    view.onDidDispose(() => { if (this.view === view) this.view = undefined })
    if (this.controller.snapshot().phase === 'idle') {
      const autoStart = vscode.workspace.getConfiguration('dedgeDeepSeekHarness').get<boolean>('autoStart', true)
      if (autoStart) void this.run(() => this.controller.start())
    }
  }

  focus(): Thenable<unknown> {
    return vscode.commands.executeCommand(`${ChatViewProvider.viewType}.focus`)
  }

  async attachSelection(): Promise<void> {
    const attachment = await this.controller.attachSelection()
    if (attachment === undefined) {
      void vscode.window.showInformationMessage('Select text in an editor before attaching it.')
      return
    }
    this.upsertAttachment(attachment)
  }

  async attachUris(uris: readonly vscode.Uri[]): Promise<void> {
    for (const uri of uniqueUris(uris)) this.upsertAttachment(await this.controller.attachUri(uri))
    await this.focus()
  }

  async pickSession(): Promise<void> {
    const snapshot = this.controller.snapshot()
    const actionItems: SessionPickerItem[] = [
      {
        label: '$(add) New session',
        description: 'Start a fresh DeepSeek Harness session',
        action: 'new-session',
      },
      {
        label: '$(arrow-down) Load from local Codex',
        description: 'Current provider, active root sessions only',
        detail: 'Reads a bounded copy into a new DeepSeek Harness session; the Codex transcript stays untouched.',
        action: 'load-codex',
      },
      {
        label: '$(arrow-down) Load from local Claude Code',
        description: 'Active top-level sessions only',
        detail: 'Reads a bounded copy into a new DeepSeek Harness session; the Claude transcript stays untouched.',
        action: 'load-claude',
      },
      {
        label: '$(arrow-swap) Hand off current DeepSeek session',
        description: 'Continue in Codex or Claude Code',
        detail: 'Copies a take-over prompt to the clipboard for a new session in your extension, or launches the CLI; the source session stays untouched.',
        action: 'handoff-current',
      },
      {
        label: '$(list-selection) Browse Harness sessions',
        description: `${snapshot.sessions.length} local session${snapshot.sessions.length === 1 ? '' : 's'}`,
        detail: 'Open the searchable history list',
        action: 'browse-sessions',
      },
    ]
    const picked = await vscode.window.showQuickPick(actionItems, {
      title: 'DeepSeek Harness actions',
      placeHolder: 'Choose an action',
      matchOnDescription: true,
      matchOnDetail: true,
      canPickMany: false,
    })
    if (picked === undefined) return
    if (!('action' in picked)) return
    if (picked.action === 'browse-sessions') {
      const sessionItems: SessionPickerItem[] = snapshot.sessions.map(session => ({
        label: session.title,
        ...(session.cwd === undefined ? {} : { description: session.cwd }),
        detail: session.id,
        sessionId: session.id,
        picked: session.id === snapshot.activeSessionId,
      }))
      const selectedSession = await vscode.window.showQuickPick(sessionItems, {
        title: 'Select DeepSeek Harness session',
        placeHolder: 'Search local Harness sessions',
        matchOnDescription: true,
        matchOnDetail: true,
        canPickMany: false,
      })
      if (selectedSession !== undefined && 'sessionId' in selectedSession) await this.controller.selectSession(selectedSession.sessionId)
      await this.focus()
      return
    }
    let staged: StagedHandoff | undefined
    if (picked.action === 'new-session') await this.controller.newSession()
    else if (picked.action === 'load-codex') staged = await this.actions.loadCodexSession()
    else if (picked.action === 'load-claude') staged = await this.actions.loadClaudeSession()
    else if (picked.action === 'handoff-current') staged = await this.actions.handoffCurrentSession()
    await this.stageHandoff(staged)
    await this.focus()
  }

  async manageSession(sessionId?: string): Promise<void> {
    let snapshot = this.controller.snapshot()
    const targetId = sessionId ?? snapshot.activeSessionId
    let session = snapshot.sessions.find(item => item.id === targetId)
    if (session === undefined) {
      void vscode.window.showInformationMessage('No active DeepSeek Harness session is available to manage.')
      return
    }
    // Harness deletion/archive is tied to the active session after a runtime restart.
    // Select the target first so managing an unselected tab is reliable too.
    if (snapshot.activeSessionId !== session.id) {
      await this.controller.selectSession(session.id)
      snapshot = this.controller.snapshot()
      session = snapshot.sessions.find(item => item.id === targetId)
      if (session === undefined) return
    }
    if (session.operation !== undefined) {
      void vscode.window.showInformationMessage(`This session is already ${operationLabel(session.operation)}.`)
      return
    }
    if (session.running) {
      void vscode.window.showInformationMessage('Finish or cancel the response before archiving or deleting this session.')
      return
    }
    if (this.managingSessions.has(session.id)) return
    this.managingSessions.add(session.id)
    try {
      await this.manageSessionConfirmed(session)
    } finally {
      this.managingSessions.delete(session.id)
    }
  }

  async handoff(): Promise<void> {
    await this.stageHandoff(await this.actions.handoff())
  }

  private async manageSessionConfirmed(session: WorkbenchSession): Promise<void> {
    const action = await vscode.window.showQuickPick([
      {
        label: '$(archive) Archive session',
        description: 'Hide from tabs and session lists',
        detail: 'Uses the native Harness archive operation. The compressed session log is retained.',
        action: 'archive',
      },
      {
        label: '$(trash) Delete to recovery folder',
        description: 'Remove local session data and restart Harness',
        detail: 'Moves the complete session directory into this extension\'s managed recovery folder instead of erasing it.',
        action: 'delete',
      },
    ] as const, {
      title: `Manage session - ${session.title}`,
      placeHolder: 'Choose how to remove this session from the workbench',
      matchOnDescription: true,
      matchOnDetail: true,
    })
    if (action?.action === 'archive') {
      const confirmed = await vscode.window.showWarningMessage(
        `Archive "${session.title}"? It will disappear from tabs, but its Harness session log will be retained.`,
        { modal: true },
        'Archive',
      )
      if (confirmed !== 'Archive') return
      await this.controller.archiveSession(session.id)
      void vscode.window.showInformationMessage(`Archived DeepSeek Harness session "${session.title}".`)
      return
    }
    if (action?.action === 'delete') {
      const confirmed = await vscode.window.showWarningMessage(
        `Delete "${session.title}" from DeepSeek Harness? The local runtime will restart, and the complete session directory will be moved to the extension recovery folder.`,
        { modal: true },
        'Delete to Recovery Folder',
      )
      if (confirmed !== 'Delete to Recovery Folder') return
      const result = await this.controller.deleteSession(session.id)
      void vscode.window.setStatusBarMessage(`DeepSeek Harness: ${result}`, 4_000)
    }
  }

  private async stageHandoff(draft: StagedHandoff | undefined): Promise<void> {
    if (draft === undefined) return
    const sessionId = this.controller.snapshot().activeSessionId
    if (sessionId === undefined) throw new Error('The imported handoff did not create an active Harness session.')
    const pending: PendingHandoffState = { version: 1, sessionId, draft }
    this.pendingHandoff = pending
    await this.context.workspaceState.update(PENDING_HANDOFF_KEY, pending)
    const attachment = await this.controller.attachHandoff(draft.attachmentName, draft.attachmentText)
    this.attachments = [attachment]
    await this.focus()
    await this.postState()
    if (await this.post({ type: 'setDraft', text: draft.prompt })) this.restoredHandoffSessionId = sessionId
    const source = draft.sourcePlatform === 'codex' ? 'Codex' : 'Claude Code'
    void vscode.window.setStatusBarMessage(`DeepSeek Harness: ${source} handoff loaded as an unsent draft.`, 4_000)
  }

  dispose(): void {
    if (this.statePostTimer !== undefined) clearTimeout(this.statePostTimer)
    this.controllerSubscription.dispose()
  }

  private async handleMessage(value: unknown): Promise<void> {
    let message: WebviewToHostMessage
    try {
      message = parseWebviewMessage(value)
    } catch (error) {
      this.logger.warn(`Rejected webview message: ${errorMessage(error)}`)
      return
    }
    if (message.type === 'ready') {
      await this.restorePendingHandoff()
      await this.postState()
      await this.post({ type: 'settings', settings: await this.actions.getSettings(), open: false })
      return
    }
    if (message.type === 'send') {
      const attachments = [...this.attachments]
      const settings = await this.actions.getSettings()
      if (attachments.some(item => item.kind === 'image') && settings.mainModelVisionCapable && settings.auxiliaryVisionEnabled) {
        const confirmed = await vscode.window.showWarningMessage(
          'The selected main model already accepts images. Auxiliary vision will make an extra model request first, adding latency and token cost.',
          { modal: true },
          'Use Auxiliary Vision',
        )
        if (confirmed !== 'Use Auxiliary Vision') {
          await this.post({ type: 'sendSettled', accepted: false, text: message.text })
          return
        }
      }
      const sentIds = new Set(attachments.map(item => item.id))
      this.attachments = this.attachments.filter(item => !sentIds.has(item.id))
      // Release the composer immediately, matching Codex's image-send UX. Vision conversion and
      // the Harness RPC continue in this handler; failures are reported through sendSettled.
      await this.post({ type: 'sendStarted', text: message.text, attachments: attachments.map(item => ({ label: item.label })) })
      await this.postState()
      try {
        await this.controller.send(message.text, attachments, message.mode ?? 'queue', progress => { void this.post({ type: 'sendProgress', progress }) })
        if (this.pendingHandoff?.sessionId === this.controller.snapshot().activeSessionId) await this.clearPendingHandoff()
        await this.post({ type: 'sendSettled', accepted: true, text: message.text })
        await this.postState()
      } catch (error) {
        const detail = errorMessage(error)
        this.attachments = [...attachments, ...this.attachments.filter(item => !sentIds.has(item.id))]
        this.logger.error('Workbench send failed', error)
        await this.post({ type: 'notice', level: 'error', message: conciseNotice(detail) })
        await this.post({ type: 'sendSettled', accepted: false, text: message.text })
        await this.postState()
      }
      return
    }
    if (message.type === 'newSession') return this.run(() => this.controller.newSession())
    if (message.type === 'selectSession') return this.run(() => this.controller.selectSession(message.sessionId))
    if (message.type === 'loadOlderHistory') return this.run(() => this.controller.loadOlderHistory())
    if (message.type === 'loadAllHistory') return this.run(() => this.controller.loadOlderHistory(true))
    if (message.type === 'hideOlderHistory') return this.run(async () => this.controller.hideOlderHistory())
    if (message.type === 'hideAllOlderHistory') return this.run(async () => this.controller.hideOlderHistory(true))
    if (message.type === 'manageSession') return this.run(() => this.manageSession(message.sessionId))
    if (message.type === 'cancel') return this.run(() => this.controller.cancel())
    if (message.type === 'compact') return this.run(async () => {
      await this.post({ type: 'notice', level: 'info', message: conciseNotice(await this.controller.compact()) })
    })
    if (message.type === 'configureContextWindow') return this.run(this.actions.configureContextWindow)
    if (message.type === 'handoff') return this.run(() => this.handoff())
    if (message.type === 'start') return this.run(() => this.controller.start())
    if (message.type === 'restart') return this.run(() => this.controller.restart())
    if (message.type === 'stop') return this.run(() => this.controller.stop())
    if (message.type === 'setApiKey') return this.run(this.actions.setApiKey)
    if (message.type === 'openSettings') return this.showSettings()
    if (message.type === 'openVisionSettings') return this.showSettings('vision')
    if (message.type === 'saveSettings') return this.run(async () => {
      await this.actions.saveSettings(message.settings)
      const settings = await this.actions.getSettings()
      await this.post({ type: 'settings', settings, open: false })
      if (this.pendingImageFiles.length > 0 && settingsCanHandleImages(settings)) {
        const pending = this.pendingImageFiles
        this.pendingImageFiles = []
        for (const file of pending) this.upsertAttachment(await this.controller.attachImageData(file.name, file.dataUrl))
      }
    })
    if (message.type === 'attachFile') return this.run(async () => {
      const item = await this.controller.attachFile()
      if (item !== undefined) this.upsertAttachment(item)
    })
    if (message.type === 'attachExternalFile') return this.run(async () => {
      const item = await this.controller.attachExternalFile()
      if (item !== undefined) this.upsertAttachment(item)
    })
    if (message.type === 'attachUris') return this.run(async () => {
      for (const value of message.uris) this.upsertAttachment(await this.controller.attachUri(vscode.Uri.parse(value, true)))
    })
    if (message.type === 'attachTextFiles') return this.run(async () => {
      for (const file of message.files) this.upsertAttachment(await this.controller.attachTextFile(file.name, file.text))
    })
    if (message.type === 'attachImageFiles') return this.run(async () => {
      const settings = await this.actions.getSettings()
      if (!settingsCanHandleImages(settings)) {
        this.pendingImageFiles = message.files
        if (!settings.auxiliaryVisionEnabled && auxiliaryVisionIsConfigured(settings)) {
          await this.post({ type: 'notice', level: 'warning', message: 'The selected main model is text-only. Turn on the auxiliary vision button to attach the pasted image.' })
          await this.post({ type: 'visionAttention' })
          return
        }
        await this.post({ type: 'settings', settings, section: 'vision' })
        return
      }
      for (const file of message.files) this.upsertAttachment(await this.controller.attachImageData(file.name, file.dataUrl))
    })
    if (message.type === 'listSkills') return this.run(async () => {
      await this.post({ type: 'skills', skills: await this.controller.listSkillCatalog() })
    })
    if (message.type === 'removeAttachment') {
      const removed = this.attachments.find(item => item.id === message.id)
      const removedPendingHandoff = this.pendingHandoff !== undefined && this.attachments.some(item => item.id === message.id && item.label === this.pendingHandoff?.draft.attachmentName)
      this.attachments = this.attachments.filter(item => item.id !== message.id)
      if (removed?.pastedPath !== undefined) void this.controller.deletePastedFile(removed.pastedPath)
      if (removedPendingHandoff) await this.clearPendingHandoff()
      await this.postState()
      return
    }
    if (message.type === 'openAttachment') {
      if (message.uri !== undefined) return this.run(async () => {
        const document = await vscode.workspace.openTextDocument(vscode.Uri.parse(message.uri!, true))
        await vscode.window.showTextDocument(document, { preview: false })
      })
      const attachment = this.attachments.find(item => item.id === message.id)
      if (attachment?.pastedPath !== undefined) return this.run(() => this.controller.openPastedFile(attachment.pastedPath!))
      if (attachment?.uri !== undefined) return this.run(async () => {
        const document = await vscode.workspace.openTextDocument(vscode.Uri.parse(attachment.uri!, true))
        await vscode.window.showTextDocument(document, { preview: false })
      })
      return
    }
    if (message.type === 'approve') return this.run(() => this.controller.approve(message.approvalId, message.outcome))
    if (message.type === 'answerQuestions') return this.run(() => this.controller.answerQuestions(message.rpcId, message.answers))
    if (message.type === 'selectModel') return this.run(async () => {
      await this.controller.selectModel(message.provider, message.model, message.reasoningEffort)
      await this.post({ type: 'settings', settings: await this.actions.getSettings(), open: false })
    })
    if (message.type === 'setVisionEnabled') return this.run(async () => {
      await this.controller.setVisionEnabled(message.enabled)
      const settings = await this.actions.getSettings()
      await this.post({ type: 'settings', settings, open: false })
      if (message.enabled && settingsCanHandleImages(settings) && this.pendingImageFiles.length > 0) {
        const pending = this.pendingImageFiles
        this.pendingImageFiles = []
        for (const file of pending) this.upsertAttachment(await this.controller.attachImageData(file.name, file.dataUrl))
      }
    })
    if (message.type === 'selectCompactionModel') return this.run(async () => {
      await this.controller.selectCompactionModel(message.provider, message.model)
      await this.post({ type: 'settings', settings: await this.actions.getSettings(), open: false })
    })
    if (message.type === 'selectPreset') return this.run(async () => {
      const snapshot = this.controller.snapshot()
      const active = snapshot.sessions.find(item => item.id === snapshot.activeSessionId)
      if (active?.blank !== false) return this.controller.selectPreset(message.preset)
      if (message.preset === snapshot.agentPreset) return
      const selected = await vscode.window.showWarningMessage(
        'DeepSeek Harness fixes the Agent Preset after the first prompt because it defines tools, system instructions, and compaction behavior. Continue in a new isolated session with a bounded user/assistant transcript?',
        { modal: true },
        'Continue in New Session',
      )
      if (selected !== 'Continue in New Session') return
      this.upsertAttachment(await this.controller.continueWithPreset(message.preset))
    })
    if (message.type === 'selectPermission') return this.run(async () => {
      if (message.permission === 'approve-for-me') {
        await this.controller.setApprovalPolicy('approve-for-me')
        await this.controller.selectPermission('workspace-write')
        return
      }
      if (message.permission === 'danger-full-access') {
        const confirmed = await vscode.window.showWarningMessage(
          'Enable Full access for this session? Commands will run without the workspace file sandbox or approval prompts, including external executables such as Git.',
          { modal: true },
          'Enable Full Access',
        )
        if (confirmed !== 'Enable Full Access') return
      }
      await this.controller.selectPermission(message.permission)
    })
    if (message.type === 'showLogs') return this.logger.show()
    if (message.type === 'reviewChanges') return this.run(() => this.review.open())
    if (message.type === 'diagnose') return this.run(this.actions.diagnose)
  }

  private upsertAttachment(attachment: ContextAttachment): void {
    this.attachments = [...this.attachments.filter(item => item.id !== attachment.id), attachment]
    void this.postState()
  }

  private async restorePendingHandoff(): Promise<void> {
    const pending = this.pendingHandoff
    const activeSessionId = this.controller.snapshot().activeSessionId
    if (pending === undefined || activeSessionId !== pending.sessionId) return
    const attachment = await this.controller.attachHandoff(pending.draft.attachmentName, pending.draft.attachmentText)
    this.attachments = [attachment]
    if (this.restoredHandoffSessionId === pending.sessionId) return
    if (await this.post({ type: 'setDraft', text: pending.draft.prompt })) this.restoredHandoffSessionId = pending.sessionId
  }

  private async clearPendingHandoff(): Promise<void> {
    this.pendingHandoff = undefined
    this.restoredHandoffSessionId = undefined
    await this.context.workspaceState.update(PENDING_HANDOFF_KEY, undefined)
  }

  private async run(action: () => Promise<unknown>): Promise<void> {
    try {
      await action()
      await this.postState()
    } catch (error) {
      const message = errorMessage(error)
      this.logger.error('Workbench action failed', error)
      await this.post({ type: 'notice', level: 'error', message: conciseNotice(message) })
    }
  }

  private async showSettings(section?: 'connection' | 'vision' | 'context' | 'handoff' | 'skills'): Promise<void> {
    await this.post({ type: 'settings', settings: await this.actions.getSettings(), ...(section === undefined ? {} : { section }) })
  }

  private scheduleStatePost(): void {
    if (this.statePostScheduled) return
    this.statePostScheduled = true
    this.statePostTimer = setTimeout(() => {
      this.statePostScheduled = false
      this.statePostTimer = undefined
      void this.restorePendingHandoff().then(() => this.postState())
    }, 120)
  }

  private postState(): Promise<boolean> {
    if (this.statePostScheduled) {
      this.statePostScheduled = false
      if (this.statePostTimer !== undefined) clearTimeout(this.statePostTimer)
      this.statePostTimer = undefined
    }
    return this.post({ type: 'state', state: this.controller.snapshot(), attachments: this.attachments })
  }

  private post(message: HostToWebviewMessage): Promise<boolean> {
    return Promise.resolve(this.view?.webview.postMessage(message) ?? false)
  }
}

function parseWebviewMessage(value: unknown): WebviewToHostMessage {
  if (!isRecord(value) || typeof value.type !== 'string') throw new Error('Message requires a type.')
  const type = value.type
  if (type === 'ready' || type === 'newSession' || type === 'loadOlderHistory' || type === 'loadAllHistory' || type === 'hideOlderHistory' || type === 'hideAllOlderHistory' || type === 'openVisionSettings' || type === 'cancel' || type === 'start' || type === 'restart' || type === 'stop'
    || type === 'setApiKey' || type === 'openSettings' || type === 'attachFile' || type === 'attachExternalFile'
    || type === 'compact' || type === 'configureContextWindow' || type === 'handoff' || type === 'showLogs' || type === 'reviewChanges' || type === 'diagnose') return { type }
  if (type === 'saveSettings' && isRecord(value.settings)) return { type, settings: parseSettings(value.settings) }
  if (type === 'send' && typeof value.text === 'string') return { type, text: value.text, ...(value.mode === 'queue' || value.mode === 'steer' ? { mode: value.mode } : {}) }
  if (type === 'selectSession' && typeof value.sessionId === 'string' && value.sessionId.length <= 256) return { type, sessionId: value.sessionId }
  if (type === 'manageSession' && typeof value.sessionId === 'string' && value.sessionId.length <= 256) return { type, sessionId: value.sessionId }
  if (type === 'attachUris' && Array.isArray(value.uris) && value.uris.length <= 20 && value.uris.every(item => typeof item === 'string' && item.length <= 8_192)) {
    return { type, uris: value.uris }
  }
  if (type === 'attachTextFiles' && Array.isArray(value.files) && value.files.length <= 10) {
    const files = value.files.map(parseTextFile)
    if (files.reduce((total, file) => total + file.text.length, 0) > 1_048_576) throw new Error('Dropped file payload is too large.')
    return { type, files }
  }
  if (type === 'attachImageFiles' && Array.isArray(value.files) && value.files.length <= 10) {
    const files = value.files.map(parseImageFile)
    if (files.reduce((total, file) => total + file.dataUrl.length, 0) > 64 * 1_048_576) throw new Error('Dropped image payload is too large.')
    return { type, files }
  }
  if (type === 'listSkills') return { type }
  if (type === 'removeAttachment' && typeof value.id === 'string') return { type, id: value.id }
  if (type === 'openAttachment' && (typeof value.id === 'string' || typeof value.uri === 'string')) return { type, ...(typeof value.id === 'string' ? { id: value.id } : {}), ...(typeof value.uri === 'string' ? { uri: value.uri } : {}) }
  if (type === 'approve' && typeof value.approvalId === 'string' && (value.outcome === 'allowed-once' || value.outcome === 'rejected')) return { type, approvalId: value.approvalId, outcome: value.outcome }
  if (type === 'answerQuestions' && typeof value.rpcId === 'string' && Array.isArray(value.answers)) {
    const answers = value.answers.map(parseQuestionAnswer)
    return { type, rpcId: value.rpcId, answers }
  }
  if (type === 'selectModel' && typeof value.provider === 'string' && typeof value.model === 'string') return { type, provider: value.provider, model: value.model, ...(typeof value.reasoningEffort === 'string' ? { reasoningEffort: value.reasoningEffort } : {}) }
  if (type === 'setVisionEnabled' && typeof value.enabled === 'boolean') return { type, enabled: value.enabled }
  if (type === 'selectCompactionModel' && typeof value.provider === 'string' && typeof value.model === 'string') return { type, provider: value.provider, model: value.model }
  if (type === 'selectPreset' && typeof value.preset === 'string') return { type, preset: value.preset }
  if (type === 'selectPermission' && typeof value.permission === 'string') return { type, permission: value.permission }
  throw new Error(`Unsupported webview message: ${type}`)
}

function parseSettings(value: Record<string, unknown>): WebviewToHostMessage extends { readonly type: 'saveSettings'; readonly settings: infer T } ? T : never {
  const text = (key: string, fallback = ''): string => typeof value[key] === 'string' ? value[key] as string : fallback
  const number = (key: string, fallback: number): number => typeof value[key] === 'number' && Number.isFinite(value[key]) ? value[key] as number : fallback
  const directories = Array.isArray(value.skillDirectories) ? value.skillDirectories.filter(item => typeof item === 'string') as string[] : []
  return {
    baseUrl: text('baseUrl'), hasApiKey: value.hasApiKey === true, visionBaseUrl: text('visionBaseUrl'), visionModel: text('visionModel'), visionReasoningEffort: text('visionReasoningEffort'), mainModelVisionCapable: value.mainModelVisionCapable === true, auxiliaryVisionEnabled: value.auxiliaryVisionEnabled === true, compactionProvider: text('compactionProvider'), compactionModel: text('compactionModel'), visionModels: Array.isArray(value.visionModels) ? value.visionModels.filter(item => typeof item === 'string') as string[] : [],
    hasVisionApiKey: value.hasVisionApiKey === true, pasteFileThreshold: number('pasteFileThreshold', 4_096), contextWindowTokens: number('contextWindowTokens', 1_000_000),
    codexHome: text('codexHome'), claudeHome: text('claudeHome'), handoffLaunchMode: text('handoffLaunchMode') === 'cli' ? 'cli' : 'clipboard', skillDirectories: directories,
    ...(text('apiKey') === '' ? {} : { apiKey: text('apiKey') }), ...(text('visionApiKey') === '' ? {} : { visionApiKey: text('visionApiKey') }),
  } as never
}

function settingsCanHandleImages(settings: WorkbenchSettings): boolean {
  if (!settings.auxiliaryVisionEnabled) return settings.mainModelVisionCapable && settings.hasApiKey
  return settings.visionBaseUrl !== '' && settings.visionModel !== '' && settings.hasVisionApiKey
}

function auxiliaryVisionIsConfigured(settings: WorkbenchSettings): boolean {
  return settings.visionBaseUrl !== '' && settings.visionModel !== '' && settings.hasVisionApiKey
}

function parseTextFile(value: unknown): { readonly name: string; readonly text: string } {
  if (!isRecord(value) || typeof value.name !== 'string' || value.name.length > 512 || typeof value.text !== 'string' || value.text.length > 262_144) {
    throw new Error('Malformed dropped file.')
  }
  return { name: value.name, text: value.text }
}

function parseImageFile(value: unknown): { readonly name: string; readonly dataUrl: string } {
  if (!isRecord(value) || typeof value.name !== 'string' || value.name.length > 512 || typeof value.dataUrl !== 'string' || value.dataUrl.length > 8_388_608) {
    throw new Error('Malformed dropped image.')
  }
  return { name: value.name, dataUrl: value.dataUrl }
}

function parseQuestionAnswer(value: unknown): { readonly id: string; readonly selected: readonly string[]; readonly custom?: string } {
  if (!isRecord(value) || typeof value.id !== 'string' || !Array.isArray(value.selected) || !value.selected.every(item => typeof item === 'string')) {
    throw new Error('Malformed question answer.')
  }
  return {
    id: value.id,
    selected: value.selected,
    ...(typeof value.custom === 'string' ? { custom: value.custom } : {}),
  }
}

function renderHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const nonce = randomBytes(18).toString('base64')
  const script = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'dist', 'webview.js'))
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; font-src ${webview.cspSource};">
  <title>DeepSeek Harness</title>
  <style>
    :root { color-scheme: light dark; }
    * { box-sizing: border-box; }
    html, body { width: 100%; height: 100%; overflow: hidden; }
    body { margin: 0; color: var(--vscode-foreground); background: var(--vscode-sideBar-background); font: var(--vscode-font-size)/1.45 var(--vscode-font-family); }
    button, textarea, input { font: inherit; color: inherit; letter-spacing: 0; }
    button { border: 0; }
    .app { display: grid; grid-template-rows: auto minmax(0,1fr) auto; width: 100%; height: 100vh; min-width: 0; overflow: hidden; }
    .actions, .attachments, .control-group { display: flex; align-items: center; gap: 4px; min-width: 0; }
    .icon-button { display: inline-grid; place-items: center; flex: 0 0 24px; width: 24px; height: 24px; padding: 0; color: var(--vscode-icon-foreground); background: transparent; border-radius: 3px; cursor: pointer; }
    .icon-button svg, .menu-button svg, .menu-option svg { width: 14px; height: 14px; stroke-width: 1.9; }
    .icon-button:hover { background: var(--vscode-toolbar-hoverBackground); }
    .icon-button:focus-visible, .menu-button:focus-visible, .menu-option:focus-visible, .context-meter:focus-visible, .session-tab:focus-visible, .session-tab-manage:focus-visible, .command:focus-visible, textarea:focus-visible, input:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 1px; }
    .icon-button[disabled] { opacity: .45; cursor: default; }
    .session-toolbar { position: relative; z-index: 25; display: flex; align-items: stretch; width: 100%; max-width: 100%; overflow: hidden; border-bottom: 1px solid var(--vscode-panel-border); }
    .session-toolbar .session-tabs { flex: 1 1 auto; min-width: 0; border-bottom: 0; }
    .search-panel { position: absolute; top: 31px; left: 6px; right: 6px; z-index: 40; padding: 6px 8px 7px; border: 1px solid var(--vscode-widget-border,var(--vscode-panel-border)); border-radius: 3px; background: var(--vscode-editorWidget-background,var(--vscode-sideBar-background)); box-shadow: 0 5px 18px rgba(0,0,0,.45); }
    .search-row { display: flex; align-items: center; gap: 2px; }
    .search-row input { flex: 1 1 auto; min-width: 0; height: 26px; padding: 3px 7px; border: 1px solid var(--vscode-input-border,var(--vscode-panel-border)); border-radius: 3px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); outline: none; }
    .search-row .icon-button { position: relative; z-index: 2; flex: 0 0 24px; width: 24px; height: 24px; pointer-events: auto; }
    .search-row .search-selection { color: var(--vscode-textLink-foreground); }
    .search-row input:focus { border-color: var(--vscode-focusBorder); }
    .search-options { display: flex; align-items: center; gap: 4px; padding-top: 5px; color: var(--vscode-descriptionForeground); font-size: 10px; }
    .search-options label { display: inline-flex; align-items: center; gap: 3px; min-height: 20px; padding: 1px 5px; border: 1px solid transparent; border-radius: 3px; cursor: pointer; user-select: none; }
    .search-options label:hover { background: var(--vscode-toolbar-hoverBackground); }
    .search-options label:has(input:checked) { border-color: var(--vscode-focusBorder); color: var(--vscode-foreground); background: var(--vscode-editor-findMatchHighlightBackground); }
    .search-options input { position: absolute; opacity: 0; width: 1px; height: 1px; pointer-events: none; }
    .search-options span { margin-left: auto; color: var(--vscode-descriptionForeground); }
    .search-row .search-selection.active { color: var(--vscode-charts-yellow); background: var(--vscode-toolbar-activeBackground); }
    ::highlight(dedge-search-current) { background: #ffb000; color: #111; text-decoration: underline 2px solid #d65a00; }
    .session-tabs { display: flex; align-items: stretch; min-height: 30px; overflow: hidden; border-bottom: 0; scrollbar-width: none; }
    .session-tabs::-webkit-scrollbar { display: none; }
    .session-tab-wrap { display: inline-flex; align-items: stretch; flex: 0 0 150px; min-width: 120px; max-width: 150px; height: 30px; }
    .session-tab { position: relative; display: inline-flex; align-items: center; flex: 1 1 auto; min-width: 0; height: 30px; padding: 0 4px 0 9px; border-bottom: 2px solid transparent; background: transparent; color: var(--vscode-descriptionForeground); cursor: pointer; font-size: 11px; white-space: nowrap; }
    .session-tab:hover { background: var(--vscode-list-hoverBackground); color: var(--vscode-foreground); }
    .session-tab[disabled] { cursor: default; opacity: .72; }
    .session-tab.operation { color: var(--vscode-progressBar-background); }
    .session-tab[aria-selected="true"] { border-bottom-color: var(--vscode-focusBorder); color: var(--vscode-foreground); }
    .session-tab.running::after { content: ''; flex: 0 0 5px; width: 5px; height: 5px; margin-left: 6px; border-radius: 50%; background: var(--vscode-progressBar-background); }
    .session-tab-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
    .session-tab-manage { display: grid; place-items: center; flex: 0 0 22px; width: 22px; height: 30px; padding: 0; background: transparent; color: var(--vscode-descriptionForeground); cursor: pointer; opacity: 0; }
    .session-tab-wrap:hover .session-tab-manage, .session-tab-manage:focus-visible, .session-tab[aria-selected="true"] + .session-tab-manage { opacity: .78; }
    .session-tab-manage:hover { color: var(--vscode-foreground); background: var(--vscode-toolbar-hoverBackground); opacity: 1; }
    .session-tab-manage[disabled] { cursor: default; opacity: .25; }
    .session-tab-manage svg { width: 13px; height: 13px; }
    .session-operation-icon { animation: session-operation-spin 900ms linear infinite; }
    @keyframes session-operation-spin { to { transform: rotate(360deg); } }
    .conversation { overflow-x: hidden; overflow-y: auto; min-width: 0; min-height: 0; padding: 2px 10px 18px; scrollbar-width: thin; scrollbar-color: color-mix(in srgb, var(--vscode-scrollbarSlider-background) 55%, transparent) transparent; }
    .conversation::-webkit-scrollbar { width: 7px; height: 0; }
    .conversation::-webkit-scrollbar-track { background: transparent; }
    .conversation::-webkit-scrollbar-thumb { min-height: 28px; border: 2px solid transparent; border-radius: 5px; background: color-mix(in srgb, var(--vscode-scrollbarSlider-background) 55%, transparent); background-clip: padding-box; }
    .conversation::-webkit-scrollbar-thumb:hover { background: var(--vscode-scrollbarSlider-hoverBackground); background-clip: padding-box; }
    .history-controls { display: flex; align-items: center; justify-content: center; gap: 7px; min-height: 28px; margin: 4px auto; }
    .history-control-group { display: inline-flex; overflow: hidden; border: 1px solid var(--vscode-panel-border); border-radius: 3px; }
    .history-control { min-width: 31px; height: 23px; padding: 0 6px; color: var(--vscode-descriptionForeground); background: transparent; cursor: pointer; font-size: 10px; }
    .history-control + .history-control { min-width: 25px; padding: 0 5px; border-left: 1px solid var(--vscode-panel-border); }
    .history-control:hover:not([disabled]) { color: var(--vscode-foreground); background: var(--vscode-toolbar-hoverBackground); }
    .history-control[disabled] { cursor: default; opacity: .35; }
    .history-controls.loading { opacity: .65; }
    .empty { display: grid; place-items: center; height: 100%; min-height: 0; color: var(--vscode-descriptionForeground); text-align: center; padding: 24px; font-size: 12px; }
    .message { padding: 12px 2px; border-bottom: 1px solid color-mix(in srgb, var(--vscode-panel-border) 70%, transparent); overflow-wrap: anywhere; }
    .message-head { display: flex; align-items: center; gap: 4px; min-height: 18px; margin-bottom: 3px; opacity: 1; }
    .message-role-label { color: var(--vscode-descriptionForeground); font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: .03em; }
    .collapse-toggle { display: grid; place-items: center; width: 18px; height: 18px; padding: 0; background: transparent; color: var(--vscode-descriptionForeground); border-radius: 3px; cursor: pointer; }
    .collapse-toggle:hover { background: var(--vscode-toolbar-hoverBackground); color: var(--vscode-foreground); }
    .collapse-toggle svg { width: 13px; height: 13px; transition: transform 120ms ease; }
    .collapse-toggle.collapsed svg { transform: rotate(-90deg); }
    .message-preview { color: var(--vscode-descriptionForeground); font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100%; }
    .message.user { box-sizing: border-box; width: 88%; max-width: 88%; margin: 6px 0 6px auto; padding: 9px 10px; border: 1px solid color-mix(in srgb, var(--vscode-charts-blue) 45%, var(--vscode-panel-border)); border-radius: 5px; background: color-mix(in srgb, var(--vscode-charts-blue) 8%, var(--vscode-sideBar-background)); }
    .message.user .message-head { justify-content: flex-end; }
    .message.user .message-role-label { color: var(--vscode-charts-blue); }
    .message.user.task-intermediate { width: 76%; max-width: 76%; margin-top: 5px; margin-bottom: 5px; padding: 6px 8px; border-color: color-mix(in srgb, var(--vscode-charts-blue) 28%, var(--vscode-panel-border)); background: color-mix(in srgb, var(--vscode-charts-blue) 4%, var(--vscode-sideBar-background)); font-size: 11px; }
    .message.user.task-intermediate .message-role-label { font-size: 9px; opacity: .82; }
    .message-actions { display: inline-flex; align-items: center; gap: 2px; margin-left: 4px; }
    .message-action { display: inline-flex; align-items: center; gap: 3px; min-height: 20px; padding: 1px 4px; border: 0; border-radius: 3px; background: transparent; color: var(--vscode-descriptionForeground); font: 10px/1 var(--vscode-font-family); cursor: pointer; }
    .message-action:hover { color: var(--vscode-foreground); background: var(--vscode-toolbar-hoverBackground); }
    .message-action svg { width: 12px; height: 12px; }
    .message.assistant, .message.reasoning, .message.tool, .message.system { margin-right: 8%; }
    .message.assistant { padding-left: 10px; border-left-color: var(--vscode-charts-green); background: color-mix(in srgb, var(--vscode-charts-green) 3%, transparent); }
    .message-attachments { display: flex; flex-wrap: wrap; gap: 4px; margin: 0 0 7px; min-width: 0; }
    .message-attachment { display: inline-flex; align-items: center; gap: 5px; max-width: 100%; min-height: 24px; padding: 2px 6px; border: 1px solid var(--vscode-panel-border); border-radius: 3px; color: var(--vscode-descriptionForeground); background: var(--vscode-editor-inactiveSelectionBackground); font-size: 11px; }
    .message-attachment svg { flex: 0 0 12px; width: 12px; height: 12px; }
    .message-attachment-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .message.assistant { border-left: 2px solid transparent; }
    .message.system { color: var(--vscode-errorForeground); }
    .message pre { overflow: auto; padding: 9px; background: var(--vscode-textCodeBlock-background); border-radius: 4px; }
    .message code { font-family: var(--vscode-editor-font-family); }
    .message p:first-child { margin-top: 0; }
    .message p:last-child { margin-bottom: 0; }
    .streaming-text { white-space: pre-wrap; overflow-wrap: anywhere; }
    .streaming-text::after { content: '\u258d'; color: var(--vscode-progressBar-background); margin-left: 1px; animation: streaming-caret 1.1s ease-in-out infinite alternate; }
    @keyframes streaming-caret { from { opacity: 1; } to { opacity: .15; } }
    details.message .message-body { margin-top: 4px; }
    details.message summary { cursor: pointer; color: var(--vscode-descriptionForeground); display: flex; align-items: center; gap: 4px; width: 100%; min-height: 26px; padding: 4px 8px; box-sizing: border-box; list-style: none; }
    details.message summary::-webkit-details-marker { display: none; }
    details.message .summary-chevron { width: 12px; height: 12px; flex: 0 0 12px; transition: transform 120ms ease; }
    details.message:not([open]) .summary-chevron { transform: rotate(-90deg); }
    details.message .summary-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    details.reasoning { border-left: 2px solid var(--vscode-charts-yellow); padding-left: 8px; }
    details.tool { border-left: 2px solid var(--vscode-charts-green); padding-left: 8px; }
    .vision-process { width: 100%; margin: 4px 0; padding: 4px 7px; border-left: 2px solid var(--vscode-charts-purple, #b180d7); background: color-mix(in srgb, var(--vscode-charts-purple, #b180d7) 7%, transparent); }
    .vision-process summary { display: flex; align-items: center; gap: 5px; width: 100%; min-height: 24px; padding: 3px 5px; box-sizing: border-box; cursor: pointer; color: var(--vscode-descriptionForeground); font-size: 11px; }
    .vision-process summary svg { width: 12px; height: 12px; }
    .vision-process > div { margin-top: 5px; white-space: pre-wrap; overflow-wrap: anywhere; font-size: 11px; }
    .message-send-status { margin-left: auto; color: var(--vscode-descriptionForeground); font-size: 10px; }
    .attachment-openable { cursor: pointer; }
    .attachment-openable:hover { border-color: var(--vscode-focusBorder); color: var(--vscode-foreground); }
    .pending { margin: 8px 0; padding: 10px; border: 1px solid var(--vscode-inputValidation-warningBorder); border-radius: 4px; background: var(--vscode-inputValidation-warningBackground); }
    .pending-title { font-weight: 600; margin-bottom: 5px; }
    .question-item { min-width: 0; margin: 0; padding: 10px 0; border: 0; }
    .question-item + .question-item { border-top: 1px solid var(--vscode-panel-border); }
    .question-item legend { width: 100%; padding: 0; font-weight: 600; }
    .question-prompt { margin-top: 3px; }
    .question-detail, .question-option-description { color: var(--vscode-descriptionForeground); font-size: 11px; }
    .question-options { display: grid; gap: 5px; margin: 8px 0; }
    .question-option { display: grid; grid-template-columns: auto minmax(0,1fr); align-items: start; gap: 7px; cursor: pointer; }
    .question-option input { margin: 3px 0 0; }
    .question-option > span { display: grid; min-width: 0; }
    .question-option-label, .question-option-description { overflow-wrap: anywhere; }
    .question-custom { width: 100%; min-height: 28px; border: 1px solid var(--vscode-input-border); border-radius: 3px; background: var(--vscode-input-background); padding: 4px 7px; }
    .question-actions { justify-content: flex-end; }
    .command { min-height: 28px; padding: 4px 9px; border-radius: 3px; cursor: pointer; background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
    .command:hover { background: var(--vscode-button-secondaryHoverBackground); }
    .command.primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
    .command.primary:hover { background: var(--vscode-button-hoverBackground); }
    .composer { min-width: 0; max-width: 100%; border-top: 1px solid var(--vscode-panel-border); padding: 8px 10px 9px; background: var(--vscode-sideBar-background); }
    .attachments { max-width: 100%; overflow-x: hidden; padding-bottom: 6px; }
    .chip { display: inline-flex; align-items: center; gap: 4px; flex: 0 0 auto; max-width: 220px; padding: 3px 6px; border: 1px solid var(--vscode-badge-background); border-radius: 3px; background: var(--vscode-editor-inactiveSelectionBackground); color: var(--vscode-foreground); }
    .chip span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .attachment-thumb { flex: 0 0 26px; width: 26px; height: 26px; border-radius: 3px; object-fit: cover; border: 1px solid var(--vscode-panel-border); }
    .file-thumb { display: grid; place-items: center; background: var(--vscode-editor-inactiveSelectionBackground); color: var(--vscode-descriptionForeground); }
    .file-thumb svg { width: 14px; height: 14px; }
    .empty { display: grid; place-items: center; gap: 10px; height: 100%; min-height: 0; color: var(--vscode-descriptionForeground); text-align: center; padding: 24px; font-size: 12px; }
    .empty-title { font-size: 12px; }
    .chip button { display: grid; place-items: center; background: transparent; cursor: pointer; padding: 0; }
    .composer-box { position: relative; display: grid; grid-template-rows: 9px minmax(88px,auto) auto; gap: 5px; min-width: 0; max-width: 100%; border: 1px solid var(--vscode-input-border); border-radius: 5px; background: var(--vscode-input-background); padding: 7px; transition: border-color 80ms ease, background 80ms ease; }
    .icon-button.active { color: var(--vscode-button-foreground); background: var(--vscode-button-background); }
    .icon-button.active:hover { background: var(--vscode-button-hoverBackground); }
    .icon-button.steer { border: 1px dashed var(--vscode-charts-orange); color: var(--vscode-charts-orange); }
    .icon-button.steer:hover { background: var(--vscode-toolbar-hoverBackground); color: var(--vscode-charts-orange); }
    .skill-popover { position: absolute; left: 6px; right: 6px; bottom: calc(100% - 4px); z-index: 35; max-height: 220px; overflow: auto; padding: 4px; border: 1px solid var(--vscode-menu-border,var(--vscode-panel-border)); border-radius: 5px; background: var(--vscode-menu-background,var(--vscode-dropdown-background)); color: var(--vscode-menu-foreground,var(--vscode-dropdown-foreground)); box-shadow: 0 -4px 18px rgba(0,0,0,.28); }
    .skill-option { display: grid; gap: 1px; width: 100%; padding: 5px 8px; border-radius: 3px; text-align: left; color: inherit; background: transparent; cursor: pointer; }
    .skill-option:hover, .skill-option.highlighted { color: var(--vscode-menu-selectionForeground,var(--vscode-list-activeSelectionForeground)); background: var(--vscode-menu-selectionBackground,var(--vscode-list-activeSelectionBackground)); }
    .skill-option-name { font-size: 12px; font-weight: 600; }
    .skill-option-desc { font-size: 10px; color: var(--vscode-descriptionForeground); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .skill-option:hover .skill-option-desc { color: inherit; opacity: .8; }
    .skill-empty { padding: 6px 8px; font-size: 11px; color: var(--vscode-descriptionForeground); }
    .steer-notice { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; padding: 6px 8px; border: 1px solid var(--vscode-inputValidation-warningBorder); border-radius: 3px; background: var(--vscode-inputValidation-warningBackground); color: var(--vscode-inputValidation-warningForeground); font-size: 11px; line-height: 1.35; }
    .steer-notice > span { flex: 1 1 auto; min-width: 0; }
    .steer-notice button { display: grid; place-items: center; flex: 0 0 16px; width: 16px; height: 16px; padding: 0; background: transparent; color: inherit; cursor: pointer; border-radius: 3px; }
    .steer-notice button:hover { background: var(--vscode-toolbar-hoverBackground); }
    .steer-notice svg { width: 12px; height: 12px; }
    .task-middle-hidden { display: none !important; }
    .task-all-hidden { display: none !important; }
    .task-collapse-all { display: flex; align-items: center; gap: 6px; width: 100%; min-height: 26px; padding: 4px 8px; border: 0; border-bottom: 1px solid color-mix(in srgb, var(--vscode-panel-border) 65%, transparent); color: var(--vscode-descriptionForeground); background: transparent; text-align: left; font-size: 11px; cursor: pointer; }
    .task-collapse-all:hover { color: var(--vscode-foreground); background: var(--vscode-list-hoverBackground); }
    .task-collapse-all svg { width: 12px; height: 12px; transition: transform 120ms ease; }
    .task-collapse-all svg.collapsed { transform: rotate(-90deg); }
    .task-group { box-sizing: border-box; width: 100%; margin: 5px 0 9px; padding: 0 1px 4px; border: 1px solid color-mix(in srgb, var(--vscode-panel-border) 72%, transparent); border-radius: 4px; overflow: visible; }
    .message-segment-hidden { display: none !important; }
    .task-intermediate:not(.user) { margin-left: 10px; padding-left: 8px; border-left-width: 1px !important; }
    .task-fold-summary { display: flex; align-items: center; gap: 6px; width: 100%; min-height: 26px; padding: 4px 8px; border: 0; border-top: 1px solid color-mix(in srgb, var(--vscode-panel-border) 65%, transparent); border-bottom: 1px solid color-mix(in srgb, var(--vscode-panel-border) 65%, transparent); color: var(--vscode-descriptionForeground,#9d9d9d); background: transparent; font-size: 11px; text-align: left; cursor: pointer; }
    .task-fold-summary:hover { color: var(--vscode-foreground); background: var(--vscode-list-hoverBackground); }
    .task-fold-summary:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
    .task-fold-summary svg { flex: 0 0 12px; width: 12px; height: 12px; transition: transform 120ms ease; }
    .task-fold-summary svg.collapsed { transform: rotate(-90deg); }
    .task-fold-summary span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .composer-box:focus-within { border-color: var(--vscode-focusBorder); }
    .composer-box.drop-active { border-color: var(--vscode-focusBorder); background: var(--vscode-list-hoverBackground); }
    .composer-resize { display: grid; place-items: center; height: 9px; margin: -5px -2px 0; color: var(--vscode-descriptionForeground); cursor: row-resize; touch-action: none; }
    .composer-resize::before { content: ''; width: 34px; height: 2px; border-radius: 1px; background: currentColor; opacity: .55; }
    .composer-resize:hover { color: var(--vscode-foreground); }
    #prompt { resize: none; min-height: 88px; max-height: min(50vh,480px); width: 100%; border: 0; outline: 0; background: transparent; color: var(--vscode-input-foreground); padding: 2px; overflow-y: auto; }
    .composer-bottom { display: flex; flex-wrap: nowrap; align-items: center; justify-content: space-between; gap: 5px; min-width: 0; overflow: hidden; }
    .composer-left, .composer-right { display: flex; align-items: center; gap: 3px; min-width: 0; }
    .composer-left { flex: 0 1 auto; }
    .composer-right { flex: 1 1 0; justify-content: flex-end; overflow: hidden; }
    .composer-right > .icon-button, .composer-right > .context-meter-anchor, .composer-right > #send, .composer-right > #cancel { flex: 0 0 24px; }
    .composer-right .model-anchor { flex: 1 1 52px; min-width: 24px; max-width: 132px; overflow: hidden; }
    .composer-right .vision-anchor { flex: 0 0 36px; width: 36px; }
    .split-control { display: inline-flex; align-items: center; flex: 0 0 auto; border-radius: 3px; overflow: visible; }
    .split-control > .icon-button { flex: 0 0 22px; width: 22px; }
    .split-control > .split-arrow { flex-basis: 14px; width: 14px; }
    .split-control > .split-arrow svg { width: 10px; height: 10px; }
    .icon-button.toggle-on { color: var(--vscode-textLink-foreground); background: var(--vscode-toolbar-activeBackground); }
    .icon-button.attention { animation: vision-attention 600ms ease-in-out 3; outline: 1px solid var(--vscode-inputValidation-warningBorder); }
    @keyframes vision-attention { 50% { color: var(--vscode-editorWarning-foreground); background: var(--vscode-inputValidation-warningBackground); } }
    .menu-anchor { position: relative; min-width: 0; }
    .menu-button { display: inline-flex; align-items: center; justify-content: center; gap: 4px; min-width: 24px; height: 24px; max-width: 132px; padding: 0 5px; border-radius: 3px; color: var(--vscode-foreground); background: transparent; cursor: pointer; }
    .menu-button:hover, .menu-button[aria-expanded="true"] { background: var(--vscode-toolbar-hoverBackground); }
    .menu-button[disabled] { opacity: .45; cursor: default; }
    .menu-button .menu-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11px; }
    .menu-button .chevron { width: 12px; height: 12px; flex: 0 0 12px; }
    .popover { position: fixed; z-index: 20; top: 0; left: 0; width: 280px; max-width: calc(100vw - 12px); max-height: calc(100vh - 12px); overflow: auto; padding: 5px; border: 1px solid var(--vscode-menu-border,var(--vscode-panel-border)); border-radius: 4px; background: var(--vscode-menu-background,var(--vscode-dropdown-background)); color: var(--vscode-menu-foreground,var(--vscode-dropdown-foreground)); box-shadow: 0 6px 20px rgba(0,0,0,.32); }
    .model-popover { width: 330px; }
    .menu-section + .menu-section { margin-top: 5px; padding-top: 5px; border-top: 1px solid var(--vscode-menu-separatorBackground,var(--vscode-panel-border)); }
    .menu-heading { padding: 3px 7px 4px; color: var(--vscode-descriptionForeground); font-size: 10px; text-transform: uppercase; }
    .menu-options { display: grid; gap: 1px; }
    .menu-option { display: grid; grid-template-columns: 15px minmax(0,1fr); align-items: start; gap: 5px; width: 100%; min-height: 26px; padding: 4px 7px; border-radius: 3px; text-align: left; color: inherit; background: transparent; cursor: pointer; }
    .menu-option:hover { color: var(--vscode-menu-selectionForeground,var(--vscode-list-activeSelectionForeground)); background: var(--vscode-menu-selectionBackground,var(--vscode-list-activeSelectionBackground)); }
    .menu-option[disabled] { opacity: .5; cursor: default; }
    .menu-option-copy { display: grid; min-width: 0; }
    .menu-option-label, .menu-option-description { overflow-wrap: anywhere; }
    .menu-option-description { color: var(--vscode-descriptionForeground); font-size: 10px; }
    .menu-option:hover .menu-option-description { color: inherit; opacity: .8; }
    .file-submenu > summary { list-style: none; }
    .file-submenu > summary::-webkit-details-marker { display: none; }
    .file-submenu > summary .submenu-chevron { justify-self: end; width: 11px; height: 11px; transition: transform 100ms ease; }
    .file-submenu[open] > summary .submenu-chevron { transform: rotate(180deg); }
    .file-submenu > summary { grid-template-columns: 15px minmax(0,1fr) 11px; }
    .file-submenu-options { display: grid; gap: 1px; margin: 1px 0 3px 12px; padding-left: 5px; border-left: 1px solid var(--vscode-menu-separatorBackground,var(--vscode-panel-border)); }
    .menu-check { width: 14px; min-height: 14px; }
    .context-meter-anchor { position: relative; display: inline-flex; }
    #compact:has(.context-meter-anchor:not(.hidden)) > svg { display: none; }
    #compact .context-meter { width: 22px; height: 22px; }
    .context-meter { display: grid; place-items: center; width: 24px; height: 24px; padding: 0; border-radius: 3px; color: var(--vscode-descriptionForeground); background: transparent; }
    .context-meter:hover { background: var(--vscode-toolbar-hoverBackground); }
    .context-track, .context-fill { fill: none; stroke-width: 2; }
    .context-track { stroke: var(--vscode-panel-border); }
    .context-fill { stroke: var(--vscode-descriptionForeground); stroke-linecap: round; }
    .context-tooltip { position: fixed; z-index: 25; top: 0; left: 0; display: grid; gap: 2px; width: 198px; max-width: calc(100vw - 12px); padding: 9px 10px; border: 1px solid var(--vscode-menu-border,var(--vscode-panel-border)); border-radius: 5px; background: var(--vscode-menu-background,var(--vscode-dropdown-background)); color: var(--vscode-descriptionForeground); box-shadow: 0 6px 20px rgba(0,0,0,.32); text-align: center; font-size: 11px; line-height: 1.45; opacity: 0; visibility: hidden; transform: translateY(2px); transition: opacity 90ms ease, transform 90ms ease, visibility 90ms; pointer-events: none; }
    .context-meter-anchor:hover .context-tooltip, .context-meter-anchor:focus-within .context-tooltip { opacity: 1; visibility: visible; transform: translateY(0); }
    .context-tooltip strong { color: var(--vscode-foreground); font-weight: 600; }
    .context-figures { font-variant-numeric: tabular-nums; }
    .scroll-bottom { position: sticky; bottom: 8px; display: grid; place-items: center; width: 26px; height: 26px; margin: -34px 0 0 auto; padding: 0; border: 1px solid var(--vscode-panel-border); border-radius: 50%; background: var(--vscode-sideBar-background); color: var(--vscode-icon-foreground); box-shadow: 0 3px 10px rgba(0,0,0,.25); cursor: pointer; z-index: 30; }
    .scroll-bottom:hover { background: var(--vscode-toolbar-hoverBackground); color: var(--vscode-foreground); }
    .scroll-bottom svg { width: 14px; height: 14px; }
    .status { display: flex; align-items: center; gap: 6px; color: var(--vscode-descriptionForeground); font-size: 11px; padding-top: 6px; }
    .status-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--vscode-disabledForeground); }
    .status-dot.ready { background: var(--vscode-testing-iconPassed); }
    .status-dot.busy { background: var(--vscode-progressBar-background); }
    .status-dot.error { background: var(--vscode-testing-iconFailed); }
    .notice { position: fixed; top: 8px; right: 8px; z-index: 50; width: min(320px,calc(100% - 16px)); max-height: 72px; overflow: auto; overflow-wrap: anywhere; white-space: pre-wrap; padding: 7px 9px; border: 1px solid var(--vscode-widget-border); background: var(--vscode-notifications-background); color: var(--vscode-notifications-foreground); border-radius: 4px; box-shadow: 0 4px 18px rgba(0,0,0,.28); font-size: 11px; line-height: 1.35; }
    .notice.warning { border-color: var(--vscode-inputValidation-warningBorder); }
    .notice.error { border-color: var(--vscode-inputValidation-errorBorder); background: var(--vscode-inputValidation-errorBackground); color: var(--vscode-inputValidation-errorForeground); }
    .settings-dialog { position: fixed; inset: 7% 6%; z-index: 60; display: grid; grid-template-rows: auto minmax(0,1fr) auto; border: 1px solid var(--vscode-panel-border); background: var(--vscode-sideBar-background); box-shadow: 0 10px 30px rgba(0,0,0,.4); }
    .settings-title { display: flex; align-items: center; min-height: 42px; padding: 0 8px 0 14px; border-bottom: 1px solid var(--vscode-panel-border); }
    .settings-title h2 { flex: 1 1 auto; min-width: 0; margin: 0; font-size: 13px; font-weight: 600; }
    .settings-close { flex: 0 0 24px; }
    .settings-body { overflow: auto; padding: 10px 14px; }
    .settings-section { display: grid; gap: 6px; margin-bottom: 14px; }
    .settings-section h3 { margin: 0; font-size: 11px; color: var(--vscode-descriptionForeground); }
    .settings-section label { display: grid; gap: 3px; color: var(--vscode-descriptionForeground); font-size: 10px; }
    .settings-section input, .settings-section select, .settings-section textarea { min-height: 24px; width: 100%; border: 1px solid var(--vscode-input-border); background: var(--vscode-input-background); color: var(--vscode-input-foreground); padding: 3px 6px; font: 11px/1.3 var(--vscode-font-family); }
    .settings-section select { height: 24px; }
    .settings-section textarea { resize: vertical; }
    .settings-actions { display: flex; justify-content: flex-end; gap: 6px; padding: 8px 14px; border-top: 1px solid var(--vscode-panel-border); }
    .hidden { display: none !important; }
    @media (max-width: 520px) {
      .menu-button .permission-copy { display: none; }
      #permission-menu .chevron, #compact-menu, #vision-model-menu { display: none; }
      .composer-right .vision-anchor { flex-basis: 22px; width: 22px; }
      .composer-right .model-anchor { max-width: 118px; }
    }
    @media (max-width: 360px) {
      .compact-anchor, #delivery-mode { display: none; }
      .composer-right .model-anchor { max-width: 104px; }
    }
    @media (max-width: 280px) {
      .permission-anchor { display: none; }
      .composer-right .model-anchor { max-width: 84px; }
    }
  </style>
</head>
<body>
  <div class="app">
    <div id="notice" class="notice hidden"></div>
    <section id="settings-dialog" class="settings-dialog hidden" aria-label="DeepSeek Harness settings">
      <div class="settings-title"><h2>DeepSeek Harness settings</h2><button id="settings-close" class="icon-button settings-close" title="Close settings" aria-label="Close settings"><i data-lucide="x"></i></button></div>
      <div class="settings-body">
        <section id="settings-connection" class="settings-section"><h3>DeepSeek connection</h3><label>Base URL<input id="setting-base-url" type="url"></label><label>API key<input id="setting-api-key" type="password" placeholder="Leave blank to keep the stored key"></label></section>
        <section id="settings-vision" class="settings-section"><h3>Auxiliary vision model</h3><p class="settings-note">Optional image preprocessor controlled by the image button in the composer. It makes an extra model request before Harness receives the prompt. Leave it off when the selected main model accepts images directly.</p><label>Base URL<input id="setting-vision-url" type="url" title="OpenAI-compatible auxiliary vision endpoint. The extension calls /models and /chat/completions on this URL."></label><label>Model<input id="setting-vision-model" title="Enter any compatible auxiliary vision model id manually."><select id="setting-vision-model-picker" title="Models returned by the auxiliary endpoint. Obvious image-generation and code-review-only models are hidden here."><option value="">Select an endpoint model...</option></select></label><label>Reasoning effort<select id="setting-vision-reasoning" title="Optional reasoning_effort for the auxiliary vision request. Default sends no reasoning parameter."><option value="">Default</option><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="xhigh">Extra high</option><option value="max">Maximum</option></select></label><label>API key<input id="setting-vision-key" type="password" title="Stored only in VS Code SecretStorage; never included in the workspace or VSIX." placeholder="Leave blank to keep the stored key"></label></section>
        <section id="settings-context" class="settings-section"><h3>Context</h3><label>Convert pasted text to an attachment at (bytes)<input id="setting-paste-threshold" type="number" min="2048" max="131072"></label><label>Context window (tokens)<input id="setting-context-window" type="number" min="16384" max="16000000"></label></section>
        <section id="settings-handoff" class="settings-section"><h3>Handoff</h3><label>Codex home<input id="setting-codex-home"></label><label>Claude home<input id="setting-claude-home"></label><label title="Clipboard copies an isolated take-over prompt without starting a process. CLI starts the native Codex or Claude command in a new VS Code terminal. In both modes the source session remains unchanged.">Delivery mode<select id="setting-handoff-mode"><option value="clipboard">Clipboard</option><option value="cli">CLI</option></select></label></section>
        <section id="settings-skills" class="settings-section"><h3>Skills</h3><label>Directories (one per line)<textarea id="setting-skill-directories" rows="3"></textarea></label></section>
      </div>
      <div class="settings-actions"><button id="settings-cancel" class="command">Cancel</button><button id="settings-save" class="command primary">Save</button></div>
    </section>
    <div class="session-toolbar"><nav id="session-tabs" class="session-tabs" role="tablist" aria-label="DeepSeek Harness sessions"></nav><button id="fold-all" class="icon-button" title="Collapse all tasks" aria-label="Collapse all tasks"><i data-lucide="fold-vertical"></i></button><button id="expand-all" class="icon-button" title="Expand the first level of all tasks" aria-label="Expand the first level of all tasks"><i data-lucide="unfold-vertical"></i></button><button id="search-conversation" class="icon-button" title="Search current session" aria-label="Search current session"><i data-lucide="search"></i></button></div>
    <section id="search-panel" class="search-panel hidden" aria-label="Search current session"><div class="search-row"><input id="search-input" type="search" placeholder="Search in current session"><button id="search-selection" class="icon-button search-selection" title="Search selected text" aria-label="Search selected text"><i data-lucide="text-quote"></i></button><button id="search-prev" class="icon-button" title="Previous match" aria-label="Previous match"><i data-lucide="chevron-up"></i></button><button id="search-next" class="icon-button" title="Next match" aria-label="Next match"><i data-lucide="chevron-down"></i></button><button id="search-close" class="icon-button" title="Close search" aria-label="Close search"><i data-lucide="x"></i></button></div><div class="search-options"><label><input id="search-case" type="checkbox"> Aa</label><label><input id="search-word" type="checkbox"> Word</label><label><input id="search-regex" type="checkbox"> .* </label><span id="search-count"></span></div></section>
    <main id="conversation" class="conversation"><div class="empty">DeepSeek Harness</div></main>
    <footer class="composer">
      <div id="attachments" class="attachments"></div>
      <div id="steer-notice" class="steer-notice hidden"><span id="steer-notice-text">Steer message queued.</span><button id="steer-notice-close" title="Dismiss" aria-label="Dismiss"><i data-lucide="x"></i></button></div>
      <div id="composer-box" class="composer-box">
        <div id="composer-resize" class="composer-resize" role="separator" aria-orientation="horizontal" aria-label="Resize message input height" title="Drag up or down to resize the message input"></div>
        <textarea id="prompt" rows="4" placeholder="Message DeepSeek Harness; type @ to reference a skill"></textarea>
        <div id="skill-popover" class="skill-popover hidden" role="listbox" aria-label="Skills"></div>
        <div class="composer-bottom">
          <div class="composer-left">
            <div class="menu-anchor">
              <button id="attach-menu" class="icon-button" title="Add context" aria-label="Add context" aria-expanded="false"><i data-lucide="plus"></i></button>
              <div id="attach-popover" class="popover hidden" role="menu">
                <div id="attach-options" class="menu-options">
                  <details class="file-submenu"><summary class="menu-option"><i data-lucide="paperclip"></i><span class="menu-option-copy"><span class="menu-option-label">File</span><span class="menu-option-description">Choose from the workspace or this computer</span></span><i class="submenu-chevron" data-lucide="chevron-down"></i></summary><div class="file-submenu-options"><button id="attach-workspace-file" class="menu-option" role="menuitem"><i data-lucide="folder-open"></i><span class="menu-option-copy"><span class="menu-option-label">Workspace file</span><span class="menu-option-description">Find a file in the open workspace</span></span></button><button id="attach-external-file" class="menu-option" role="menuitem"><i data-lucide="hard-drive"></i><span class="menu-option-copy"><span class="menu-option-label">File from computer...</span><span class="menu-option-description">Open the system file picker</span></span></button></div></details>
                  <button id="review" class="menu-option" role="menuitem"><i data-lucide="diff"></i><span class="menu-option-copy"><span class="menu-option-label">Review changes</span></span></button>
                  <button id="handoff" class="menu-option" role="menuitem" title="Loads only a bounded text copy into a new target session; Codex and Claude source transcripts are never modified."><i data-lucide="arrow-left-right"></i><span class="menu-option-copy"><span class="menu-option-label">Load or hand off session</span><span class="menu-option-description">Read-only source; continue in a separate session</span></span></button>
                </div>
              </div>
            </div>
            <div class="menu-anchor permission-anchor">
              <button id="permission-menu" class="menu-button" title="Permission mode" aria-label="Permission mode" aria-expanded="false"><i data-lucide="shield-check"></i><span id="permission-label" class="menu-label permission-copy">Workspace</span><i class="chevron" data-lucide="chevron-down"></i></button>
              <div id="permission-popover" class="popover hidden" role="menu"><div id="permission-options" class="menu-options"></div></div>
            </div>
          </div>
          <div class="composer-right">
            <div class="menu-anchor split-control compact-anchor"><button id="compact" class="icon-button" title="Compact context" aria-label="Compact context"><i data-lucide="shrink"></i><span id="context-meter-anchor" class="context-meter-anchor hidden">
              <span id="context-meter" class="context-meter" aria-label="Context window" role="img">
                <svg viewBox="0 0 14 14" width="14" height="14" aria-hidden="true"><circle class="context-track" cx="7" cy="7" r="5.5"></circle><circle id="context-fill" class="context-fill" cx="7" cy="7" r="5.5" transform="rotate(-90 7 7)"></circle></svg>
              </span>
              <span id="context-tooltip" class="context-tooltip" role="tooltip"><span>Context window:</span><strong id="context-percent">0% full</strong><span id="context-figures" class="context-figures">0 / 1M tokens used</span><span id="context-trigger" class="context-figures">Auto compact at 800K</span></span>
            </span></button><button id="compact-menu" class="icon-button split-arrow" title="Compaction, folding, and context settings" aria-label="Compaction, folding, and context settings" aria-expanded="false"><i data-lucide="chevron-down"></i></button><div id="compact-popover" class="popover align-right hidden" role="menu"><div class="menu-heading">Compaction model</div><div id="compact-model-options" class="menu-options"></div><button id="compact-thinking" class="menu-option" role="menuitem" aria-pressed="false"><i data-lucide="fold-vertical"></i><span class="menu-option-copy"><span class="menu-option-label">Fold completed tasks</span><span class="menu-option-description">Collapse reasoning, tools, and nested process details</span></span></button><button id="configure-context" class="menu-option" role="menuitem"><i data-lucide="settings-2"></i><span class="menu-option-copy"><span class="menu-option-label">Context settings</span><span class="menu-option-description">Capacity and automatic threshold</span></span></button></div></div>
            <div class="menu-anchor model-anchor">
              <button id="model-menu" class="menu-button" title="Models are loading" aria-label="Models are loading" aria-expanded="false" disabled><span id="model-label" class="menu-label">Model</span><i class="chevron" data-lucide="chevron-down"></i></button>
              <div id="model-popover" class="popover model-popover align-right hidden" role="menu">
                <section class="menu-section"><div class="menu-heading">Model</div><div id="model-options" class="menu-options"></div></section>
                <section class="menu-section"><div class="menu-heading">Reasoning</div><div id="reasoning-options" class="menu-options"></div></section>
                <section class="menu-section"><div class="menu-heading">Agent preset</div><div id="preset-options" class="menu-options"></div></section>
              </div>
            </div>
            <div class="menu-anchor vision-anchor split-control">
              <button id="vision-toggle" class="icon-button" title="Auxiliary vision model" aria-label="Auxiliary vision model" aria-pressed="false"><i data-lucide="image"></i></button><button id="vision-model-menu" class="icon-button split-arrow" title="Auxiliary vision model options" aria-label="Auxiliary vision model options" aria-expanded="false"><i data-lucide="chevron-down"></i></button>
              <div id="vision-model-popover" class="popover align-right hidden" role="menu"><div class="menu-heading">Auxiliary vision model</div><div id="vision-model-options" class="menu-options"></div></div>
            </div>
            <div class="menu-anchor delivery-anchor split-control">
              <button id="send" class="icon-button" title="Wait for Harness to connect" aria-label="Wait for Harness to connect" disabled><i data-lucide="send"></i></button>
              <button id="delivery-mode" class="icon-button split-arrow delivery-mode" title="Delivery mode: Auto" aria-label="Delivery mode: Auto" aria-expanded="false"><i data-lucide="chevron-down"></i></button>
              <div id="delivery-popover" class="popover align-right hidden" role="menu">
                <div class="menu-heading">Delivery mode</div>
                <button id="delivery-auto" class="menu-option" role="menuitem"><i data-lucide="wand-sparkles"></i><span class="menu-option-copy"><span class="menu-option-label">Auto</span><span class="menu-option-description">Steer while running; queue when idle</span></span></button>
                <button id="delivery-steer" class="menu-option" role="menuitem"><i data-lucide="corner-down-right"></i><span class="menu-option-copy"><span class="menu-option-label">Steer</span><span class="menu-option-description">Inject into the active turn immediately</span></span></button>
                <button id="delivery-queue" class="menu-option" role="menuitem"><i data-lucide="list-plus"></i><span class="menu-option-copy"><span class="menu-option-label">Queue</span><span class="menu-option-description">Run after the current turn finishes</span></span></button>
              </div>
            </div>
            <button id="cancel" class="icon-button hidden" title="Stop" aria-label="Stop"><i data-lucide="square"></i></button>
          </div>
        </div>
      </div>
      <div class="status"><span id="status-dot" class="status-dot"></span><span id="status-text">Stopped</span><button id="set-key" class="icon-button" title="Settings: API keys, vision, skills, handoff" aria-label="Settings: API keys, vision, skills, handoff"><i data-lucide="sliders-horizontal"></i></button></div>
    </footer>
  </div>
  <script nonce="${nonce}" src="${script}"></script>
</body>
</html>`
}

function uniqueUris(uris: readonly vscode.Uri[]): vscode.Uri[] {
  const output = new Map<string, vscode.Uri>()
  for (const uri of uris) output.set(uri.toString(), uri)
  return [...output.values()]
}

function operationLabel(operation: WorkbenchSession['operation']): string {
  if (operation === 'archiving') return 'being archived'
  if (operation === 'deleting') return 'being moved to the recovery folder'
  if (operation === 'compacting') return 'compacting context'
  return 'stopping'
}

function conciseNotice(value: string): string {
  const normalized = value.trim()
  if (normalized.length <= 360) return normalized
  return `${normalized.slice(0, 330).trimEnd()}... See the DeepSeek Harness output log for details.`
}

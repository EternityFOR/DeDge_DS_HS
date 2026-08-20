import { randomBytes } from 'node:crypto'
import * as vscode from 'vscode'
import type { ContextAttachment } from '../context/context-collector.js'
import type { ChangeReviewService } from '../diff/change-review.js'
import { errorMessage, type Logger } from '../platform/logger.js'
import type { WorkbenchController } from '../session/workbench-controller.js'
import type { WorkbenchSession } from '../session/types.js'
import { isRecord } from '../gateway/protocol.js'
import type { HostToWebviewMessage, WebviewToHostMessage } from './webview-protocol.js'
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
  readonly openSettings: () => Promise<void>
}

type SessionPickerAction = 'load-codex' | 'load-claude' | 'handoff-current'
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
    const items: SessionPickerItem[] = []
    if (snapshot.sessions.length > 0) {
      items.push({ label: 'DeepSeek Harness sessions', kind: vscode.QuickPickItemKind.Separator })
      items.push(...snapshot.sessions.map(session => ({
        label: session.title,
        ...(session.cwd === undefined ? {} : { description: session.cwd }),
        detail: session.id,
        sessionId: session.id,
        picked: session.id === snapshot.activeSessionId,
      })))
    }
    items.push(
      { label: 'Load or hand off', kind: vscode.QuickPickItemKind.Separator },
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
    )
    const picked = await vscode.window.showQuickPick(items, {
      title: 'Select DeepSeek Harness session',
      placeHolder: 'Select a DeepSeek session, load local history, or hand off the current session',
      matchOnDescription: true,
      matchOnDetail: true,
      canPickMany: false,
    })
    if (picked === undefined) return
    let staged: StagedHandoff | undefined
    if ('sessionId' in picked) await this.controller.selectSession(picked.sessionId)
    else if ('action' in picked) {
      if (picked.action === 'load-codex') staged = await this.actions.loadCodexSession()
      else if (picked.action === 'load-claude') staged = await this.actions.loadClaudeSession()
      else staged = await this.actions.handoffCurrentSession()
    }
    await this.stageHandoff(staged)
    await this.focus()
  }

  async manageSession(sessionId?: string): Promise<void> {
    const snapshot = this.controller.snapshot()
    const targetId = sessionId ?? snapshot.activeSessionId
    const session = snapshot.sessions.find(item => item.id === targetId)
    if (session === undefined) {
      void vscode.window.showInformationMessage('No active DeepSeek Harness session is available to manage.')
      return
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
      return
    }
    if (message.type === 'send') {
      const attachments = [...this.attachments]
      try {
        await this.controller.send(message.text, attachments, message.mode ?? 'queue')
        const sentIds = new Set(attachments.map(item => item.id))
        this.attachments = this.attachments.filter(item => !sentIds.has(item.id))
        if (this.pendingHandoff?.sessionId === this.controller.snapshot().activeSessionId) await this.clearPendingHandoff()
        await this.post({ type: 'sendSettled', accepted: true, text: message.text })
        await this.postState()
      } catch (error) {
        const detail = errorMessage(error)
        this.logger.error('Workbench send failed', error)
        await this.post({ type: 'notice', level: 'error', message: conciseNotice(detail) })
        await this.post({ type: 'sendSettled', accepted: false, text: message.text })
      }
      return
    }
    if (message.type === 'newSession') return this.run(() => this.controller.newSession())
    if (message.type === 'selectSession') return this.run(() => this.controller.selectSession(message.sessionId))
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
    if (message.type === 'openSettings') return this.run(this.actions.openSettings)
    if (message.type === 'attachSelection') return this.run(async () => {
      const item = await this.controller.attachSelection()
      if (item !== undefined) this.upsertAttachment(item)
    })
    if (message.type === 'attachDiagnostics') return this.run(async () => {
      const item = await this.controller.attachDiagnostics()
      if (item !== undefined) this.upsertAttachment(item)
    })
    if (message.type === 'attachFile') return this.run(async () => {
      const item = await this.controller.attachFile()
      if (item !== undefined) this.upsertAttachment(item)
    })
    if (message.type === 'attachUris') return this.run(async () => {
      for (const value of message.uris) this.upsertAttachment(await this.controller.attachUri(vscode.Uri.parse(value, true)))
    })
    if (message.type === 'attachTextFiles') return this.run(async () => {
      for (const file of message.files) this.upsertAttachment(await this.controller.attachTextFile(file.name, file.text))
    })
    if (message.type === 'attachImageFiles') return this.run(async () => {
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
    if (message.type === 'approve') return this.run(() => this.controller.approve(message.approvalId, message.outcome))
    if (message.type === 'answerQuestions') return this.run(() => this.controller.answerQuestions(message.rpcId, message.answers))
    if (message.type === 'selectModel') return this.run(() => this.controller.selectModel(message.provider, message.model, message.reasoningEffort))
    if (message.type === 'selectPreset') return this.run(() => this.controller.selectPreset(message.preset))
    if (message.type === 'selectPermission') return this.run(async () => {
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

  private scheduleStatePost(): void {
    if (this.statePostScheduled) return
    this.statePostScheduled = true
    this.statePostTimer = setTimeout(() => {
      this.statePostScheduled = false
      this.statePostTimer = undefined
      void this.restorePendingHandoff().then(() => this.postState())
    }, 30)
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
  if (type === 'ready' || type === 'newSession' || type === 'cancel' || type === 'start' || type === 'restart' || type === 'stop'
    || type === 'setApiKey' || type === 'openSettings' || type === 'attachSelection' || type === 'attachDiagnostics' || type === 'attachFile'
    || type === 'compact' || type === 'configureContextWindow' || type === 'handoff' || type === 'showLogs' || type === 'reviewChanges' || type === 'diagnose') return { type }
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
  if (type === 'approve' && typeof value.approvalId === 'string' && (value.outcome === 'allowed-once' || value.outcome === 'rejected')) return { type, approvalId: value.approvalId, outcome: value.outcome }
  if (type === 'answerQuestions' && typeof value.rpcId === 'string' && Array.isArray(value.answers)) {
    const answers = value.answers.map(parseQuestionAnswer)
    return { type, rpcId: value.rpcId, answers }
  }
  if (type === 'selectModel' && typeof value.provider === 'string' && typeof value.model === 'string') return { type, provider: value.provider, model: value.model, ...(typeof value.reasoningEffort === 'string' ? { reasoningEffort: value.reasoningEffort } : {}) }
  if (type === 'selectPreset' && typeof value.preset === 'string') return { type, preset: value.preset }
  if (type === 'selectPermission' && typeof value.permission === 'string') return { type, permission: value.permission }
  throw new Error(`Unsupported webview message: ${type}`)
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
    body { margin: 0; color: var(--vscode-foreground); background: var(--vscode-sideBar-background); font: var(--vscode-font-size)/1.45 var(--vscode-font-family); }
    button, textarea, input { font: inherit; color: inherit; letter-spacing: 0; }
    button { border: 0; }
    .app { display: grid; grid-template-rows: auto minmax(0,1fr) auto; height: 100vh; min-width: 240px; }
    .actions, .attachments, .control-group { display: flex; align-items: center; gap: 4px; min-width: 0; }
    .icon-button { display: inline-grid; place-items: center; flex: 0 0 24px; width: 24px; height: 24px; padding: 0; color: var(--vscode-icon-foreground); background: transparent; border-radius: 3px; cursor: pointer; }
    .icon-button svg, .menu-button svg, .menu-option svg { width: 14px; height: 14px; stroke-width: 1.9; }
    .icon-button:hover { background: var(--vscode-toolbar-hoverBackground); }
    .icon-button:focus-visible, .menu-button:focus-visible, .menu-option:focus-visible, .context-meter:focus-visible, .session-tab:focus-visible, .session-tab-manage:focus-visible, .command:focus-visible, textarea:focus-visible, input:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 1px; }
    .icon-button[disabled] { opacity: .45; cursor: default; }
    .session-tabs { display: flex; align-items: stretch; min-height: 30px; overflow-x: auto; overflow-y: hidden; border-bottom: 1px solid var(--vscode-panel-border); scrollbar-width: none; }
    .session-tabs::-webkit-scrollbar { display: none; }
    .session-tab-wrap { display: inline-flex; align-items: stretch; flex: 0 1 172px; min-width: 94px; max-width: 202px; height: 30px; }
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
    .conversation { overflow: auto; min-height: 0; padding: 2px 10px 18px; }
    .empty { display: grid; place-items: center; min-height: 100%; color: var(--vscode-descriptionForeground); text-align: center; padding: 24px; font-size: 12px; }
    .message { padding: 12px 2px; border-bottom: 1px solid color-mix(in srgb, var(--vscode-panel-border) 70%, transparent); overflow-wrap: anywhere; }
    .message-head { display: flex; align-items: center; gap: 4px; min-height: 18px; margin-bottom: 3px; opacity: 0; transition: opacity 90ms ease; }
    .message:hover .message-head, .message.collapsed .message-head { opacity: 1; }
    .message-role-label { color: var(--vscode-descriptionForeground); font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: .03em; }
    .collapse-toggle { display: grid; place-items: center; width: 18px; height: 18px; padding: 0; background: transparent; color: var(--vscode-descriptionForeground); border-radius: 3px; cursor: pointer; }
    .collapse-toggle:hover { background: var(--vscode-toolbar-hoverBackground); color: var(--vscode-foreground); }
    .collapse-toggle svg { width: 13px; height: 13px; transition: transform 120ms ease; }
    .collapse-toggle.collapsed svg { transform: rotate(-90deg); }
    .message-preview { color: var(--vscode-descriptionForeground); font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100%; }
    .message.user { padding-left: 10px; border-left: 2px solid var(--vscode-charts-blue); }
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
    details.message summary { cursor: pointer; color: var(--vscode-descriptionForeground); display: flex; align-items: center; gap: 4px; list-style: none; }
    details.message summary::-webkit-details-marker { display: none; }
    details.message .summary-chevron { width: 12px; height: 12px; flex: 0 0 12px; transition: transform 120ms ease; }
    details.message:not([open]) .summary-chevron { transform: rotate(-90deg); }
    details.message .summary-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    details.reasoning { border-left: 2px solid var(--vscode-charts-yellow); padding-left: 8px; }
    details.tool { border-left: 2px solid var(--vscode-charts-green); padding-left: 8px; }
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
    .composer { border-top: 1px solid var(--vscode-panel-border); padding: 8px 10px 9px; background: var(--vscode-sideBar-background); }
    .attachments { overflow-x: auto; padding-bottom: 6px; }
    .chip { display: inline-flex; align-items: center; gap: 4px; flex: 0 0 auto; max-width: 220px; padding: 3px 6px; border: 1px solid var(--vscode-badge-background); border-radius: 3px; background: var(--vscode-editor-inactiveSelectionBackground); color: var(--vscode-foreground); }
    .chip span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .attachment-thumb { flex: 0 0 26px; width: 26px; height: 26px; border-radius: 3px; object-fit: cover; border: 1px solid var(--vscode-panel-border); }
    .file-thumb { display: grid; place-items: center; background: var(--vscode-editor-inactiveSelectionBackground); color: var(--vscode-descriptionForeground); }
    .file-thumb svg { width: 14px; height: 14px; }
    .empty { display: grid; place-items: center; gap: 10px; min-height: 100%; color: var(--vscode-descriptionForeground); text-align: center; padding: 24px; font-size: 12px; }
    .empty-title { font-size: 12px; }
    .chip button { display: grid; place-items: center; background: transparent; cursor: pointer; padding: 0; }
    .composer-box { position: relative; display: grid; grid-template-rows: minmax(88px,auto) auto; gap: 5px; border: 1px solid var(--vscode-input-border); border-radius: 5px; background: var(--vscode-input-background); padding: 7px; transition: border-color 80ms ease, background 80ms ease; }
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
    .turn-hidden { display: none !important; }
    .turn-badge { display: inline-flex; align-items: center; margin-left: 6px; padding: 1px 6px; border: 1px solid var(--vscode-panel-border); border-radius: 8px; color: var(--vscode-descriptionForeground); font-size: 10px; cursor: pointer; }
    .turn-badge:hover { color: var(--vscode-foreground); background: var(--vscode-toolbar-hoverBackground); }
    .composer-box:focus-within { border-color: var(--vscode-focusBorder); }
    .composer-box.drop-active { border-color: var(--vscode-focusBorder); background: var(--vscode-list-hoverBackground); }
    textarea { resize: none; min-height: 88px; max-height: 240px; width: 100%; border: 0; outline: 0; background: transparent; color: var(--vscode-input-foreground); padding: 2px; overflow-y: auto; }
    .composer-bottom { display: flex; align-items: center; justify-content: space-between; gap: 6px; min-width: 0; }
    .composer-left, .composer-right { display: flex; align-items: center; gap: 3px; min-width: 0; }
    .composer-left { flex: 0 1 auto; }
    .composer-right { flex: 1 1 0; justify-content: flex-end; overflow: hidden; }
    .composer-right .menu-anchor { flex: 1 1 auto; max-width: 132px; }
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
    .menu-check { width: 14px; min-height: 14px; }
    .context-meter-anchor { position: relative; display: inline-flex; }
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
    .notice { position: fixed; top: 8px; left: 10px; right: 10px; z-index: 50; max-height: min(96px,calc(100vh - 16px)); overflow: auto; overflow-wrap: anywhere; white-space: pre-wrap; padding: 8px 10px; border: 1px solid var(--vscode-inputValidation-errorBorder); background: var(--vscode-inputValidation-errorBackground); border-radius: 4px; box-shadow: 0 4px 18px rgba(0,0,0,.28); line-height: 1.35; }
    .hidden { display: none !important; }
    @media (max-width: 420px) {
      .composer-bottom { display: grid; grid-template-columns: minmax(0, 1fr); gap: 3px; }
      .composer-left, .composer-right { width: 100%; }
      .composer-right { overflow: visible; }
      .composer-right .menu-anchor { max-width: none; }
      #model-menu { width: 100%; max-width: none; }
    }
    @media (max-width: 310px) {
      .menu-button .permission-copy { display: none; }
    }
    @media (max-width: 280px) {
      #model-menu { max-width: none; }
    }
  </style>
</head>
<body>
  <div class="app">
    <div id="notice" class="notice hidden"></div>
    <nav id="session-tabs" class="session-tabs" role="tablist" aria-label="DeepSeek Harness sessions"></nav>
    <main id="conversation" class="conversation"><div class="empty">DeepSeek Harness</div></main>
    <footer class="composer">
      <div id="attachments" class="attachments"></div>
      <div id="steer-notice" class="steer-notice hidden"><span id="steer-notice-text">Steer message queued.</span><button id="steer-notice-close" title="Dismiss" aria-label="Dismiss"><i data-lucide="x"></i></button></div>
      <div id="composer-box" class="composer-box">
        <textarea id="prompt" rows="4" placeholder="Message DeepSeek Harness; type @ to reference a skill"></textarea>
        <div id="skill-popover" class="skill-popover hidden" role="listbox" aria-label="Skills"></div>
        <div class="composer-bottom">
          <div class="composer-left">
            <div class="menu-anchor">
              <button id="attach-menu" class="icon-button" title="Add context" aria-label="Add context" aria-expanded="false"><i data-lucide="plus"></i></button>
              <div id="attach-popover" class="popover hidden" role="menu">
                <div id="attach-options" class="menu-options">
                  <button id="attach-file" class="menu-option" role="menuitem"><i data-lucide="paperclip"></i><span class="menu-option-copy"><span class="menu-option-label">File</span></span></button>
                  <button id="attach-selection" class="menu-option" role="menuitem"><i data-lucide="text-quote"></i><span class="menu-option-copy"><span class="menu-option-label">Editor selection</span></span></button>
                  <button id="attach-problems" class="menu-option" role="menuitem"><i data-lucide="triangle-alert"></i><span class="menu-option-copy"><span class="menu-option-label">Problems</span></span></button>
                  <button id="review" class="menu-option" role="menuitem"><i data-lucide="diff"></i><span class="menu-option-copy"><span class="menu-option-label">Review changes</span></span></button>
                  <button id="handoff" class="menu-option" role="menuitem" title="Loads only a bounded text copy into a new target session; Codex and Claude source transcripts are never modified."><i data-lucide="arrow-left-right"></i><span class="menu-option-copy"><span class="menu-option-label">Load or hand off session</span><span class="menu-option-description">Read-only source; continue in a separate session</span></span></button>
                </div>
              </div>
            </div>
            <div class="menu-anchor">
              <button id="permission-menu" class="menu-button" title="Permission mode" aria-label="Permission mode" aria-expanded="false"><i data-lucide="shield-check"></i><span id="permission-label" class="menu-label permission-copy">Workspace</span><i class="chevron" data-lucide="chevron-down"></i></button>
              <div id="permission-popover" class="popover hidden" role="menu"><div id="permission-options" class="menu-options"></div></div>
            </div>
            <button id="configure-context" class="icon-button" title="Configure context capacity and automatic compaction threshold" aria-label="Configure context capacity and automatic compaction threshold"><i data-lucide="settings-2"></i></button>
          </div>
          <div class="composer-right">
            <button id="compact-thinking" class="icon-button" title="Collapse thinking and tool details by default" aria-label="Collapse thinking and tool details by default" aria-pressed="false"><i data-lucide="fold-vertical"></i></button>
            <button id="compact" class="icon-button" title="Compact context" aria-label="Compact context"><i data-lucide="shrink"></i></button>
            <span id="context-meter-anchor" class="context-meter-anchor hidden">
              <span id="context-meter" class="context-meter" aria-label="Context window" role="img" tabindex="0">
                <svg viewBox="0 0 14 14" width="14" height="14" aria-hidden="true"><circle class="context-track" cx="7" cy="7" r="5.5"></circle><circle id="context-fill" class="context-fill" cx="7" cy="7" r="5.5" transform="rotate(-90 7 7)"></circle></svg>
              </span>
              <span id="context-tooltip" class="context-tooltip" role="tooltip"><span>Context window:</span><strong id="context-percent">0% full</strong><span id="context-figures" class="context-figures">0 / 1M tokens used</span><span id="context-trigger" class="context-figures">Auto compact at 800K</span></span>
            </span>
            <div class="menu-anchor">
              <button id="model-menu" class="menu-button" title="Models are loading" aria-label="Models are loading" aria-expanded="false" disabled><span id="model-label" class="menu-label">Model</span><i class="chevron" data-lucide="chevron-down"></i></button>
              <div id="model-popover" class="popover model-popover align-right hidden" role="menu">
                <section class="menu-section"><div class="menu-heading">Model</div><div id="model-options" class="menu-options"></div></section>
                <section class="menu-section"><div class="menu-heading">Reasoning</div><div id="reasoning-options" class="menu-options"></div></section>
                <section class="menu-section"><div class="menu-heading">Agent preset</div><div id="preset-options" class="menu-options"></div></section>
              </div>
            </div>
            <button id="send" class="icon-button" title="Wait for Harness to connect" aria-label="Wait for Harness to connect" disabled><i data-lucide="send"></i></button>
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
  return 'stopping'
}

function conciseNotice(value: string): string {
  const normalized = value.trim()
  if (normalized.length <= 360) return normalized
  return `${normalized.slice(0, 330).trimEnd()}... See the DeepSeek Harness output log for details.`
}

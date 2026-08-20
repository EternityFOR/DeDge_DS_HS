import { Buffer } from 'node:buffer'
import { setTimeout as delay } from 'node:timers/promises'
import * as vscode from 'vscode'
import type { ConfigurationService, HarnessConfiguration } from '../config/configuration.js'
import { buildPrompt, type ContextAttachment, ContextCollector } from '../context/context-collector.js'
import type { GatewayClient } from '../gateway/gateway-client.js'
import { parseContextPressureProjection, parsePermissionProjection, type HostFrame, type MuxFrame, type SessionEvent, type SessionSummary } from '../gateway/protocol.js'
import { errorMessage, type Logger } from '../platform/logger.js'
import type { CredentialStore } from '../security/credentials.js'
import type { RuntimeManager } from '../runtime/runtime-manager.js'
import type { PendingApproval, PendingQuestion, QuestionAnswer, WorkbenchSnapshot } from './types.js'
import { SessionOperationCoordinator } from './session-operations.js'
import { promptUnavailableReason } from './interaction-readiness.js'
import { SessionStore } from './session-store.js'
import { SessionTrashService } from './session-trash.js'
import { validateQuestionAnswers } from './question-answers.js'

export class WorkbenchController implements vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<WorkbenchSnapshot>()
  private readonly contextCollector = new ContextCollector()
  private readonly store: SessionStore
  private readonly sessionOperations: SessionOperationCoordinator
  private gateway: GatewayClient | undefined
  private runtimeSubscription: vscode.Disposable
  private configurationSubscription: vscode.Disposable
  private startTask: Promise<void> | undefined
  private disposed = false
  private publishTimer: ReturnType<typeof setTimeout> | undefined
  private publishScheduled = false

  readonly onDidChange = this.changed.event

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly configuration: ConfigurationService,
    private readonly credentials: CredentialStore,
    private readonly runtime: RuntimeManager,
    private readonly logger: Logger,
    private readonly sessionTrash: SessionTrashService,
  ) {
    this.store = new SessionStore(toStoreConfiguration(configuration.get()))
    this.sessionOperations = new SessionOperationCoordinator({
      onStart: (sessionId, operation) => {
        this.store.setSessionOperation(sessionId, operation)
        this.publish()
      },
      onFinish: sessionId => {
        this.store.setSessionOperation(sessionId, undefined)
        this.publish()
      },
    })
    this.runtimeSubscription = runtime.onDidChangeState(state => {
      this.store.setRuntime(state)
      this.publish()
    })
    this.configurationSubscription = configuration.onDidChange(next => {
      this.store.setConfiguration(toStoreConfiguration(next))
      this.publish()
    })
  }

  snapshot(): WorkbenchSnapshot {
    return this.store.snapshot()
  }

  start(): Promise<void> {
    if (this.startTask !== undefined) return this.startTask
    const task = this.startInternal().finally(() => {
      if (this.startTask === task) this.startTask = undefined
    })
    this.startTask = task
    return task
  }

  private async startInternal(): Promise<void> {
    if (this.disposed) throw new Error('The Harness workbench has been disposed.')
    this.sessionOperations.clear('cancelling')
    this.store.resetConnectionState()
    this.store.setPhase('connecting')
    this.publish()
    try {
      const apiKey = await this.credentials.getApiKey()
      this.store.setCredentials(apiKey !== undefined && apiKey.trim() !== '')
      const url = await this.runtime.start()
      this.gateway?.dispose()
      const gateway = await import('../gateway/gateway-client.js').then(module => new module.GatewayClient(url, this.logger))
      this.gateway = gateway
      await gateway.connect({
        onMux: (frame, rpcId) => this.handleMux(frame, rpcId),
        onHost: (frame, rpcId) => this.handleHost(frame, rpcId),
        onError: error => this.logger.warn(`Gateway event stream: ${error.message}`),
      })
      const [sessions, workspaces] = await Promise.all([gateway.listSessions(), gateway.listWorkspaces()])
      this.store.replaceSessions(sessions.items ?? [])
      this.store.replaceArchivedSessions(workspaces.archivedSessionIds ?? [])
      await this.refreshPresetCatalog(gateway)
      const remembered = this.context.workspaceState.get<string>('activeSessionId')
      const visibleSessions = this.store.snapshot().sessions
      const target = remembered !== undefined && visibleSessions.some(item => item.id === remembered)
        ? remembered
        : visibleSessions[0]?.id
      if (target === undefined) await this.newSession()
      else await this.selectSession(target)
      this.store.setPhase('connected')
      this.publish()
    } catch (error) {
      this.store.setError(errorMessage(error))
      this.publish()
      throw error
    }
  }

  async ensureStarted(): Promise<void> {
    if (this.store.snapshot().phase !== 'connected' || this.gateway === undefined) await this.start()
  }

  async newSession(): Promise<void> {
    await this.ensureRuntimeOnly()
    const gateway = this.requireGateway()
    if (this.store.snapshot().presetCatalog === undefined) await this.refreshPresetCatalog(gateway)
    const preset = presetForNewSession(this.configuration.get().agentPreset, this.store.snapshot().presetCatalog)
    const created = await gateway.createSession(workspaceDirectory(), preset)
    this.store.addSession({
      sessionId: created.sessionId,
      blank: true,
      running: false,
      cwd: workspaceDirectory(),
      ...(created.agentPreset === undefined ? {} : { agentPreset: created.agentPreset }),
    })
    await this.selectSession(created.sessionId)
  }

  async selectSession(sessionId: string): Promise<void> {
    await this.ensureRuntimeOnly()
    const gateway = this.requireGateway()
    const history = await gateway.history(sessionId)
    this.store.setActive(sessionId)
    this.store.replaceHistory(sessionId, history.events ?? [])
    this.store.setContextPressure(sessionId, parseContextPressureProjection(history.projections?.values?.contextPressure))
    this.store.setPermissions(sessionId, parsePermissionProjection(history.projections?.values?.permissions))
    await this.context.workspaceState.update('activeSessionId', sessionId)
    this.publish()
    await Promise.all([
      this.refreshModelCatalog(gateway, sessionId),
      this.refreshPresetCatalog(gateway),
    ])
  }

  async send(text: string, attachments: readonly ContextAttachment[] = []): Promise<void> {
    const normalized = text.trim()
    if (normalized === '' && attachments.length === 0) return
    const snapshot = this.store.snapshot()
    const unavailable = promptUnavailableReason(snapshot)
    if (unavailable !== undefined) throw new Error(unavailable)
    const sessionId = snapshot.activeSessionId
    if (sessionId === undefined) throw new Error('Wait for an active Harness session before sending.')
    const prompt = buildPrompt(normalized, attachments)
    const result = await this.requireGateway().prompt(sessionId, prompt)
    if (result.accepted === false) throw new Error('Harness rejected the prompt.')
  }

  cancel(): Promise<void> {
    const sessionId = this.store.snapshot().activeSessionId
    if (sessionId === undefined) return Promise.resolve()
    const session = this.store.snapshot().sessions.find(item => item.id === sessionId)
    if (session?.running !== true) return Promise.resolve()
    return this.sessionOperations.run(sessionId, 'cancelling', async () => {
      await this.requireGateway().cancel(sessionId)
      if (!await this.waitForCancellation(sessionId, 5_000)) {
        this.sessionOperations.finish(sessionId, 'cancelling')
        throw new Error('Harness accepted the stop request but the active tool or model call has not stopped yet. You can press Stop again; see Output > DeepSeek Harness for details.')
      }
    }, { retainOnSuccess: true })
  }

  archiveSession(sessionId: string): Promise<void> {
    return this.sessionOperations.run(sessionId, 'archiving', () => this.performArchiveSession(sessionId))
  }

  deleteSession(sessionId: string): Promise<string> {
    return this.sessionOperations.run(sessionId, 'deleting', () => this.performDeleteSession(sessionId))
  }

  private async performArchiveSession(sessionId: string): Promise<void> {
    await this.ensureStarted()
    const snapshot = this.store.snapshot()
    const session = snapshot.sessions.find(item => item.id === sessionId)
    if (session === undefined) return
    if (session.running) throw new Error('A session cannot be archived while its response is in progress.')
    const wasActive = snapshot.activeSessionId === sessionId
    const result = await this.requireGateway().archiveSession(sessionId)
    this.store.replaceArchivedSessions(result.archivedSessionIds)
    if (!wasActive) return this.publish()
    await this.context.workspaceState.update('activeSessionId', undefined)
    const replacement = this.store.snapshot().sessions[0]
    if (replacement === undefined) await this.newSession()
    else await this.selectSession(replacement.id)
  }

  private async performDeleteSession(sessionId: string): Promise<string> {
    await this.ensureStarted()
    const snapshot = this.store.snapshot()
    const session = snapshot.sessions.find(item => item.id === sessionId)
    if (session === undefined) return 'Session is no longer available.'
    if (snapshot.sessions.some(item => item.running)) {
      throw new Error('Finish or cancel all running responses before deleting a session because the local Harness runtime must restart.')
    }
    const runtimeVersion = this.runtime.state.version
    if (runtimeVersion === undefined) throw new Error('The Harness runtime version is unavailable; deletion was refused.')
    const sourcePath = await this.sessionTrash.locate(runtimeVersion, sessionId)
    if (snapshot.activeSessionId === sessionId) await this.context.workspaceState.update('activeSessionId', undefined)
    await this.stop()
    let trashed
    try {
      trashed = await this.sessionTrash.moveToTrash(runtimeVersion, sessionId, sourcePath)
    } catch (error) {
      await this.start().catch(restartError => this.logger.error('Harness restart after failed session deletion also failed', restartError))
      throw error
    }
    this.logger.info(`Moved session "${session.title}" (${session.id}) to recovery storage: ${trashed.directory}`)
    await this.start()
    return 'Session moved to recovery storage.'
  }

  async attachSelection(): Promise<ContextAttachment | undefined> {
    return this.contextCollector.collectSelection(this.configuration.get().contextMaxBytes)
  }

  async attachDiagnostics(): Promise<ContextAttachment | undefined> {
    return this.contextCollector.collectDiagnostics(this.configuration.get().contextMaxBytes)
  }

  async attachFile(): Promise<ContextAttachment | undefined> {
    return this.contextCollector.pickFile(this.configuration.get().contextMaxBytes)
  }

  async attachUri(uri: vscode.Uri): Promise<ContextAttachment> {
    return this.contextCollector.collectUri(uri, this.configuration.get().contextMaxBytes)
  }

  attachTextFile(name: string, text: string): ContextAttachment {
    return this.contextCollector.collectTextFile(name, text, this.configuration.get().contextMaxBytes)
  }

  attachHandoff(name: string, text: string): ContextAttachment {
    return this.contextCollector.collectTextFile(name, text, Math.max(1, Buffer.byteLength(text, 'utf8')))
  }

  async compact(): Promise<string> {
    await this.ensureStarted()
    const snapshot = this.store.snapshot()
    const sessionId = snapshot.activeSessionId
    if (sessionId === undefined) return 'No active session to compact.'
    if (snapshot.agentPreset === 'minimal') throw new Error('Context compaction is unavailable in the Minimal agent preset.')
    if (snapshot.sessions.find(session => session.id === sessionId)?.running === true) {
      throw new Error('Context cannot be compacted while a response is in progress.')
    }
    const result = await this.requireGateway().executeCommand(sessionId, '/compact')
    if (result.result?.kind === 'error') throw new Error(result.result.text ?? 'Harness rejected context compaction.')
    return result.result?.text ?? 'Context compaction completed.'
  }

  async approve(approvalId: string, outcome: 'allowed-once' | 'rejected'): Promise<void> {
    const approval = this.store.snapshot().approvals.find(item => item.id === approvalId)
    if (approval === undefined) return
    const receipt = await this.requireGateway().respond(approval.rpcId, {
      sessionId: approval.sessionId,
      approvalId: approval.id,
      outcome,
    })
    if (!receipt.accepted) throw new Error('Harness no longer considers this approval pending.')
    this.store.resolveApproval(approvalId)
    this.publish()
  }

  async answerQuestions(rpcId: string, answers: readonly QuestionAnswer[]): Promise<void> {
    const questions = this.store.snapshot().questions.filter(item => item.rpcId === rpcId)
    if (questions.length === 0) return
    const normalized = validateQuestionAnswers(questions, answers)
    const sessionId = questions[0]?.sessionId
    if (sessionId === undefined) return
    const receipt = await this.requireGateway().respond(rpcId, {
      sessionId,
      answer: {
        answers: normalized,
      },
    })
    if (!receipt.accepted) throw new Error('Harness no longer considers this question batch pending.')
    this.store.resolveQuestions(rpcId)
    this.publish()
  }

  async selectModel(provider: string, model: string, reasoningEffort?: string): Promise<void> {
    const sessionId = this.store.snapshot().activeSessionId
    if (sessionId === undefined) return
    const gateway = this.requireGateway()
    const result = await gateway.selectModel(sessionId, provider, model, reasoningEffort)
    const currentCatalog = this.store.snapshot().modelCatalog
    if (currentCatalog === undefined) await this.refreshModelCatalog(gateway, sessionId)
    else this.store.setModelCatalog(sessionId, { ...currentCatalog, current: result.selected, routable: true })
    await this.configuration.update('provider', result.selected.provider)
    await this.configuration.update('model', result.selected.model)
    if (result.selected.reasoningEffort !== undefined) await this.configuration.update('reasoningEffort', result.selected.reasoningEffort)
    this.publish()
  }

  async selectPreset(preset: string): Promise<void> {
    const snapshot = this.store.snapshot()
    const sessionId = snapshot.activeSessionId
    let selected = preset
    if (sessionId !== undefined) {
      const session = snapshot.sessions.find(item => item.id === sessionId)
      if (session?.blank !== true) throw new Error('Agent Preset can only be changed before the first prompt in a session.')
      const result = await this.requireGateway().selectPreset(sessionId, preset)
      selected = result.agentPreset
      this.store.setAgentPreset(sessionId, selected)
    }
    await this.configuration.update('agentPreset', selected)
    this.publish()
  }

  async selectPermission(mode: string): Promise<void> {
    if (mode !== 'read-only' && mode !== 'workspace-write' && mode !== 'danger-full-access') throw new Error(`Unsupported permission mode: ${mode}`)
    const snapshot = this.store.snapshot()
    const sessionId = snapshot.activeSessionId
    if (snapshot.permissionChanging) return
    if (snapshot.sessions.find(session => session.id === sessionId)?.running === true) {
      throw new Error('Finish or stop the current response before changing file permissions.')
    }
    this.store.setPermissionChanging(true)
    this.publish()
    try {
      if (sessionId !== undefined) {
        const gateway = this.requireGateway()
        const command = await gateway.executeCommand(sessionId, `/permission ${mode}`)
        if (command.result?.kind === 'error') throw new Error(command.result.text ?? 'Harness rejected the permission change.')
        const history = await gateway.history(sessionId)
        const permissions = parsePermissionProjection(history.projections?.values?.permissions)
        if (permissions === undefined || permissions.currentValue !== mode) {
          throw new Error(`Harness did not apply the requested permission mode (${mode}).`)
        }
        this.store.setPermissions(sessionId, permissions)
      }
      await this.configuration.update('permissionMode', mode)
    } finally {
      this.store.setPermissionChanging(false)
      this.publish()
    }
  }

  async restart(): Promise<void> {
    this.gateway?.dispose()
    this.gateway = undefined
    await this.runtime.restart()
    await this.start()
  }

  async stop(): Promise<void> {
    this.gateway?.dispose()
    this.gateway = undefined
    await this.runtime.stop()
    this.store.clearPendingInteractions()
    this.sessionOperations.clear('cancelling')
    this.store.setPhase('idle')
    this.publish()
  }

  dispose(): void {
    this.disposed = true
    if (this.publishTimer !== undefined) clearTimeout(this.publishTimer)
    this.sessionOperations.clear()
    this.runtimeSubscription.dispose()
    this.configurationSubscription.dispose()
    this.gateway?.dispose()
    this.gateway = undefined
    this.changed.dispose()
  }

  private async ensureRuntimeOnly(): Promise<void> {
    if (this.runtime.state.phase !== 'ready') await this.runtime.start()
    if (this.gateway === undefined) {
      const url = this.runtime.state.url
      if (url === undefined) throw new Error('Harness runtime is ready but did not publish a URL.')
      const gateway = await import('../gateway/gateway-client.js').then(module => new module.GatewayClient(url, this.logger))
      this.gateway = gateway
      await gateway.connect({
        onMux: (frame, rpcId) => this.handleMux(frame, rpcId),
        onHost: (frame, rpcId) => this.handleHost(frame, rpcId),
        onError: error => this.logger.warn(`Gateway event stream: ${error.message}`),
      })
    }
  }

  private requireGateway(): GatewayClient {
    if (this.gateway === undefined) throw new Error('Harness Gateway is not connected.')
    return this.gateway
  }

  private async refreshModelCatalog(gateway: GatewayClient, sessionId: string): Promise<void> {
    try {
      this.store.setModelCatalog(sessionId, await gateway.models(sessionId))
      this.publish()
    } catch (error) {
      this.logger.warn(`Could not load the Harness model catalog: ${errorMessage(error)}`)
    }
  }

  private async refreshPresetCatalog(gateway: GatewayClient): Promise<void> {
    try {
      this.store.setPresetCatalog(await gateway.presets())
      this.publish()
    } catch (error) {
      this.logger.warn(`Could not load the Harness agent preset catalog: ${errorMessage(error)}`)
    }
  }

  private handleMux(frame: MuxFrame, rpcId: string): void {
    if (frame.type === 'session/event') {
      this.store.appendEvent(frame.sessionId, frame.event, frame.view)
      if (frame.event.type === 'turn/end') this.sessionOperations.finish(frame.sessionId, 'cancelling')
      return this.publish()
    }
    if (frame.type === 'session/projection' && frame.key === 'status' && isRunningValue(frame.value)) {
      this.store.setRunning(frame.sessionId, frame.value.running)
      if (!frame.value.running) this.sessionOperations.finish(frame.sessionId, 'cancelling')
      return this.publish()
    }
    if (frame.type === 'session/projection' && frame.key === 'contextPressure') {
      this.store.setContextPressure(frame.sessionId, parseContextPressureProjection(frame.value))
      return this.publish()
    }
    if (frame.type === 'session/projection' && frame.key === 'permissions') {
      this.store.setPermissions(frame.sessionId, parsePermissionProjection(frame.value))
      return this.publish()
    }
    if (frame.type === 'approval/requested') {
      const approval: PendingApproval = { id: frame.approvalId, rpcId, sessionId: frame.sessionId, toolName: frame.toolName, ...(frame.reason === undefined ? {} : { reason: frame.reason }) }
      this.store.addApproval(approval)
      return this.publish()
    }
    if (frame.type === 'approval/resolved') {
      this.store.resolveApproval(frame.approvalId)
      return this.publish()
    }
    if (frame.type === 'question/requested') {
      const questions: PendingQuestion[] = frame.questions.map(question => ({
        id: question.id,
        rpcId,
        sessionId: frame.sessionId,
        question: question.question,
        ...(question.header === undefined ? {} : { header: question.header }),
        ...(question.detail === undefined ? {} : { detail: question.detail }),
        options: question.options ?? [],
        multiSelect: question.multiSelect === true,
      }))
      this.store.addQuestions(questions)
      return this.publish()
    }
    if (frame.type === 'question/resolved') {
      this.store.resolveQuestions(frame.questionRpcId)
      return this.publish()
    }
  }

  private handleHost(frame: HostFrame, _rpcId: string): void {
    if (frame.type === 'host/session-added') {
      this.store.addSession({
        sessionId: frame.sessionId,
        blank: true,
        running: false,
        ...(frame.cwd === undefined ? {} : { cwd: frame.cwd }),
        ...(frame.agentPreset === undefined ? {} : { agentPreset: frame.agentPreset }),
      })
    }
    if (frame.type === 'host/session-removed') this.store.removeSession(frame.sessionId)
    if (frame.type === 'host/session-status') {
      this.store.setRunning(frame.sessionId, frame.running)
      if (!frame.running) this.sessionOperations.finish(frame.sessionId, 'cancelling')
    }
    if (frame.type === 'host/archived-sessions-changed') this.store.replaceArchivedSessions(frame.archivedSessionIds)
    if (frame.type === 'host/agent-error') this.store.setError(frame.message)
    this.publish()
  }

  private publish(): void {
    if (this.publishScheduled) return
    this.publishScheduled = true
    this.publishTimer = setTimeout(() => {
      this.publishScheduled = false
      this.publishTimer = undefined
      if (!this.disposed) this.changed.fire(this.store.snapshot())
    }, 16)
  }

  private async waitForCancellation(sessionId: string, timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      if (this.store.snapshot().sessions.find(session => session.id === sessionId)?.running !== true) return true
      await delay(250)
    }
    try {
      const sessions = await this.requireGateway().listSessions()
      this.store.replaceSessions(sessions.items ?? [])
      const stopped = this.store.snapshot().sessions.find(session => session.id === sessionId)?.running !== true
      if (stopped) this.sessionOperations.finish(sessionId, 'cancelling')
      this.publish()
      return stopped
    } catch (error) {
      this.logger.warn(`Could not verify stop state for session ${sessionId}: ${errorMessage(error)}`)
      return false
    }
  }
}

function workspaceDirectory(): string {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd()
}

function toStoreConfiguration(configuration: HarnessConfiguration): { provider: string; model: string; reasoningEffort: string; agentPreset: string; permissionMode: string; contextWindowTokens: number } {
  return {
    provider: configuration.provider,
    model: configuration.model,
    reasoningEffort: configuration.reasoningEffort,
    agentPreset: configuration.agentPreset,
    permissionMode: configuration.permissionMode,
    contextWindowTokens: configuration.contextWindowTokens,
  }
}

function isRunningValue(value: unknown): value is { readonly running: boolean } {
  return typeof value === 'object' && value !== null && 'running' in value && typeof value.running === 'boolean'
}

function presetForNewSession(preferred: string, catalog: WorkbenchSnapshot['presetCatalog']): string {
  const healthy = catalog?.presets?.filter(preset => preset.broken === undefined) ?? []
  return healthy.find(preset => preset.id === preferred)?.id
    ?? healthy.find(preset => preset.isDefault)?.id
    ?? healthy[0]?.id
    ?? preferred
}

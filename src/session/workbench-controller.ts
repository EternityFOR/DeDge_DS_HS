import { Buffer } from 'node:buffer'
import { setTimeout as delay } from 'node:timers/promises'
import { readdir, rm, stat } from 'node:fs/promises'
import * as path from 'node:path'
import * as vscode from 'vscode'
import type { ConfigurationService, HarnessConfiguration } from '../config/configuration.js'
import { buildPrompt, type ContextAttachment, ContextCollector } from '../context/context-collector.js'
import type { GatewayClient } from '../gateway/gateway-client.js'
import { parseContextPressureProjection, parsePermissionProjection, type HostFrame, type MuxFrame, type SessionEvent, type SessionSummary } from '../gateway/protocol.js'
import { listSkills, parseSkillRefs, readSkillBody, type SkillSummary } from '../skills/skill-catalog.js'
import { describeImage } from '../vision/vision-client.js'
import { errorMessage, type Logger } from '../platform/logger.js'
import type { CredentialStore } from '../security/credentials.js'
import type { RuntimeManager } from '../runtime/runtime-manager.js'
import type { PendingApproval, PendingQuestion, QuestionAnswer, WorkbenchSendProgress, WorkbenchSnapshot } from './types.js'
import { SessionOperationCoordinator } from './session-operations.js'
import { promptUnavailableReason } from './interaction-readiness.js'
import { SessionStore } from './session-store.js'
import { SessionTrashService } from './session-trash.js'
import { validateQuestionAnswers } from './question-answers.js'
import type { PromptInspection } from '../ui/webview-protocol.js'

export class WorkbenchController implements vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<WorkbenchSnapshot>()
  private readonly contextCollector = new ContextCollector()
  private readonly store: SessionStore
  private readonly sessionOperations: SessionOperationCoordinator
  private gateway: GatewayClient | undefined
  private suppressAutoCreate = false
  private readonly deletedSessions = new Set<string>()
  private skillCatalogCache: { readonly key: string; readonly at: number; readonly items: Promise<SkillSummary[]> } | undefined
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
    const deleted = this.context.workspaceState.get<readonly string[]>('deletedSessions.v1')
    if (Array.isArray(deleted)) for (const id of deleted) this.deletedSessions.add(id)
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
      let sessions = (await gateway.listSessions()).items ?? []
      if (sessions.length === 0) {
        for (let attempt = 0; attempt < 4 && sessions.length === 0; attempt++) {
          await delay(1_000)
          sessions = (await gateway.listSessions()).items ?? []
        }
      }
      const workspaces = await gateway.listWorkspaces()
      this.store.replaceSessions(sessions.filter(item => !this.deletedSessions.has(item.sessionId)))
      this.store.replaceArchivedSessions(workspaces.archivedSessionIds ?? [])
      await this.refreshPresetCatalog(gateway)
      const remembered = this.context.workspaceState.get<string>('activeSessionId')
      const visibleSessions = this.store.snapshot().sessions
      const target = remembered !== undefined && visibleSessions.some(item => item.id === remembered)
        ? remembered
        : visibleSessions[0]?.id
      if (target === undefined && !this.suppressAutoCreate) await this.newSession()
      else if (target !== undefined) await this.selectSession(target)
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

  async newSession(requestedPreset?: string): Promise<void> {
    await this.ensureRuntimeOnly()
    const gateway = this.requireGateway()
    if (this.store.snapshot().presetCatalog === undefined) await this.refreshPresetCatalog(gateway)
    const preset = presetForNewSession(requestedPreset ?? this.configuration.get().agentPreset, this.store.snapshot().presetCatalog)
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

  async continueWithPreset(preset: string): Promise<ContextAttachment> {
    const snapshot = this.store.snapshot()
    const active = snapshot.sessions.find(item => item.id === snapshot.activeSessionId)
    if (active === undefined || active.blank) throw new Error('The current session does not need a preset handoff.')
    if (active.running) throw new Error('Stop the current response before continuing with another Agent Preset.')
    if (active.operation !== undefined) throw new Error('Wait for the current session operation to finish.')

    const transcript = snapshot.messages
      .filter(message => message.role === 'user' || message.role === 'assistant')
      .map(message => `${message.role === 'user' ? 'User' : 'Assistant'}:\n${message.text}`)
      .join('\n\n')
    const maxBytes = this.configuration.get().handoffMaxBytes
    const bytes = Buffer.from(transcript, 'utf8')
    const bounded = bytes.byteLength <= maxBytes
      ? transcript
      : `[Earlier conversation omitted]\n\n${bytes.subarray(bytes.byteLength - maxBytes).toString('utf8').replace(/^\uFFFD+/u, '')}`
    const sourceTitle = active.title
    await this.newSession(preset)
    await this.configuration.update('agentPreset', preset)
    this.publish()
    return this.attachHandoff(
      `Preset handoff from ${sourceTitle}.txt`,
      `Continue this task in the ${preset} Agent Preset. This is an isolated text handoff; reasoning, tool state, and the source session are unchanged.\n\n${bounded}`,
    )
  }

  async selectSession(sessionId: string): Promise<void> {
    await this.ensureRuntimeOnly()
    const gateway = this.requireGateway()
    const history = await gateway.history(sessionId)
    this.store.setActive(sessionId)
    this.store.replaceHistory(sessionId, history.events ?? [], history.hasMore === true)
    this.store.setContextPressure(sessionId, parseContextPressureProjection(history.projections?.values?.contextPressure))
    this.store.setPermissions(sessionId, parsePermissionProjection(history.projections?.values?.permissions))
    await this.context.workspaceState.update('activeSessionId', sessionId)
    this.publish()
    await Promise.all([
      this.refreshModelCatalog(gateway, sessionId),
      this.refreshPresetCatalog(gateway),
    ])
  }

  async loadOlderHistory(): Promise<void> {
    const snapshot = this.store.snapshot()
    const sessionId = snapshot.activeSessionId
    if (sessionId === undefined || !snapshot.hasMoreHistory || snapshot.historyLoading) return
    const earliestSeq = this.store.historyBeforeSeq(sessionId)
    if (earliestSeq === undefined) return
    let beforeSeq: number = earliestSeq
    const initialUnits = conversationUnitCount(snapshot.messages)
    this.store.setHistoryLoading(true)
    this.publish()
    try {
      // Gateway pages may contain only internal events that do not project into
      // visible messages. Advance the raw event cursor until the UI gains a unit.
      for (let page = 0; page < 8; page++) {
        const history = await this.requireGateway().history(sessionId, 40, beforeSeq)
        const entries = history.events ?? []
        const nextBeforeSeq: number = entries.reduce((minimum, entry) => Math.min(minimum, entry.event.seq), beforeSeq)
        const advanced = nextBeforeSeq < beforeSeq
        const hasMore = history.hasMore === true && advanced
        this.store.prependHistory(sessionId, entries, hasMore)
        if (!hasMore || conversationUnitCount(this.store.snapshot().messages) > initialUnits) break
        beforeSeq = nextBeforeSeq
      }
    } finally {
      this.store.setHistoryLoading(false)
      this.publish()
    }
  }

  async send(text: string, attachments: readonly ContextAttachment[] = [], mode: 'queue' | 'steer' = 'queue', onProgress?: (progress: WorkbenchSendProgress) => void): Promise<void> {
    const normalized = text.trim()
    if (normalized === '' && attachments.length === 0) return
    await this.ensureStarted()
    if (this.store.snapshot().activeSessionId === undefined) await this.newSession()
    const snapshot = this.store.snapshot()
    const unavailable = promptUnavailableReason(snapshot)
    if (unavailable !== undefined) throw new Error(unavailable)
    const sessionId = snapshot.activeSessionId
    if (sessionId === undefined) throw new Error('Wait for an active Harness session before sending.')
    const resolved = await this.resolveAttachments(normalized, attachments, onProgress)
    const prompt = buildPrompt(normalized, resolved)
    const result = await this.requireGateway().prompt(sessionId, prompt, mode)
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
    if (replacement !== undefined) await this.selectSession(replacement.id)
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
    let sourcePath: string | undefined
    try {
      sourcePath = await this.sessionTrash.locate(runtimeVersion, sessionId)
    } catch (error) {
      this.logger.warn(`No persisted data found for session ${sessionId}; falling back to archive removal. ${errorMessage(error)}`)
    }
    if (snapshot.activeSessionId === sessionId) await this.context.workspaceState.update('activeSessionId', undefined)
    this.deletedSessions.add(sessionId)
    await this.context.workspaceState.update('deletedSessions.v1', [...this.deletedSessions])
    this.suppressAutoCreate = true
    try {
      if (sourcePath === undefined) {
        const archived = await this.requireGateway().archiveSession(sessionId)
        this.store.replaceArchivedSessions(archived.archivedSessionIds)
      }
      await this.stop()
      if (sourcePath !== undefined) {
        const trashed = await this.sessionTrash.moveToTrash(runtimeVersion, sessionId, sourcePath)
        this.logger.info(`Moved session "${session.title}" (${session.id}) to recovery storage: ${trashed.directory}`)
        this.deletedSessions.delete(sessionId)
        await this.context.workspaceState.update('deletedSessions.v1', [...this.deletedSessions])
      }
      this.store.removeSession(sessionId)
      this.publish()
      await this.start()
    } finally {
      this.suppressAutoCreate = false
    }
    return sourcePath === undefined
      ? 'Session removed from the workbench (no persisted data was found on disk).'
      : 'Session moved to recovery storage.'
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

  async attachTextFile(name: string, text: string): Promise<ContextAttachment> {
    const directory = this.pastedDirectory()
    const attachment = await this.contextCollector.collectTextFile(
      name,
      text,
      this.configuration.get().contextMaxBytes,
      directory,
      this.configuration.get().pasteFileThreshold,
    )
    void this.cleanupPastedFiles(directory)
    return attachment
  }

  async deletePastedFile(target: string): Promise<void> {
    const directory = this.pastedDirectory()
    const resolved = path.resolve(target)
    if (!resolved.startsWith(directory + path.sep)) return
    await rm(resolved, { force: true }).catch(() => undefined)
  }

  async openPastedFile(target: string): Promise<void> {
    const directory = this.pastedDirectory()
    const resolved = path.resolve(target)
    if (!resolved.startsWith(directory + path.sep)) throw new Error('Attachment path is outside the managed temporary directory.')
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(resolved))
    await vscode.window.showTextDocument(document, { preview: false })
  }

  private pastedDirectory(): string {
    return path.join(this.context.globalStorageUri.fsPath, 'tmp', 'pasted')
  }

  private async cleanupPastedFiles(directory: string): Promise<void> {
    try {
      const entries = await readdir(directory)
      const cutoff = Date.now() - 24 * 60 * 60 * 1000
      for (const entry of entries) {
        const candidate = path.join(directory, entry)
        const info = await stat(candidate).catch(() => undefined)
        if (info !== undefined && info.isFile() && info.mtimeMs < cutoff) {
          await rm(candidate, { force: true }).catch(() => undefined)
        }
      }
    } catch {
      // The directory may not exist yet; nothing to clean.
    }
  }

  async attachImageData(name: string, dataUrl: string): Promise<ContextAttachment> {
    return this.contextCollector.collectImageData(name, dataUrl, this.configuration.get().visionMaxBytes)
  }

  listSkillCatalog(): Promise<SkillSummary[]> {
    return this.loadSkillCatalog()
  }

  async inspectPrompt(input: string, attachments: readonly ContextAttachment[]): Promise<PromptInspection> {
    const configuration = this.configuration.get()
    const profileText = [
      `Agent preset: ${configuration.agentPreset}`,
      `Permission: ${configuration.permissionMode}`,
      `Provider/model: ${configuration.provider}/${configuration.model}`,
      `Reasoning effort: ${configuration.reasoningEffort}`,
      `Context capacity: ${String(configuration.contextWindowTokens)}`,
    ].join('\n')
    const layers: PromptInspection['layers'][number][] = [{
      id: 'runtime-profile',
      label: 'Harness profile',
      source: 'Runtime configuration',
      detail: `${configuration.agentPreset} preset · ${configuration.permissionMode} · ${configuration.provider}/${configuration.model}`,
      text: profileText,
      bytes: Buffer.byteLength(profileText, 'utf8'),
      enabled: true,
    }]

    const skillRefs = parseSkillRefs(input)
    if (skillRefs.length > 0) {
      const skills = await this.loadSkillCatalog()
      for (const name of skillRefs) {
        const skill = skills.find(item => item.name === name)
        if (skill === undefined) continue
        const body = await readSkillBody(skill.directory)
        layers.push({ id: `skill:${name}`, label: `Skill: ${name}`, source: skill.directory, detail: body.truncated ? 'Explicit @ reference · truncated' : 'Explicit @ reference', text: body.text, bytes: Buffer.byteLength(body.text, 'utf8'), enabled: true })
      }
    }
    for (const attachment of attachments) {
      const imagePending = attachment.kind === 'image'
      const text = imagePending ? `[Vision conversion pending for ${attachment.label}]` : attachment.text
      layers.push({ id: attachment.id, label: attachment.label, source: attachment.kind, detail: imagePending ? 'Image will be described before session.prompt' : attachment.truncated ? 'Content truncated by attachment budget' : 'Staged context attachment', text, bytes: Buffer.byteLength(text, 'utf8'), enabled: true })
    }
    if (input.trim() !== '') layers.push({ id: 'user-input', label: 'User message', source: 'Composer', detail: 'Exact current draft', text: input, bytes: Buffer.byteLength(input, 'utf8'), enabled: true })
    return {
      scope: 'Plugin preflight prompt layers',
      limitation: 'This view shows data assembled by the extension. Harness may add provider system instructions, tool schemas, preset internals, and compaction state after session.prompt; rc.7 does not expose that final provider request through Gateway.',
      layers,
    }
  }

  async renameSession(sessionId: string, title: string): Promise<void> {
    const result = await this.requireGateway().renameSession(sessionId, title)
    this.store.setSessionTitle(sessionId, result.title)
    this.publish()
  }

  private async resolveAttachments(input: string, attachments: readonly ContextAttachment[], onProgress?: (progress: WorkbenchSendProgress) => void): Promise<readonly ContextAttachment[]> {
    const output: ContextAttachment[] = []
    const skillRefs = parseSkillRefs(input)
    if (skillRefs.length > 0) {
      const skills = await this.loadSkillCatalog()
      for (const name of skillRefs) {
        const skill = skills.find(item => item.name === name)
        if (skill === undefined) {
          this.logger.warn(`Prompt references an unknown skill: @${name}`)
          continue
        }
        output.push(await this.skillAttachment(skill))
      }
    }
    for (const attachment of attachments) {
      if (attachment.kind === 'image') output.push(await this.imageAttachment(attachment, onProgress))
      else output.push(attachment)
    }
    return output
  }

  private async imageAttachment(attachment: ContextAttachment, onProgress?: (progress: WorkbenchSendProgress) => void): Promise<ContextAttachment> {
    if (attachment.truncated || attachment.image === undefined || attachment.image.dataBase64 === '') {
      throw new Error(`${attachment.label} is too large for the vision endpoint; reduce the image or raise dedgeDeepSeekHarness.vision.maxBytes.`)
    }
    const configuration = this.configuration.get()
    const apiKey = await this.credentials.getVisionApiKey()
    if (apiKey === undefined || apiKey.trim() === '') {
      throw new Error('No vision API key is stored; run the "Configure Vision API Key" command before attaching images.')
    }
    onProgress?.({ type: 'vision-start', label: attachment.label, model: configuration.visionModel })
    const description = await describeImage({
      baseUrl: configuration.visionBaseUrl,
      model: configuration.visionModel,
      reasoningEffort: configuration.visionReasoningEffort,
      apiKey,
      maxBytes: configuration.visionMaxBytes,
    }, { fileName: attachment.label, mimeType: attachment.image.mimeType, dataBase64: attachment.image.dataBase64 })
    onProgress?.({ type: 'vision-complete', label: attachment.label, model: configuration.visionModel, text: description })
    const label = attachment.label.replace(/^Image: /u, '')
    return {
      id: attachment.id,
      kind: 'vision',
      label: `Vision: ${label}`,
      text: `Vision description of ${label}:\n\n${description}`,
      ...(attachment.uri === undefined ? {} : { uri: attachment.uri }),
      truncated: false,
      visionModel: configuration.visionModel,
    }
  }

  private async skillAttachment(skill: SkillSummary): Promise<ContextAttachment> {
    const body = await readSkillBody(skill.directory)
    return {
      id: `skill:${skill.name}`,
      kind: 'skill',
      label: `Skill: ${skill.name}`,
      text: `<skill name=${JSON.stringify(skill.name)}>\n${body.text}\n</skill>`,
      skillDirectory: skill.directory,
      truncated: body.truncated,
    }
  }

  private loadSkillCatalog(): Promise<SkillSummary[]> {
    const key = JSON.stringify(this.configuration.get().skillDirectories)
    if (this.skillCatalogCache !== undefined && this.skillCatalogCache.key === key && Date.now() - this.skillCatalogCache.at < 30_000) {
      return Promise.resolve(this.skillCatalogCache.items)
    }
    const items = listSkills(this.configuration.get().skillDirectories).catch(error => {
      this.logger.warn(`Could not load the skill catalog: ${errorMessage(error)}`)
      return []
    })
    this.skillCatalogCache = { key, at: Date.now(), items }
    return items
  }

  attachHandoff(name: string, text: string): Promise<ContextAttachment> {
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
    return this.sessionOperations.run(sessionId, 'compacting', async () => {
      let result: Awaited<ReturnType<GatewayClient['executeCommand']>>
      try {
        result = await this.requireGateway().executeCommand(sessionId, '/compact')
      } catch (error) {
        const detail = errorMessage(error)
        if (detail.includes('commands/execute returned HTTP 404')) {
          throw new Error('This Harness runtime does not expose the manual compaction RPC. Automatic compaction remains preset-controlled; no context was changed.')
        }
        throw error
      }
      if (result.result?.kind === 'error') throw new Error(result.result.text ?? 'Harness rejected context compaction.')
      return result.result?.text ?? 'Context compaction completed.'
    })
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

  async setApprovalPolicy(policy: 'ask' | 'approve-for-me'): Promise<void> {
    await this.configuration.updateSetting('approvalPolicy', policy)
    this.store.setConfiguration(toStoreConfiguration(this.configuration.get()))
    this.publish()
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

  private async maybeGenerateSessionTitle(sessionId: string): Promise<void> {
    const snapshot = this.store.snapshot()
    const session = snapshot.sessions.find(item => item.id === sessionId)
    if (session === undefined || snapshot.activeSessionId !== sessionId || !isPlaceholderSessionTitle(session.title)) return
    const transcript = snapshot.messages
      .filter(message => message.role === 'user' || message.role === 'assistant')
      .map(message => `${message.role === 'user' ? 'User' : 'Assistant'}: ${message.text}`)
      .join('\n')
      .slice(0, 6_000)
    if (transcript.trim() === '') return
    const apiKey = await this.credentials.getApiKey()
    const configuration = this.configuration.get()
    if (apiKey?.trim() === undefined || apiKey.trim() === '' || configuration.model.trim() === '') return
    try {
      const endpoint = new URL('chat/completions', configuration.baseUrl.endsWith('/') ? configuration.baseUrl : `${configuration.baseUrl}/`)
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey.trim()}` },
        body: JSON.stringify({ model: configuration.model, messages: [
          { role: 'system', content: 'Create a concise session title. Return only 3 to 8 words, without quotes or trailing punctuation.' },
          { role: 'user', content: transcript },
        ], max_tokens: 32 }),
      })
      if (!response.ok) return
      const payload = await response.json() as { choices?: Array<{ message?: { content?: unknown } }> }
      const raw = payload.choices?.[0]?.message?.content
      if (typeof raw !== 'string') return
      const title = raw.replace(/^['"\s]+|['"\s]+$/gu, '').replace(/[.!?。！？]+$/u, '').trim().slice(0, 72)
      const current = this.store.snapshot().sessions.find(item => item.id === sessionId)
      if (title !== '' && current !== undefined && isPlaceholderSessionTitle(current.title)) await this.renameSession(sessionId, title)
    } catch (error) {
      this.logger.warn(`Could not generate a session title: ${errorMessage(error)}`)
    }
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
      if (frame.event.type === 'turn/end') {
        this.sessionOperations.finish(frame.sessionId, 'cancelling')
        void this.maybeGenerateSessionTitle(frame.sessionId)
      }
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
      if (this.configuration.get().approvalPolicy === 'approve-for-me') {
        void this.approveApprovalAutomatically(approval)
        return this.publish()
      }
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

  private async approveApprovalAutomatically(approval: PendingApproval): Promise<void> {
    try {
      const receipt = await this.requireGateway().respond(approval.rpcId, {
        sessionId: approval.sessionId,
        approvalId: approval.id,
        outcome: 'allowed-once',
      })
      if (!receipt.accepted) this.logger.warn(`Harness did not accept automatic approval for ${approval.toolName}.`)
    } catch (error) {
      this.logger.error(`Automatic approval failed for ${approval.toolName}`, error)
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

function toStoreConfiguration(configuration: HarnessConfiguration): { provider: string; model: string; reasoningEffort: string; agentPreset: string; permissionMode: string; approvalPolicy: string; contextWindowTokens: number; pasteFileThreshold: number } {
  return {
    provider: configuration.provider,
    model: configuration.model,
    reasoningEffort: configuration.reasoningEffort,
    agentPreset: configuration.agentPreset,
    permissionMode: configuration.permissionMode,
    approvalPolicy: configuration.approvalPolicy ?? 'ask',
    contextWindowTokens: configuration.contextWindowTokens,
    pasteFileThreshold: configuration.pasteFileThreshold,
  }
}

function isPlaceholderSessionTitle(title: string): boolean {
  return /^session-(?:[0-9a-f]+)?$/iu.test(title) || title === 'New session'
}

function conversationUnitCount(messages: WorkbenchSnapshot['messages']): number {
  const units = new Set<string>()
  for (const message of messages) units.add(message.taskId === undefined ? `message:${message.id}` : `task:${message.taskId}`)
  return units.size
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

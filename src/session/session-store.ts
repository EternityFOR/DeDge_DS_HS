import { isRecord, type ContextPressureProjection, type HistoryEntry, type ModelCatalog, type PermissionProjection, type PresetCatalog, type SessionEvent, type SessionSummary } from '../gateway/protocol.js'
import type { RuntimeState } from '../runtime/types.js'
import type { PendingApproval, PendingQuestion, SessionOperation, WorkbenchMessage, WorkbenchPhase, WorkbenchSession, WorkbenchSnapshot } from './types.js'
import { projectUserPrompt } from './prompt-projection.js'

export interface StoreConfiguration {
  readonly provider: string
  readonly model: string
  readonly reasoningEffort: string
  readonly agentPreset: string
  readonly permissionMode: string
  readonly contextWindowTokens: number
}

export class SessionStore {
  private phase: WorkbenchPhase = 'idle'
  private runtime: RuntimeState = { phase: 'idle' }
  private hasApiKey = false
  private error: string | undefined
  private activeSessionId: string | undefined
  private readonly sessions = new Map<string, SessionSummary>()
  private readonly archivedSessionIds = new Set<string>()
  private readonly events = new Map<string, Map<number, HistoryEntry>>()
  private readonly approvals = new Map<string, PendingApproval>()
  private readonly questions = new Map<string, PendingQuestion>()
  private modelCatalog: { readonly sessionId: string; readonly value: ModelCatalog } | undefined
  private presetCatalog: PresetCatalog | undefined
  private readonly contextPressure = new Map<string, ContextPressureProjection>()
  private readonly permissions = new Map<string, PermissionProjection>()
  private permissionChanging = false
  private readonly sessionOperations = new Map<string, SessionOperation>()
  private configuration: StoreConfiguration

  constructor(configuration: StoreConfiguration) {
    this.configuration = configuration
  }

  setConfiguration(configuration: StoreConfiguration): void {
    this.configuration = configuration
  }

  resetConnectionState(): void {
    this.approvals.clear()
    this.questions.clear()
    this.modelCatalog = undefined
    this.presetCatalog = undefined
    this.contextPressure.clear()
    this.permissions.clear()
  }

  clearPendingInteractions(): void {
    this.approvals.clear()
    this.questions.clear()
  }

  setCredentials(hasApiKey: boolean): void {
    this.hasApiKey = hasApiKey
  }

  setRuntime(runtime: RuntimeState): void {
    this.runtime = runtime
    if (runtime.phase === 'error') this.setError(runtime.error ?? 'Harness runtime failed.')
    else if (runtime.phase === 'idle' && this.phase !== 'error') this.phase = 'idle'
  }

  setPhase(phase: WorkbenchPhase, error?: string): void {
    this.phase = phase
    this.error = error
  }

  setError(message: string): void {
    this.phase = 'error'
    this.error = message
  }

  replaceSessions(items: readonly SessionSummary[]): void {
    this.sessions.clear()
    for (const item of items) this.sessions.set(item.sessionId, item)
  }

  replaceArchivedSessions(sessionIds: readonly string[]): void {
    this.archivedSessionIds.clear()
    for (const sessionId of sessionIds) this.archivedSessionIds.add(sessionId)
    if (this.activeSessionId !== undefined && this.archivedSessionIds.has(this.activeSessionId)) this.activeSessionId = undefined
  }

  addSession(item: SessionSummary): void {
    this.sessions.set(item.sessionId, { ...this.sessions.get(item.sessionId), ...item })
  }

  removeSession(sessionId: string): void {
    this.sessions.delete(sessionId)
    this.archivedSessionIds.delete(sessionId)
    this.events.delete(sessionId)
    this.contextPressure.delete(sessionId)
    this.sessionOperations.delete(sessionId)
    if (this.activeSessionId === sessionId) this.activeSessionId = undefined
  }

  setRunning(sessionId: string, running: boolean): void {
    const current = this.sessions.get(sessionId)
    if (current !== undefined) this.sessions.set(sessionId, { ...current, running })
  }

  setSessionOperation(sessionId: string, operation: SessionOperation | undefined): void {
    if (operation === undefined) this.sessionOperations.delete(sessionId)
    else this.sessionOperations.set(sessionId, operation)
  }

  setActive(sessionId: string | undefined): void {
    this.activeSessionId = sessionId
  }

  setModelCatalog(sessionId: string, catalog: ModelCatalog): void {
    this.modelCatalog = { sessionId, value: catalog }
  }

  setPresetCatalog(catalog: PresetCatalog): void {
    this.presetCatalog = catalog
  }

  setSessionTitle(sessionId: string, title: string): void {
    const current = this.sessions.get(sessionId)
    if (current !== undefined) this.sessions.set(sessionId, { ...current, title })
  }

  setAgentPreset(sessionId: string, agentPreset: string): void {
    const current = this.sessions.get(sessionId)
    if (current !== undefined) this.sessions.set(sessionId, { ...current, agentPreset })
  }

  setContextPressure(sessionId: string, value: ContextPressureProjection | undefined): void {
    if (value === undefined) this.contextPressure.delete(sessionId)
    else this.contextPressure.set(sessionId, value)
  }

  setPermissions(sessionId: string, value: PermissionProjection | undefined): void {
    if (value === undefined) this.permissions.delete(sessionId)
    else this.permissions.set(sessionId, value)
  }

  setPermissionChanging(value: boolean): void {
    this.permissionChanging = value
  }

  replaceHistory(sessionId: string, entries: readonly HistoryEntry[]): void {
    const bySeq = new Map<number, HistoryEntry>()
    for (const entry of entries) bySeq.set(entry.event.seq, entry)
    this.events.set(sessionId, bySeq)
    this.applySessionMetadata(sessionId, entries.map(entry => entry.event))
  }

  appendEvent(sessionId: string, event: SessionEvent, view?: unknown): void {
    const bySeq = this.events.get(sessionId) ?? new Map<number, HistoryEntry>()
    bySeq.set(event.seq, { event, ...(view === undefined ? {} : { view }) })
    this.events.set(sessionId, bySeq)
    this.applySessionMetadata(sessionId, [event])
  }

  addApproval(approval: PendingApproval): void {
    this.approvals.set(approval.id, approval)
  }

  resolveApproval(id: string): void {
    this.approvals.delete(id)
  }

  addQuestions(questions: readonly PendingQuestion[]): void {
    for (const question of questions) this.questions.set(questionKey(question.rpcId, question.id), question)
  }

  resolveQuestions(rpcId: string): void {
    for (const [id, question] of this.questions) {
      if (question.rpcId === rpcId) this.questions.delete(id)
    }
  }

  snapshot(): WorkbenchSnapshot {
    const sessions = [...this.sessions.values()]
      .filter(session => !this.archivedSessionIds.has(session.sessionId))
      .sort((left, right) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0))
      .map(session => toWorkbenchSession(session, this.sessionOperations.get(session.sessionId)))
    const activeEvents = this.activeSessionId === undefined
      ? []
      : [...(this.events.get(this.activeSessionId)?.values() ?? [])].sort((left, right) => left.event.seq - right.event.seq)
    const modelCatalog = this.modelCatalog
    const activeModelCatalog = modelCatalog !== undefined && modelCatalog.sessionId === this.activeSessionId ? modelCatalog.value : undefined
    const currentModel = activeModelCatalog?.current
    const activeSession = this.activeSessionId === undefined ? undefined : this.sessions.get(this.activeSessionId)
    const activeContextPressure = this.activeSessionId === undefined ? undefined : this.contextPressure.get(this.activeSessionId)
    const activePermissions = this.activeSessionId === undefined ? undefined : this.permissions.get(this.activeSessionId)
    return {
      phase: this.phase,
      runtime: this.runtime,
      hasApiKey: this.hasApiKey,
      sessions,
      ...(this.activeSessionId === undefined ? {} : { activeSessionId: this.activeSessionId }),
      messages: projectMessages(activeEvents),
      approvals: [...this.approvals.values()].filter(item => item.sessionId === this.activeSessionId),
      questions: [...this.questions.values()].filter(item => item.sessionId === this.activeSessionId),
      ...this.configuration,
      permissionMode: activePermissions?.currentValue ?? this.configuration.permissionMode,
      ...(activePermissions === undefined ? {} : { permissionOptions: activePermissions.options }),
      permissionChanging: this.permissionChanging,
      provider: currentModel?.provider ?? this.configuration.provider,
      model: currentModel?.model ?? this.configuration.model,
      reasoningEffort: activeModelCatalog === undefined ? this.configuration.reasoningEffort : currentModel?.reasoningEffort ?? '',
      agentPreset: activeSession?.agentPreset ?? this.configuration.agentPreset,
      ...(activeContextPressure === undefined ? {} : { contextPressure: activeContextPressure }),
      ...(activeModelCatalog === undefined ? {} : { modelCatalog: activeModelCatalog }),
      ...(this.presetCatalog === undefined ? {} : { presetCatalog: this.presetCatalog }),
      ...(this.error === undefined ? {} : { error: this.error }),
    }
  }

  private applySessionMetadata(sessionId: string, events: readonly SessionEvent[]): void {
    let summary = this.sessions.get(sessionId) ?? { sessionId }
    for (const event of events) {
      if (event.type === 'session/title' && isRecord(event.data) && typeof event.data.title === 'string') {
        summary = { ...summary, title: event.data.title, updatedAt: event.time }
      }
      if (event.type === 'turn/start') summary = { ...summary, running: true, blank: false, updatedAt: event.time }
      if (event.type === 'turn/end') summary = { ...summary, running: false, updatedAt: event.time }
    }
    this.sessions.set(sessionId, summary)
  }
}

function questionKey(rpcId: string, questionId: string): string {
  return `${rpcId}\u0000${questionId}`
}

export function projectMessages(entries: readonly HistoryEntry[]): WorkbenchMessage[] {
  const output: WorkbenchMessage[] = []
  const streams = new Map<string, WorkbenchMessage>()
  const toolIndexes = new Map<string, number>()

  for (const { event } of entries) {
    const data = isRecord(event.data) ? event.data : {}
    if (event.type === 'user/message') {
      // Messages injected by plugins (system snapshots, tool notifications,
      // command echoes) are not user turns: they would otherwise show as
      // "You" and break turn folding boundaries.
      const source = isRecord(data.source) ? data.source : undefined
      if (source !== undefined && source.kind !== 'user') continue
      const rawText = contentText(data.content)
      if (rawText !== '') {
        const projected = projectUserPrompt(rawText)
        output.push({
          id: `user:${event.seq}`,
          role: 'user',
          text: projected.text,
          ...(projected.attachments.length === 0 ? {} : { attachments: projected.attachments }),
          seq: event.seq,
          time: event.time,
          status: 'complete',
        })
      }
      continue
    }
    if (event.type === 'assistant/chunk') {
      const chunk = isRecord(data.chunk) ? data.chunk : undefined
      if (chunk === undefined || typeof chunk.type !== 'string') continue
      if ((chunk.type === 'text-delta' || chunk.type === 'reasoning-delta') && typeof chunk.text === 'string') {
        const role = chunk.type === 'text-delta' ? 'assistant' : 'reasoning'
        const key = `${String(data.turn)}:${String(data.step)}:${String(chunk.index)}:${role}`
        const current = streams.get(key) ?? { id: `stream:${key}`, role, text: '', status: 'streaming', seq: event.seq, time: event.time }
        streams.set(key, { ...current, text: current.text + chunk.text, seq: event.seq })
      }
      continue
    }
    if (event.type === 'assistant/message') {
      const message = isRecord(data.message) ? data.message : undefined
      const turnPrefix = `${String(data.turn)}:${String(data.step)}:`
      for (const key of [...streams.keys()]) {
        if (key.startsWith(turnPrefix)) streams.delete(key)
      }
      const content = message?.content
      if (Array.isArray(content)) {
        let index = 0
        for (const block of content) {
          if (!isRecord(block) || typeof block.type !== 'string') continue
          if ((block.type === 'text' || block.type === 'reasoning') && typeof block.text === 'string' && block.text !== '') {
            output.push({
              id: `assistant:${event.seq}:${index++}`,
              role: block.type === 'reasoning' ? 'reasoning' : 'assistant',
              text: block.text,
              status: 'complete',
              seq: event.seq,
              time: event.time,
            })
          }
        }
      }
      continue
    }
    if (event.type === 'tool/call' && typeof data.callId === 'string') {
      const title = typeof data.name === 'string' ? data.name : 'tool'
      const text = typeof data.arguments === 'string' ? data.arguments : (JSON.stringify(data.arguments ?? {}) ?? '')
      toolIndexes.set(data.callId, output.length)
      output.push({ id: `tool:${data.callId}`, role: 'tool', title, text, status: 'streaming', seq: event.seq, time: event.time })
      continue
    }
    if (event.type === 'tool/result') {
      const message = isRecord(data.message) ? data.message : undefined
      const source = isRecord(message?.source) ? message.source : undefined
      const callId = typeof source?.callId === 'string' ? source.callId : undefined
      if (callId === undefined) continue
      const result = contentText(message?.content)
      const at = toolIndexes.get(callId)
      if (at !== undefined) {
        const current = output[at]
        if (current !== undefined) output[at] = { ...current, text: result === '' ? current.text : result, status: 'complete', seq: event.seq }
      }
      continue
    }
    if (event.type === 'turn/end' && isRecord(data.reason) && data.reason.kind === 'error') {
      const detail = isRecord(data.reason.error) && typeof data.reason.error.message === 'string' ? data.reason.error.message : 'The turn failed.'
      output.push({ id: `error:${event.seq}`, role: 'system', text: detail, status: 'error', seq: event.seq, time: event.time })
    }
  }

  output.push(...streams.values())
  return output.sort((left, right) => (left.seq ?? Number.MAX_SAFE_INTEGER) - (right.seq ?? Number.MAX_SAFE_INTEGER))
}

function toWorkbenchSession(summary: SessionSummary, operation?: SessionOperation): WorkbenchSession {
  return {
    id: summary.sessionId,
    title: summary.title ?? (summary.blank === true ? 'New session' : summary.sessionId.slice(0, 8)),
    running: summary.running === true,
    blank: summary.blank === true,
    ...(summary.updatedAt === undefined ? {} : { updatedAt: summary.updatedAt }),
    ...(summary.cwd === undefined ? {} : { cwd: summary.cwd }),
    ...(summary.agentPreset === undefined ? {} : { agentPreset: summary.agentPreset }),
    ...(operation === undefined ? {} : { operation }),
  }
}

function contentText(value: unknown): string {
  if (!Array.isArray(value)) return ''
  const parts: string[] = []
  for (const block of value) {
    if (!isRecord(block)) continue
    if (block.type === 'text' && typeof block.text === 'string') parts.push(block.text)
    if (block.type === 'tool-result' && Array.isArray(block.content)) parts.push(contentText(block.content))
  }
  return parts.join('\n')
}

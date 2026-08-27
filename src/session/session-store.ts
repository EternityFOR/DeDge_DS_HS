import { isRecord, type ContextPressureProjection, type HistoryEntry, type ModelCatalog, type PermissionProjection, type PresetCatalog, type SessionEvent, type SessionSummary } from '../gateway/protocol.js'
import type { RuntimeState } from '../runtime/types.js'
import type { PendingApproval, PendingQuestion, SessionOperation, WorkbenchJob, WorkbenchMessage, WorkbenchPhase, WorkbenchQueueItem, WorkbenchSession, WorkbenchSnapshot } from './types.js'
import { projectUserPrompt } from './prompt-projection.js'

export interface StoreConfiguration {
  readonly provider: string
  readonly model: string
  readonly reasoningEffort: string
  readonly agentPreset: string
  readonly permissionMode: string
  readonly approvalPolicy?: string
  readonly contextWindowTokens: number
  readonly pasteFileThreshold: number
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
  private readonly historyHasMore = new Map<string, boolean>()
  private readonly initialHistoryStart = new Map<string, number>()
  private readonly historyExpanded = new Map<string, boolean>()
  private readonly historyPageStarts = new Map<string, number[]>()
  private historyLoading = false
  private readonly approvals = new Map<string, PendingApproval>()
  private readonly questions = new Map<string, PendingQuestion>()
  private modelCatalog: { readonly sessionId: string; readonly value: ModelCatalog } | undefined
  private presetCatalog: PresetCatalog | undefined
  private readonly contextPressure = new Map<string, ContextPressureProjection>()
  private readonly permissions = new Map<string, PermissionProjection>()
  private readonly queueItems = new Map<string, WorkbenchQueueItem[]>()
  private readonly jobs = new Map<string, WorkbenchJob[]>()
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
    this.queueItems.clear()
    this.jobs.clear()
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
    const current = this.sessions.get(item.sessionId)
    const merged = { ...current, ...item }
    this.sessions.set(item.sessionId, current?.blank === false ? { ...merged, blank: false } : merged)
  }

  removeSession(sessionId: string): void {
    this.sessions.delete(sessionId)
    this.archivedSessionIds.delete(sessionId)
    this.events.delete(sessionId)
    this.historyHasMore.delete(sessionId)
    this.initialHistoryStart.delete(sessionId)
    this.historyExpanded.delete(sessionId)
    this.historyPageStarts.delete(sessionId)
    this.contextPressure.delete(sessionId)
    this.queueItems.delete(sessionId)
    this.jobs.delete(sessionId)
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

  setSessionQueue(sessionId: string, items: readonly unknown[]): void {
    this.queueItems.set(sessionId, items.map((item, index) => projectQueueItem(item, index)))
  }

  setSessionJobs(sessionId: string, items: readonly unknown[]): void {
    this.jobs.set(sessionId, items.map((item, index) => projectJob(item, index)))
  }

  replaceHistory(sessionId: string, entries: readonly HistoryEntry[], hasMore = false): void {
    const bySeq = new Map<number, HistoryEntry>()
    for (const entry of entries) bySeq.set(entry.event.seq, entry)
    this.events.set(sessionId, bySeq)
    this.historyHasMore.set(sessionId, hasMore)
    const firstSeq = entries.reduce<number | undefined>((minimum, entry) => minimum === undefined ? entry.event.seq : Math.min(minimum, entry.event.seq), undefined)
    if (firstSeq === undefined) this.initialHistoryStart.delete(sessionId)
    else this.initialHistoryStart.set(sessionId, firstSeq)
    this.historyExpanded.set(sessionId, false)
    this.historyPageStarts.set(sessionId, [])
    this.applySessionMetadata(sessionId, entries.map(entry => entry.event))
  }

  prependHistory(sessionId: string, entries: readonly HistoryEntry[], hasMore: boolean, trackPage = true): void {
    const bySeq = this.events.get(sessionId) ?? new Map<number, HistoryEntry>()
    const previousStart = minimumSeq(bySeq.keys())
    for (const entry of entries) bySeq.set(entry.event.seq, entry)
    this.events.set(sessionId, bySeq)
    this.historyHasMore.set(sessionId, hasMore)
    const nextStart = minimumSeq(bySeq.keys())
    if (trackPage && previousStart !== undefined && nextStart !== undefined && nextStart < previousStart) this.markHistoryPage(sessionId, previousStart)
    this.applySessionMetadata(sessionId, entries.map(entry => entry.event))
  }

  historyBeforeSeq(sessionId: string): number | undefined {
    const seqs = this.events.get(sessionId)?.keys()
    if (seqs === undefined) return undefined
    let minimum = Number.MAX_SAFE_INTEGER
    for (const seq of seqs) minimum = Math.min(minimum, seq)
    return Number.isSafeInteger(minimum) ? minimum : undefined
  }

  setHistoryLoading(value: boolean): void {
    this.historyLoading = value
  }

  hideOlderHistory(sessionId: string, all = false): void {
    const pages = this.historyPageStarts.get(sessionId) ?? []
    const bySeq = this.events.get(sessionId)
    const firstSeq = all && bySeq !== undefined ? latestTurnStart(bySeq) ?? this.initialHistoryStart.get(sessionId) : pages.pop()
    if (firstSeq === undefined || bySeq === undefined) return
    for (const seq of bySeq.keys()) if (seq < firstSeq) bySeq.delete(seq)
    this.historyHasMore.set(sessionId, true)
    if (all) {
      pages.length = 0
      this.initialHistoryStart.set(sessionId, firstSeq)
    }
    this.historyPageStarts.set(sessionId, pages)
    this.historyExpanded.set(sessionId, pages.length > 0)
  }

  markHistoryPage(sessionId: string, previousStart: number): void {
    const bySeq = this.events.get(sessionId)
    const nextStart = bySeq === undefined ? undefined : minimumSeq(bySeq.keys())
    if (nextStart === undefined || nextStart >= previousStart) return
    const pages = this.historyPageStarts.get(sessionId) ?? []
    pages.push(previousStart)
    this.historyPageStarts.set(sessionId, pages)
    this.historyExpanded.set(sessionId, true)
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
      .sort((left, right) => {
        // Keep the one-click blank workspace at the far left; persisted work follows newest first.
        const leftBlank = left.blank === true
        const rightBlank = right.blank === true
        if (leftBlank !== rightBlank) return leftBlank ? -1 : 1
        return (right.updatedAt ?? 0) - (left.updatedAt ?? 0)
      })
      .map(session => toWorkbenchSession(session, this.sessionOperations.get(session.sessionId)))
    const activeEvents = this.activeSessionId === undefined
      ? []
      : [...(this.events.get(this.activeSessionId)?.values() ?? [])].sort((left, right) => left.event.seq - right.event.seq)
    const messages = projectMessages(activeEvents)
    const modelCatalog = this.modelCatalog
    const activeModelCatalog = modelCatalog !== undefined && modelCatalog.sessionId === this.activeSessionId ? modelCatalog.value : undefined
    const currentModel = activeModelCatalog?.current
    const activeSession = this.activeSessionId === undefined ? undefined : this.sessions.get(this.activeSessionId)
    const activeContextPressure = this.activeSessionId === undefined ? undefined : this.contextPressure.get(this.activeSessionId)
    const activePermissions = this.activeSessionId === undefined ? undefined : this.permissions.get(this.activeSessionId)
    const activeQueue = this.activeSessionId === undefined ? undefined : this.queueItems.get(this.activeSessionId)
    const activeJobs = this.activeSessionId === undefined ? undefined : this.jobs.get(this.activeSessionId)
    return {
      phase: this.phase,
      runtime: this.runtime,
      hasApiKey: this.hasApiKey,
      sessions,
      ...(this.activeSessionId === undefined ? {} : { activeSessionId: this.activeSessionId }),
      messages,
      ...(activeQueue === undefined ? {} : { queueItems: activeQueue }),
      ...(activeJobs === undefined ? {} : { jobs: activeJobs }),
      hasMoreHistory: this.activeSessionId === undefined ? false : (this.historyHasMore.get(this.activeSessionId) ?? false),
      historyExpanded: this.activeSessionId === undefined ? false : (this.historyExpanded.get(this.activeSessionId) ?? false),
      historyPageCount: this.activeSessionId === undefined ? 0 : (this.historyPageStarts.get(this.activeSessionId)?.length ?? 0),
      historyCanHideAll: conversationUnitCount(messages) > 1,
      historyLoading: this.historyLoading,
      approvals: [...this.approvals.values()].filter(item => item.sessionId === this.activeSessionId),
      questions: [...this.questions.values()].filter(item => item.sessionId === this.activeSessionId),
      ...this.configuration,
      permissionMode: activePermissions?.currentValue ?? this.configuration.permissionMode,
      approvalPolicy: this.configuration.approvalPolicy ?? 'ask',
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

function minimumSeq(values: Iterable<number>): number | undefined {
  let minimum: number | undefined
  for (const value of values) minimum = minimum === undefined ? value : Math.min(minimum, value)
  return minimum
}

function latestTurnStart(entries: ReadonlyMap<number, HistoryEntry>): number | undefined {
  let latest: number | undefined
  for (const entry of entries.values()) if (entry.event.type === 'turn/start') latest = latest === undefined ? entry.event.seq : Math.max(latest, entry.event.seq)
  return latest
}

function conversationUnitCount(messages: readonly WorkbenchMessage[]): number {
  const units = new Set<string>()
  for (const message of messages) units.add(message.taskId === undefined ? `message:${message.id}` : `task:${message.taskId}`)
  return units.size
}

export function projectMessages(entries: readonly HistoryEntry[]): WorkbenchMessage[] {
  const output: WorkbenchMessage[] = []
  const interruptedTurns = new Set<string>()
  const streams = new Map<string, { id: string; role: 'assistant' | 'reasoning'; chunks: string[]; seq: number; time: number; turn: string }>()
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
        const turn = String(data.turn)
        const current = streams.get(key) ?? { id: `stream:${key}`, role, chunks: [], seq: event.seq, time: event.time, turn }
        current.chunks.push(chunk.text)
        current.seq = event.seq
        streams.set(key, current)
      }
      continue
    }
    if (event.type === 'assistant/message') {
      const message = isRecord(data.message) ? data.message : undefined
      const turnPrefix = `${String(data.turn)}:${String(data.step)}:`
      const interrupted = message?.interrupted === true || data.interrupted === true
      if (interrupted) interruptedTurns.add(String(data.turn))
      for (const key of [...streams.keys()]) {
        if (key.startsWith(turnPrefix)) streams.delete(key)
      }
      const content = message?.content
      if (Array.isArray(content)) {
        let index = 0
        for (const block of content) {
          if (!isRecord(block) || typeof block.type !== 'string') continue
          if ((block.type === 'text' || block.type === 'reasoning') && typeof block.text === 'string' && block.text !== '') {
            const projected = projectVerboseText(block.text, block.type === 'reasoning' ? 65_536 : Number.MAX_SAFE_INTEGER)
            output.push({
              id: `assistant:${event.seq}:${index++}`,
              role: block.type === 'reasoning' ? 'reasoning' : 'assistant',
              text: projected.text,
              ...(projected.textLength === undefined ? {} : { textLength: projected.textLength }),
              ...(interrupted ? { taskInterrupted: true } : {}),
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
        if (current !== undefined) {
          const projected = projectVerboseText(result === '' ? current.text : result, 65_536)
          output[at] = { ...current, text: projected.text, ...(projected.textLength === undefined ? {} : { textLength: projected.textLength }), status: 'complete', seq: event.seq }
        }
      }
      continue
    }
    if (event.type === 'turn/end' && isRecord(data.reason) && data.reason.kind === 'error') {
      const detail = isRecord(data.reason.error) && typeof data.reason.error.message === 'string' ? data.reason.error.message : 'The turn failed.'
      output.push({ id: `error:${event.seq}`, role: 'system', text: detail, status: 'error', seq: event.seq, time: event.time })
    }
  }

  output.push(...[...streams.values()].map(stream => {
    const projected = projectVerboseText(stream.chunks.join(''), 32_768)
    return {
      id: stream.id,
      role: stream.role,
      text: projected.text,
      ...(projected.textLength === undefined ? {} : { textLength: projected.textLength }),
      ...(interruptedTurns.has(stream.turn) ? { taskInterrupted: true } : {}),
      status: 'streaming' as const,
      seq: stream.seq,
      time: stream.time,
    }
  }))
  const sorted = output.sort((left, right) => (left.seq ?? Number.MAX_SAFE_INTEGER) - (right.seq ?? Number.MAX_SAFE_INTEGER))
  return annotateTaskGroups(sorted, entries)
}

function projectVerboseText(value: string, maxChars: number): { readonly text: string; readonly textLength?: number } {
  if (value.length <= maxChars) return { text: value }
  return {
    text: `[Earlier output hidden from the workbench to keep it responsive; the complete event remains in Harness session data.]\n\n${value.slice(-maxChars)}`,
    textLength: value.length,
  }
}

function annotateTaskGroups(messages: readonly WorkbenchMessage[], entries: readonly HistoryEntry[]): WorkbenchMessage[] {
  type TaskGroup = { readonly id: string; readonly turn?: string; readonly from: number; to: number; complete: boolean; interrupted: boolean }
  type TurnRange = { readonly turn: string; from: number; to: number; complete: boolean; interrupted: boolean; eventCount: number; hasWorkEvent: boolean; hasNonAssistantWork: boolean; stepKeys: string[] }
  const groups: TaskGroup[] = []
  const explicitByTurn = new Map<string, TaskGroup>()
  const turnRanges = new Map<string, TurnRange>()
  let previousEnd = -1
  let active: TaskGroup | undefined
  for (const { event } of entries) {
    const turn = eventTurnKey(event)
    if (turn !== undefined) {
      const range = turnRanges.get(turn)
      if (range === undefined) turnRanges.set(turn, {
        turn,
        from: event.seq,
        to: event.seq,
        complete: event.type === 'turn/end',
        interrupted: eventIndicatesInterruption(event),
        eventCount: 1,
        hasWorkEvent: isTurnWorkEvent(event),
        hasNonAssistantWork: isTurnNonAssistantWorkEvent(event),
        stepKeys: eventStepKey(event) === undefined ? [] : [eventStepKey(event) as string],
      })
      else {
        range.from = Math.min(range.from, event.seq)
        range.to = Math.max(range.to, event.seq)
        range.complete = range.complete || event.type === 'turn/end'
        range.interrupted = range.interrupted || eventIndicatesInterruption(event)
        range.eventCount += 1
        range.hasWorkEvent = range.hasWorkEvent || isTurnWorkEvent(event)
        range.hasNonAssistantWork = range.hasNonAssistantWork || isTurnNonAssistantWorkEvent(event)
        const step = eventStepKey(event)
        if (step !== undefined && !range.stepKeys.includes(step)) range.stepKeys.push(step)
      }
    }
    if (event.type === 'turn/start') {
      const id = turn === undefined ? `turn:${String(event.seq)}` : `turn:${turn}`
      active = { id, ...(turn === undefined ? {} : { turn }), from: previousEnd + 1, to: Number.MAX_SAFE_INTEGER, complete: false, interrupted: false }
      groups.push(active)
      if (turn !== undefined) explicitByTurn.set(turn, active)
    } else if (event.type === 'turn/end' && active !== undefined) {
      active.to = event.seq
      active.complete = true
      if (eventIndicatesInterruption(event)) active.interrupted = true
      previousEnd = event.seq
      active = undefined
    } else if (active !== undefined && eventIndicatesInterruption(event)) {
      // Harness reports a user cancellation on assistant/message (and on some
      // runtime versions only on turn/end). Treat that task as settled so it
      // can be folded, while retaining the fact that it did not finish normally.
      active.interrupted = true
      active.complete = true
    }
  }
  // The Harness history endpoint can start in the middle of a turn and omit
  // its turn/start event. Recover a foldable group from the turn metadata on
  // assistant, tool, and step events. The ID is turn-based so it converges to
  // the same group when an earlier page later supplies the official boundary.
  const syntheticRanges = [...turnRanges.values()].sort((left, right) => left.from - right.from)
  for (let index = 0; index < syntheticRanges.length; index += 1) {
    const range = syntheticRanges[index]
    if (range === undefined) continue
    const nextRange = syntheticRanges[index + 1]
    if (explicitByTurn.has(range.turn)) continue
    // A short, otherwise complete event slice can carry turn metadata without
    // being a truncated task. Only synthesize a group when the page visibly
    // starts in non-user work and contains enough work events to fold.
    if (!range.hasWorkEvent || range.eventCount < 2 || (!range.hasNonAssistantWork && range.stepKeys.length < 2) || hasLeadingUserMessage(entries, range, syntheticRanges)) continue
    const overlapsExplicit = groups.some(group => group.from <= range.to && group.to >= range.from)
    if (overlapsExplicit) continue
    groups.push({
      id: `turn:${range.turn}`,
      turn: range.turn,
      from: range.from,
      to: range.complete ? range.to : Math.min(range.to, nextRange === undefined ? Number.MAX_SAFE_INTEGER : nextRange.from - 1),
      complete: range.complete,
      interrupted: range.interrupted,
    })
  }
  groups.sort((left, right) => left.from - right.from)
  if (groups.length === 0) return [...messages]
  const groupCounts = new Map(groups.map(group => [group.id, messages.filter(message => message.seq !== undefined && message.seq >= group.from && message.seq <= group.to).length]))
  return messages.map(message => {
    const seq = message.seq
    if (seq === undefined) return message
    const group = groups.find(candidate => seq >= candidate.from && seq <= candidate.to)
    if (group === undefined || (groupCounts.get(group.id) ?? 0) < 2) return message
    return {
      ...message,
      taskId: group.id,
      taskComplete: group.complete,
      ...(group.interrupted ? { taskInterrupted: true } : {}),
    }
  })
}

function eventTurnKey(event: SessionEvent): string | undefined {
  const data = isRecord(event.data) ? event.data : {}
  const turn = data.turn
  if (typeof turn === 'string' && turn.trim() !== '') return turn
  if (typeof turn === 'number' && Number.isSafeInteger(turn)) return String(turn)
  return undefined
}

function isTurnWorkEvent(event: SessionEvent): boolean {
  return event.type === 'assistant/chunk' || event.type === 'assistant/message' || event.type === 'tool/call' || event.type === 'tool/result' || event.type === 'step/start' || event.type === 'step/end'
}

function isTurnNonAssistantWorkEvent(event: SessionEvent): boolean {
  return event.type === 'tool/call' || event.type === 'tool/result' || event.type === 'step/start' || event.type === 'step/end'
}

function eventStepKey(event: SessionEvent): string | undefined {
  const data = isRecord(event.data) ? event.data : {}
  const step = data.step
  if (typeof step === 'string' && step.trim() !== '') return step
  if (typeof step === 'number' && Number.isSafeInteger(step)) return String(step)
  return undefined
}

function isVisibleUserMessage(event: SessionEvent): boolean {
  if (event.type !== 'user/message') return false
  const data = isRecord(event.data) ? event.data : {}
  const source = isRecord(data.source) ? data.source : undefined
  return source === undefined || source.kind === 'user'
}

function hasLeadingUserMessage(entries: readonly HistoryEntry[], range: { readonly from: number }, ranges: readonly { readonly from: number; readonly to: number }[]): boolean {
  const previousTurnEnd = ranges
    .filter(candidate => candidate.to < range.from)
    .reduce((latest, candidate) => Math.max(latest, candidate.to), -1)
  return entries.some(entry => entry.event.seq > previousTurnEnd && entry.event.seq < range.from && isVisibleUserMessage(entry.event))
}

function eventIndicatesInterruption(event: SessionEvent): boolean {
  const data = isRecord(event.data) ? event.data : {}
  if (event.type === 'assistant/message') {
    const message = isRecord(data.message) ? data.message : undefined
    return message?.interrupted === true || data.interrupted === true
  }
  if (event.type !== 'turn/end') return false
  const reason = isRecord(data.reason) ? data.reason : undefined
  const kind = typeof reason?.kind === 'string' ? reason.kind.toLowerCase() : ''
  return kind === 'cancel' || kind === 'cancelled' || kind === 'canceled' || kind === 'cancelled_by_user' || kind === 'canceled_by_user' || kind === 'interrupted' || kind === 'interrupt' || kind === 'stopped' || kind === 'aborted'
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

function projectQueueItem(value: unknown, index: number): WorkbenchQueueItem {
  if (!isRecord(value)) return { id: `queue:${String(index)}`, placement: 'context' }
  const id = typeof value.id === 'string' && value.id !== '' ? value.id : `queue:${String(index)}`
  const placement = value.placement === 'queued' || value.placement === 'steering' || value.placement === 'context'
    ? value.placement
    : 'context'
  const message = isRecord(value.message) ? value.message : undefined
  const source = message !== undefined && isRecord(message.source) ? message.source : undefined
  const sourceKind = source !== undefined && typeof source.kind === 'string' ? source.kind : undefined
  const content = message?.content
  const projected = projectQueueContent(content)
  return {
    id,
    placement,
    ...(sourceKind === undefined ? {} : { sourceKind }),
    ...(projected.text === undefined ? {} : { text: projected.text }),
    ...(projected.preview === undefined ? {} : { preview: projected.preview }),
    ...(projected.hasNonText ? { hasNonText: true } : {}),
  }
}

function projectQueueContent(value: unknown): { readonly text?: string; readonly preview?: string; readonly hasNonText?: boolean } {
  if (!Array.isArray(value)) return {}
  const textParts: string[] = []
  const previewParts: string[] = []
  let hasNonText = false
  for (const block of value) {
    if (isRecord(block) && block.type === 'text' && typeof block.text === 'string') {
      textParts.push(block.text)
      previewParts.push(block.text)
      continue
    }
    hasNonText = true
    const type = isRecord(block) && typeof block.type === 'string' ? block.type : 'attachment'
    previewParts.push(`[${type}]`)
  }
  const text = textParts.join('')
  const preview = previewParts.join(' ').replace(/\s+/gu, ' ').trim()
  return {
    ...(text === '' ? {} : { text }),
    ...(preview === '' ? {} : { preview: preview.length > 200 ? `${preview.slice(0, 197).trimEnd()}...` : preview }),
    ...(hasNonText ? { hasNonText: true } : {}),
  }
}

function projectJob(value: unknown, index: number): WorkbenchJob {
  if (!isRecord(value)) return { id: `job:${String(index)}`, kind: 'agent', label: 'Background agent task', status: 'running' }
  const id = typeof value.id === 'string' && value.id !== '' ? value.id : `job:${String(index)}`
  const kind = typeof value.kind === 'string' && value.kind !== '' ? value.kind : 'agent'
  const label = typeof value.label === 'string' && value.label !== '' ? value.label : 'Background agent task'
  const knownStatuses = new Set(['running', 'stopping', 'completed', 'killed', 'failed'])
  const status = typeof value.status === 'string' && knownStatuses.has(value.status) ? value.status : 'running'
  return { id, kind, label, status }
}

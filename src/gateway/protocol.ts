export interface RpcError {
  readonly code: string
  readonly message: string
  readonly details?: unknown
}

export interface ServerResponse {
  readonly type: 'server-response'
  readonly rpcId: string
  readonly result: { readonly ok: true; readonly value: unknown } | { readonly ok: false; readonly error: RpcError }
}

export interface ServerRequest {
  readonly type: 'server-request'
  readonly rpcId: string
  readonly payload: unknown
}

export interface SessionEvent {
  readonly type: string
  readonly seq: number
  readonly time: number
  readonly data: unknown
  readonly view?: unknown
}

export interface SessionSummary {
  readonly sessionId: string
  readonly updatedAt?: number
  readonly running?: boolean
  readonly blank?: boolean
  readonly cwd?: string
  readonly title?: string
  readonly agentPreset?: string
  readonly parentSessionId?: string
  readonly origin?: 'subagent'
  readonly projections?: { readonly values?: Record<string, unknown> }
}

export interface HistoryEntry {
  readonly event: SessionEvent
  readonly view?: unknown
}

export interface HostDescription {
  readonly version?: string
  readonly cwd?: string
  readonly provider?: string
  readonly model?: string
  readonly attachedSessions?: number
}

export interface SessionHistory {
  readonly events: HistoryEntry[]
  readonly hasMore?: boolean
  readonly projections?: { readonly values?: Record<string, unknown> }
}

/**
 * Expand alpha.3's bounded history records into the event shape consumed by
 * the workbench store. The upstream transport packs consecutive assistant
 * deltas into chunk rows; expanding at this boundary keeps the rest of the
 * extension compatible with the durable event projection it already uses.
 */
export function expandHistoryRecords(records: readonly unknown[]): HistoryEntry[] {
  const output: HistoryEntry[] = []
  for (const record of records) {
    if (!isRecord(record)) continue
    if (record.type === 'event' && isRecord(record.event)) {
      const event = normalizeSessionEvent(record.event)
      if (event !== undefined) output.push({ event, ...(record.view === undefined ? {} : { view: record.view }) })
      continue
    }
    if (record.type === 'chunks' && isRecord(record.event)) {
      output.push(...expandChunkRow(record.event).map(event => ({ event })))
      continue
    }
    // Retain the pre-alpha3 shape for explicitly configured legacy runtimes.
    const event = normalizeSessionEvent(record)
    if (event !== undefined) output.push({ event })
  }
  return output
}

export interface ImageAttachmentRef {
  readonly attachmentId: string
  readonly mediaType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'
  readonly bytes: number
  readonly width: number
  readonly height: number
  readonly name?: string
}

export interface SessionAttachment {
  readonly attachment: ImageAttachmentRef
  /** Canonical base64 image bytes returned by the authenticated Gateway. */
  readonly data: string
}

export interface ModelSelection {
  readonly provider: string
  readonly model: string
  readonly reasoningEffort?: string
}

export interface ModelReasoningEffort {
  readonly id: string
  readonly name: string
  readonly description?: string
}

export interface ModelCatalogModel {
  readonly id: string
  readonly name: string
  readonly description?: string
  readonly reasoning?: {
    readonly efforts: readonly ModelReasoningEffort[]
    readonly defaultEffort?: string
  }
}

export interface ModelProviderGroup {
  readonly id: string
  readonly name: string
  readonly models: readonly ModelCatalogModel[]
}

export interface ModelCatalog {
  readonly current: ModelSelection
  readonly routable: boolean
  readonly groups: readonly ModelProviderGroup[]
  readonly failures: readonly { readonly id: string; readonly name: string; readonly message: string }[]
}

export interface PresetCatalogEntry {
  readonly id: string
  readonly trust: 'system' | 'user'
  readonly isDefault: boolean
  readonly name?: string
  readonly description?: string
  readonly broken?: string
}

export interface PresetCatalog {
  readonly presets: readonly PresetCatalogEntry[]
  readonly authorable: boolean
  readonly hasDocument: boolean
}

export interface ContextPressureProjection {
  readonly pressureTokens?: number
  readonly projectedTokens?: number
  readonly contextWindow?: number
}

export interface PermissionProjection {
  readonly options: readonly { readonly value: string; readonly name: string; readonly description?: string }[]
  readonly currentValue: string
}

export interface WorkspaceRegistry {
  readonly archivedSessionIds: readonly string[]
}

export type MuxFrame =
  | { readonly type: 'session/event'; readonly sessionId: string; readonly event: SessionEvent; readonly view?: unknown }
  | { readonly type: 'session/subscribed'; readonly sessionId: string; readonly lastSeq: number }
  | { readonly type: 'approval/requested'; readonly sessionId: string; readonly approvalId: string; readonly toolName: string; readonly callId?: string; readonly reason?: string }
  | { readonly type: 'approval/resolved'; readonly sessionId: string; readonly approvalId: string; readonly outcome: string }
  | { readonly type: 'question/requested'; readonly sessionId: string; readonly questions: readonly QuestionItem[] }
  | { readonly type: 'question/resolved'; readonly sessionId: string; readonly questionRpcId: string; readonly outcome: string }
  | { readonly type: 'session/queue'; readonly sessionId: string; readonly items: readonly unknown[] }
  | { readonly type: 'session/jobs'; readonly sessionId: string; readonly jobs: readonly unknown[] }
  | { readonly type: 'session/projection'; readonly sessionId: string; readonly key: string; readonly value: unknown; readonly seq: number }
  | { readonly type: 'stream/error'; readonly error: RpcError }

export type HostFrame =
  | { readonly type: 'host/session-added'; readonly sessionId: string; readonly cwd?: string; readonly agentPreset?: string }
  | { readonly type: 'host/session-removed'; readonly sessionId: string }
  | { readonly type: 'host/session-status'; readonly sessionId: string; readonly running: boolean }
  | { readonly type: 'host/archived-sessions-changed'; readonly archivedSessionIds: readonly string[] }
  | { readonly type: 'host/agent-error'; readonly sessionId: string; readonly message: string }
  | { readonly type: 'host/remote-event'; readonly event: string; readonly args: unknown[] }
  | { readonly type: 'stream/error'; readonly error: RpcError }

export interface QuestionItem {
  readonly id: string
  readonly question: string
  readonly header?: string
  readonly detail?: string
  readonly options?: readonly { readonly label: string; readonly description?: string }[]
  readonly multiSelect?: boolean
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function parseServerResponse(value: unknown): ServerResponse {
  if (!isRecord(value) || value.type !== 'server-response' || typeof value.rpcId !== 'string' || !isRecord(value.result)) {
    throw new Error('Malformed Harness RPC response.')
  }
  const result = value.result
  if (result.ok === true && 'value' in result) return { type: 'server-response', rpcId: value.rpcId, result: { ok: true, value: result.value } }
  if (result.ok === false && isRecord(result.error) && typeof result.error.code === 'string' && typeof result.error.message === 'string') {
    return {
      type: 'server-response',
      rpcId: value.rpcId,
      result: {
        ok: false,
        error: {
          code: result.error.code,
          message: result.error.message,
          ...(result.error.details === undefined ? {} : { details: result.error.details }),
        },
      },
    }
  }
  throw new Error('Malformed Harness RPC result.')
}

export function parseServerRequest(value: unknown): ServerRequest {
  if (!isRecord(value) || value.type !== 'server-request' || typeof value.rpcId !== 'string') throw new Error('Malformed Harness event envelope.')
  return { type: 'server-request', rpcId: value.rpcId, payload: value.payload }
}

export function parsePermissionProjection(value: unknown): PermissionProjection | undefined {
  if (!isRecord(value) || typeof value.currentValue !== 'string' || !Array.isArray(value.options)) return undefined
  const options: { value: string; name: string; description?: string }[] = []
  for (const option of value.options) {
    if (!isRecord(option) || typeof option.value !== 'string' || typeof option.name !== 'string') return undefined
    options.push({
      value: option.value,
      name: option.name,
      ...(typeof option.description === 'string' ? { description: option.description } : {}),
    })
  }
  if (options.length === 0) return undefined
  return { options, currentValue: value.currentValue }
}

export function parseMuxFrame(value: unknown): MuxFrame {
  if (!isRecord(value) || typeof value.type !== 'string') throw new Error('Malformed Harness mux frame.')
  const type = value.type
  if (type === 'session/event' && typeof value.sessionId === 'string') {
    const event = parseSessionEvent(value.event)
    return {
      type,
      sessionId: value.sessionId,
      event,
      ...(value.view === undefined ? {} : { view: value.view }),
    }
  }
  if (type === 'session/status' && typeof value.sessionId === 'string' && typeof value.running === 'boolean') {
    return { type: 'session/projection', sessionId: value.sessionId, key: 'status', value: { running: value.running }, seq: Number(value.seq ?? 0) }
  }
  if (type === 'session/subscribed' && typeof value.sessionId === 'string' && typeof value.lastSeq === 'number') return { type, sessionId: value.sessionId, lastSeq: value.lastSeq }
  if (type === 'approval/requested' && typeof value.sessionId === 'string' && typeof value.approvalId === 'string' && typeof value.toolName === 'string') {
    const callId = stringOrUndefined(value.callId)
    const reason = stringOrUndefined(value.reason)
    return {
      type,
      sessionId: value.sessionId,
      approvalId: value.approvalId,
      toolName: value.toolName,
      ...(callId === undefined ? {} : { callId }),
      ...(reason === undefined ? {} : { reason }),
    }
  }
  if (type === 'approval/resolved' && typeof value.sessionId === 'string' && typeof value.approvalId === 'string' && typeof value.outcome === 'string') return { type, sessionId: value.sessionId, approvalId: value.approvalId, outcome: value.outcome }
  if (type === 'question/requested' && typeof value.sessionId === 'string' && Array.isArray(value.questions)) {
    const questions = value.questions.map(parseQuestion).filter((question): question is QuestionItem => question !== undefined)
    if (questions.length > 0) return { type, sessionId: value.sessionId, questions }
  }
  if (type === 'question/resolved' && typeof value.sessionId === 'string' && typeof value.questionRpcId === 'string' && typeof value.outcome === 'string') return { type, sessionId: value.sessionId, questionRpcId: value.questionRpcId, outcome: value.outcome }
  if (type === 'session/queue' && typeof value.sessionId === 'string' && Array.isArray(value.items)) return { type, sessionId: value.sessionId, items: value.items }
  if (type === 'session/jobs' && typeof value.sessionId === 'string' && Array.isArray(value.jobs)) return { type, sessionId: value.sessionId, jobs: value.jobs }
  if (type === 'session/projection' && typeof value.sessionId === 'string' && typeof value.key === 'string' && typeof value.seq === 'number') return { type, sessionId: value.sessionId, key: value.key, value: value.value, seq: value.seq }
  if (type === 'stream/error' && isRecord(value.error) && typeof value.error.code === 'string' && typeof value.error.message === 'string') return { type, error: { code: value.error.code, message: value.error.message } }
  throw new Error(`Unsupported Harness mux frame: ${type}`)
}

export function parseHostFrame(value: unknown): HostFrame {
  if (!isRecord(value) || typeof value.type !== 'string') throw new Error('Malformed Harness host frame.')
  if (value.type === 'host/session-added' && typeof value.sessionId === 'string') {
    const cwd = stringOrUndefined(value.cwd)
    const agentPreset = stringOrUndefined(value.agentPreset)
    return {
      type: value.type,
      sessionId: value.sessionId,
      ...(cwd === undefined ? {} : { cwd }),
      ...(agentPreset === undefined ? {} : { agentPreset }),
    }
  }
  if (value.type === 'host/session-removed' && typeof value.sessionId === 'string') return { type: value.type, sessionId: value.sessionId }
  if (value.type === 'host/session-status' && typeof value.sessionId === 'string' && typeof value.running === 'boolean') return { type: value.type, sessionId: value.sessionId, running: value.running }
  if (value.type === 'host/archived-sessions-changed' && Array.isArray(value.archivedSessionIds) && value.archivedSessionIds.every(item => typeof item === 'string')) {
    return { type: value.type, archivedSessionIds: value.archivedSessionIds }
  }
  if (value.type === 'host/agent-error' && typeof value.sessionId === 'string' && typeof value.message === 'string') return { type: value.type, sessionId: value.sessionId, message: value.message }
  if (value.type === 'host/remote-event' && typeof value.event === 'string' && Array.isArray(value.args)) return { type: value.type, event: value.event, args: value.args }
  if (value.type === 'stream/error' && isRecord(value.error) && typeof value.error.code === 'string' && typeof value.error.message === 'string') return { type: value.type, error: { code: value.error.code, message: value.error.message } }
  throw new Error(`Unsupported Harness host frame: ${value.type}`)
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function parseSessionEvent(value: unknown): SessionEvent {
  const seq = isRecord(value) ? value.seq : undefined
  if (!isRecord(value)
    || typeof value.type !== 'string'
    || !Number.isSafeInteger(seq)
    || (seq as number) < 0
    || typeof value.time !== 'number'
    || !Number.isFinite(value.time)
    || !Object.hasOwn(value, 'data')) {
    throw new Error('Malformed Harness session event.')
  }
  return value as unknown as SessionEvent
}

function normalizeSessionEvent(value: Record<string, unknown>): SessionEvent | undefined {
  const seq = value.seq
  if (typeof value.type !== 'string' || !Number.isSafeInteger(seq) || (seq as number) < 0
    || typeof value.time !== 'number' || !Number.isFinite(value.time) || !Object.hasOwn(value, 'data')) return undefined
  return value as unknown as SessionEvent
}

function expandChunkRow(value: Record<string, unknown>): SessionEvent[] {
  const row = value
  const rowType = row.type
  const data = isRecord(row.data) ? row.data : undefined
  const sequence = row.seq
  if ((rowType !== 'chunkrow/text-chunks' && rowType !== 'chunkrow/reasoning-chunks' && rowType !== 'chunkrow/tool-call-chunks')
    || data === undefined || !Number.isSafeInteger(sequence) || (sequence as number) < 0 || typeof row.time !== 'number' || !Number.isFinite(row.time)
    || typeof data.turn !== 'number' || typeof data.step !== 'number' || typeof data.index !== 'number'
    || !Array.isArray(data.dt)) return []
  const values = rowType === 'chunkrow/tool-call-chunks' ? data.args : data.texts
  if (!Array.isArray(values) || values.length === 0 || values.some(item => typeof item !== 'string')
    || data.dt.some(item => !Number.isSafeInteger(item)) || data.dt.length !== values.length - 1) return []
  const events: SessionEvent[] = []
  let time = row.time as number
  for (let index = 0; index < values.length; index += 1) {
    if (index > 0) time += data.dt[index - 1] as number
    if (!Number.isSafeInteger(time)) return []
    const chunk: Record<string, unknown> = rowType === 'chunkrow/text-chunks'
      ? { type: 'text-delta', index: data.index, text: values[index] }
      : rowType === 'chunkrow/reasoning-chunks'
        ? { type: 'reasoning-delta', index: data.index, text: values[index] }
        : {
            type: 'tool-call-delta',
            index: data.index,
            id: typeof data.id === 'string' ? data.id : '',
            ...(typeof data.name === 'string' ? { name: data.name } : {}),
            argumentsDelta: values[index],
          }
    if (chunk.type === 'tool-call-delta' && chunk.id === '') return []
    events.push({
      type: 'assistant/chunk',
      seq: (sequence as number) + index,
      time,
      data: { turn: data.turn, step: data.step, chunk },
    })
  }
  return events
}

function parseQuestion(value: unknown): QuestionItem | undefined {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.question !== 'string') return undefined
  const header = stringOrUndefined(value.header)
  const detail = stringOrUndefined(value.detail)
  const multiSelect = typeof value.multiSelect === 'boolean' ? value.multiSelect : undefined
  const options = Array.isArray(value.options)
    ? value.options.map(parseQuestionOption).filter((option): option is NonNullable<QuestionItem['options']>[number] => option !== undefined)
    : undefined
  return {
    id: value.id,
    question: value.question,
    ...(header === undefined ? {} : { header }),
    ...(detail === undefined ? {} : { detail }),
    ...(options === undefined ? {} : { options }),
    ...(multiSelect === undefined ? {} : { multiSelect }),
  }
}

function parseQuestionOption(value: unknown): { readonly label: string; readonly description?: string } | undefined {
  if (!isRecord(value) || typeof value.label !== 'string' || value.label.trim() === '') return undefined
  const description = stringOrUndefined(value.description)
  return { label: value.label, ...(description === undefined ? {} : { description }) }
}

export function parseModelCatalog(value: unknown): ModelCatalog {
  if (!isRecord(value) || !Array.isArray(value.groups) || !Array.isArray(value.failures)) {
    throw new Error('Malformed Harness model catalog.')
  }
  const currentValue = value.current ?? value.default
  const routable = typeof value.routable === 'boolean'
    ? value.routable
    : Array.isArray(value.routableProviders) && value.routableProviders.length > 0
  return {
    current: parseModelSelection(currentValue),
    routable,
    groups: value.groups.map(parseModelProviderGroup),
    failures: value.failures.map(parseModelCatalogFailure),
  }
}

export function parseModelSelectionResult(value: unknown): { readonly selected: ModelSelection } {
  if (!isRecord(value)) throw new Error('Malformed Harness model selection.')
  return { selected: parseModelSelection(value.selected) }
}

export function parsePresetCatalog(value: unknown): PresetCatalog {
  if (!isRecord(value) || !Array.isArray(value.presets) || typeof value.authorable !== 'boolean') {
    throw new Error('Malformed Harness agent preset catalog.')
  }
  return {
    presets: value.presets.map(parsePresetCatalogEntry),
    authorable: value.authorable,
    // alpha.3 moved document authoring to a separate API and omits this
    // legacy capability bit from the roster response.
    hasDocument: value.hasDocument === true,
  }
}

export function parseRenameResult(value: unknown): { readonly title: string; readonly seq: number } {
  if (!isRecord(value) || typeof value.title !== 'string' || typeof value.seq !== 'number') throw new Error('Malformed Harness session rename result.')
  return { title: value.title, seq: value.seq }
}

export function parseSessionAttachment(value: unknown): SessionAttachment {
  if (!isRecord(value) || !isRecord(value.attachment) || typeof value.data !== 'string') throw new Error('Malformed Harness session attachment.')
  const attachment = value.attachment
  const mediaType = attachment.mediaType
  const bytes = positiveSafeInteger(attachment.bytes)
  const width = positiveSafeInteger(attachment.width)
  const height = positiveSafeInteger(attachment.height)
  if (typeof attachment.attachmentId !== 'string' || attachment.attachmentId.trim() === ''
    || (mediaType !== 'image/png' && mediaType !== 'image/jpeg' && mediaType !== 'image/webp' && mediaType !== 'image/gif')
    || bytes === undefined || width === undefined || height === undefined) {
    throw new Error('Malformed Harness session attachment metadata.')
  }
  const name = typeof attachment.name === 'string' && attachment.name.trim() !== '' ? attachment.name : undefined
  return {
    attachment: {
      attachmentId: attachment.attachmentId,
      mediaType,
      bytes,
      width,
      height,
      ...(name === undefined ? {} : { name }),
    },
    data: value.data,
  }
}

function positiveSafeInteger(value: unknown): number | undefined {
  return Number.isSafeInteger(value) && (value as number) > 0 ? value as number : undefined
}

export function parsePresetSelectionResult(value: unknown): { readonly agentPreset: string } {
  if (!isRecord(value) || typeof value.agentPreset !== 'string') throw new Error('Malformed Harness agent preset selection.')
  return { agentPreset: value.agentPreset }
}

export function parseContextPressureProjection(value: unknown): ContextPressureProjection | undefined {
  if (!isRecord(value)) return undefined
  const pressureTokens = optionalSafeInteger(value.pressureTokens, 0)
  const projectedTokens = optionalSafeInteger(value.projectedTokens, 0)
  const contextWindow = optionalSafeInteger(value.contextWindow, 1)
  if (pressureTokens === null || projectedTokens === null || contextWindow === null) return undefined
  return {
    ...(pressureTokens === undefined ? {} : { pressureTokens }),
    ...(projectedTokens === undefined ? {} : { projectedTokens }),
    ...(contextWindow === undefined ? {} : { contextWindow }),
  }
}

function parseModelSelection(value: unknown): ModelSelection {
  if (!isRecord(value) || !nonEmptyString(value.provider) || !nonEmptyString(value.model)) throw new Error('Malformed Harness model selection.')
  const reasoningEffort = nonEmptyString(value.reasoningEffort) ? value.reasoningEffort : undefined
  return {
    provider: value.provider,
    model: value.model,
    ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
  }
}

function parseModelProviderGroup(value: unknown): ModelProviderGroup {
  if (!isRecord(value) || !nonEmptyString(value.id) || !nonEmptyString(value.name) || !Array.isArray(value.models)) {
    throw new Error('Malformed Harness model provider group.')
  }
  return { id: value.id, name: value.name, models: value.models.map(parseModelCatalogModel) }
}

function parseModelCatalogModel(value: unknown): ModelCatalogModel {
  if (!isRecord(value) || !nonEmptyString(value.id) || !nonEmptyString(value.name)) throw new Error('Malformed Harness model entry.')
  const description = stringOrUndefined(value.description)
  const reasoning = value.reasoning === undefined ? undefined : parseModelReasoning(value.reasoning)
  return {
    id: value.id,
    name: value.name,
    ...(description === undefined ? {} : { description }),
    ...(reasoning === undefined ? {} : { reasoning }),
  }
}

function parseModelReasoning(value: unknown): NonNullable<ModelCatalogModel['reasoning']> {
  if (!isRecord(value) || !Array.isArray(value.efforts) || value.efforts.length === 0) throw new Error('Malformed Harness reasoning catalog.')
  const defaultEffort = nonEmptyString(value.defaultEffort) ? value.defaultEffort : undefined
  return {
    efforts: value.efforts.map(parseModelReasoningEffort),
    ...(defaultEffort === undefined ? {} : { defaultEffort }),
  }
}

function parseModelReasoningEffort(value: unknown): ModelReasoningEffort {
  if (!isRecord(value) || !nonEmptyString(value.id) || !nonEmptyString(value.name)) throw new Error('Malformed Harness reasoning effort.')
  const description = stringOrUndefined(value.description)
  return { id: value.id, name: value.name, ...(description === undefined ? {} : { description }) }
}

function parseModelCatalogFailure(value: unknown): ModelCatalog['failures'][number] {
  if (!isRecord(value) || !nonEmptyString(value.id) || !nonEmptyString(value.name) || typeof value.message !== 'string') {
    throw new Error('Malformed Harness model catalog failure.')
  }
  return { id: value.id, name: value.name, message: value.message }
}

function parsePresetCatalogEntry(value: unknown): PresetCatalogEntry {
  if (!isRecord(value)
    || !nonEmptyString(value.id)
    || (value.trust !== 'system' && value.trust !== 'user')
    || typeof value.isDefault !== 'boolean') {
    throw new Error('Malformed Harness agent preset entry.')
  }
  const name = stringOrUndefined(value.name)
  const description = stringOrUndefined(value.description)
  const broken = nonEmptyString(value.broken) ? value.broken : undefined
  return {
    id: value.id,
    trust: value.trust,
    isDefault: value.isDefault,
    ...(name === undefined ? {} : { name }),
    ...(description === undefined ? {} : { description }),
    ...(broken === undefined ? {} : { broken }),
  }
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== ''
}

function optionalSafeInteger(value: unknown, minimum: number): number | undefined | null {
  if (value === undefined) return undefined
  return Number.isSafeInteger(value) && (value as number) >= minimum ? value as number : null
}

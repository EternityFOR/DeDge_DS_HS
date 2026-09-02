import { randomUUID } from 'node:crypto'
import * as vscode from 'vscode'
import { errorMessage, type Logger } from '../platform/logger.js'
import { EventStream } from './event-stream.js'
import { bootstrapGatewayCookie, withGatewayCookie } from './auth.js'
import {
  expandHistoryRecords,
  isRecord,
  parseModelCatalog,
  parseModelSelectionResult,
  parsePresetCatalog,
  parsePresetSelectionResult,
  parseRenameResult,
  parseServerResponse,
  parseSessionAttachment,
  type HostDescription,
  type HostFrame,
  type ModelCatalog,
  type ModelSelection,
  type MuxFrame,
  type PresetCatalog,
  type SessionAttachment,
  type SessionHistory,
  type SessionSummary,
  type WorkspaceRegistry,
} from './protocol.js'

export interface GatewayHandlers {
  readonly onMux: (frame: MuxFrame, rpcId: string) => void
  readonly onHost: (frame: HostFrame, rpcId: string) => void
  readonly onError: (error: Error) => void
}

export type PromptContentPart =
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'image'; readonly mediaType: string; readonly data: string; readonly name?: string }

/** A mutation of one still-pending Harness inbox item. */
export type QueueAction =
  | { readonly kind: 'remove' }
  | { readonly kind: 'steer' }
  | { readonly kind: 'edit'; readonly content: readonly PromptContentPart[] }

interface PendingRemoteEvent {
  readonly clientId: string
  readonly kind: 'approval' | 'question'
}

export class GatewayClient implements vscode.Disposable {
  private stream: EventStream | undefined
  private cookie: string | undefined
  private readonly sessionCursors = new Map<string, number>()
  private readonly remoteEvents = new Map<string, PendingRemoteEvent>()

  constructor(private readonly baseUrl: string, private readonly logger: Logger) {}

  async connect(handlers: GatewayHandlers): Promise<HostDescription> {
    this.cookie = await bootstrapGatewayCookie(this.baseUrl)
    // alpha.3 removed the old host.describe endpoint. A session list is a
    // lightweight authenticated RPC that proves the Gateway is ready.
    const listed = await this.request<{ readonly items?: readonly SessionSummary[] }>('session/list', { _request: {} })
    this.stream = new EventStream(this.baseUrl, {
      onMux: (frame, rpcId) => {
        if (frame.type === 'session/event') this.sessionCursors.set(frame.sessionId, Math.max(this.sessionCursors.get(frame.sessionId) ?? -1, frame.event.seq))
        if (frame.type === 'session/subscribed') this.sessionCursors.set(frame.sessionId, Math.max(this.sessionCursors.get(frame.sessionId) ?? -1, frame.lastSeq))
        handlers.onMux(frame, rpcId)
      },
      onHost: handlers.onHost,
      onError: handlers.onError,
      onEventClient: (eventId, clientId, event) => {
        if (event === 'approval/request') this.remoteEvents.set(eventId, { clientId, kind: 'approval' })
        else if (event === 'user-questions/request') this.remoteEvents.set(eventId, { clientId, kind: 'question' })
      },
    }, this.logger, this.cookie)
    this.stream.start()
    return { attachedSessions: listed.items?.length ?? 0 }
  }

  dispose(): void {
    this.stream?.dispose()
    this.stream = undefined
    this.cookie = undefined
    this.remoteEvents.clear()
    this.sessionCursors.clear()
  }

  call<T>(endpoint: string, args: unknown, signal?: AbortSignal): Promise<T> {
    return this.request<T>(endpoint, args, signal)
  }

  hostDescription(signal?: AbortSignal): Promise<HostDescription> {
    return this.request<{ readonly items?: readonly SessionSummary[] }>('session/list', { _request: {} }, signal)
      .then(value => ({ attachedSessions: value.items?.length ?? 0 }))
  }

  createSession(cwd: string, agentPreset?: string): Promise<{ readonly sessionId: string; readonly agentPreset?: string }> {
    return this.request('session/create', { request: { cwd, ...(agentPreset === undefined ? {} : { agentPreset }) } })
  }

  listSessions(): Promise<{ readonly items: SessionSummary[] }> {
    return this.request<{ readonly items: SessionSummary[] }>('session/list', { _request: {} }).then(result => ({
      items: result.items.map(item => {
        const projectedTitle = item.projections?.values?.title
        // alpha.3 exposes the session-owned preset through the projection
        // column rather than a top-level session-list field.
        const projectedPreset = item.projections?.values?.agentPreset
        const title = typeof projectedTitle === 'string' && projectedTitle.trim() !== '' ? projectedTitle : item.title
        const agentPreset = typeof projectedPreset === 'string' && projectedPreset.trim() !== ''
          ? projectedPreset
          : item.agentPreset
        return {
          ...item,
          ...(title === undefined ? {} : { title }),
          ...(agentPreset === undefined ? {} : { agentPreset }),
        }
      }),
    }))
  }

  async listWorkspaces(): Promise<WorkspaceRegistry> {
    const snapshot = await this.requireStream().workspaceSnapshot()
    return { archivedSessionIds: [...snapshot.archivedSessionIds] }
  }

  archiveSession(sessionId: string): Promise<WorkspaceRegistry> {
    return this.request<{ readonly archivedSessionIds?: readonly string[] }>('workspace/archiveSession', { request: { sessionId } })
      .then(result => ({ archivedSessionIds: [...(result.archivedSessionIds ?? [])] }))
  }

  renameSession(sessionId: string, title: string): Promise<{ readonly title: string; readonly seq: number }> {
    return this.request('session/rename', { request: { sessionId, title } }).then(parseRenameResult)
  }

  getSessionAttachment(sessionId: string, attachmentId: string): Promise<SessionAttachment> {
    return this.request('session/attachment', { request: { sessionId, attachmentId } }).then(parseSessionAttachment)
  }

  async history(sessionId: string, maxMessages = 40, beforeSeq?: number): Promise<SessionHistory> {
    const stream = this.requireStream()
    if (beforeSeq === undefined) {
      const snapshot = await stream.openSession(sessionId, maxMessages)
      this.sessionCursors.set(sessionId, snapshot.cursor)
      return {
        events: expandHistoryRecords(snapshot.records),
        hasMore: snapshot.hasMore,
        ...(snapshot.projections === undefined ? {} : { projections: snapshot.projections }),
      }
    }
    if (this.sessionCursors.get(sessionId) === undefined) {
      const snapshot = await stream.openSession(sessionId, maxMessages)
      this.sessionCursors.set(sessionId, snapshot.cursor)
    }
    const page = await this.request<{ readonly records?: readonly unknown[]; readonly hasMore?: boolean }>('session/page', {
      request: {
        address: { kind: 'session', sessionId },
        throughSeq: this.sessionCursors.get(sessionId) ?? -1,
        beforeSeq,
        maxMessages,
      },
    })
    return { events: expandHistoryRecords(page.records ?? []), hasMore: page.hasMore === true }
  }

  prompt(sessionId: string, content: string | readonly PromptContentPart[], mode: 'queue' | 'steer' = 'queue'): Promise<{ readonly accepted?: boolean }> {
    const parts = typeof content === 'string' ? [{ type: 'text' as const, text: content }] : content
    return this.request('session/prompt', { request: { requestId: randomUUID(), sessionId, mode, content: parts } })
  }

  async cancel(sessionId: string): Promise<{ readonly accepted: true }> {
    const value: unknown = await this.request('session/cancel', { request: { sessionId } })
    if (!isRecord(value) || value.accepted !== true) throw new Error('Harness did not acknowledge the stop request.')
    return { accepted: true }
  }

  updateQueueItem(sessionId: string, itemId: string, action: QueueAction): Promise<{ readonly accepted: true }> {
    return this.request('session/updateQueue', { request: { sessionId, itemId, action } }).then(value => {
      if (!isRecord(value) || value.accepted !== true) throw new Error(`Harness did not acknowledge the queue-item ${action.kind} request.`)
      return { accepted: true }
    })
  }

  removeQueueItem(sessionId: string, itemId: string): Promise<{ readonly accepted: true }> {
    return this.updateQueueItem(sessionId, itemId, { kind: 'remove' })
  }

  async models(_sessionId: string): Promise<ModelCatalog> {
    return parseModelCatalog(await this.request('session/modelCatalog', {}))
  }

  async selectModel(sessionId: string, provider: string, model: string, reasoningEffort?: string): Promise<{ readonly selected: ModelSelection }> {
    return parseModelSelectionResult(await this.request('session/selectModel', { request: { sessionId, provider, model, ...(reasoningEffort === undefined ? {} : { reasoningEffort }) } }))
  }

  async presets(): Promise<PresetCatalog> {
    return parsePresetCatalog(await this.request('agentPresets/list', {}))
  }

  async selectPreset(sessionId: string, agentPreset: string): Promise<{ readonly agentPreset: string }> {
    return parsePresetSelectionResult(await this.request('agentPresets/select', { agentId: sessionId, agentPreset }))
  }

  executeCommand(sessionId: string, line: string): Promise<{ readonly result?: { readonly kind?: string; readonly text?: string } }> {
    return this.request<unknown>('commands/execute', { agentId: sessionId, line, images: [] }).then(value => {
      let execution = value
      // Keep accepting the older RemoteResult envelope for an explicitly
      // configured external runtime while alpha.3 returns the value directly.
      if (isRecord(value) && typeof value.ok === 'boolean') {
        if (!value.ok) {
          const failure = isRecord(value.error) ? value.error : {}
          throw new Error(`Harness command failed: ${typeof failure.message === 'string' ? failure.message : 'unknown command failure'}`)
        }
        execution = value.value
      }
      if (execution === undefined) return {}
      if (!isRecord(execution) || !isRecord(execution.result)) throw new Error('Malformed Harness command execution.')
      const result = execution.result
      if ((result.kind !== 'success' && result.kind !== 'error') || (result.text !== undefined && typeof result.text !== 'string')) {
        throw new Error('Malformed Harness command result.')
      }
      return { result: { kind: result.kind, ...(typeof result.text === 'string' ? { text: result.text } : {}) } }
    })
  }

  async respond(rpcId: string, value: unknown): Promise<{ readonly accepted: boolean }> {
    const pending = this.remoteEvents.get(rpcId)
    if (pending === undefined) throw new Error('Harness interaction is no longer pending.')
    const result = pending.kind === 'approval'
      ? isRecord(value) && typeof value.outcome === 'string' ? value.outcome : value
      : isRecord(value) && isRecord(value.answer) ? value.answer : value
    await this.request('$events/result', { clientId: pending.clientId, eventId: rpcId, outcome: { kind: 'result', value: result } })
    this.remoteEvents.delete(rpcId)
    return { accepted: true }
  }

  async rejectRequest(rpcId: string, code: string, message: string): Promise<{ readonly accepted: boolean }> {
    const pending = this.remoteEvents.get(rpcId)
    if (pending === undefined) throw new Error('Harness interaction is no longer pending.')
    await this.request('$events/result', {
      clientId: pending.clientId,
      eventId: rpcId,
      outcome: { kind: 'rejected', error: { name: 'Error', message, code, details: {} } },
    })
    this.remoteEvents.delete(rpcId)
    return { accepted: true }
  }

  private requireStream(): EventStream {
    if (this.stream === undefined) throw new Error('Harness Gateway event stream is not connected.')
    return this.stream
  }

  private async request<T>(endpoint: string, args: unknown, signal?: AbortSignal): Promise<T> {
    const rpcId = randomUUID()
    let response: Response
    try {
      response = await fetch(new URL(`/api/${endpoint}`, this.baseUrl), {
        method: 'POST',
        headers: withGatewayCookie({ 'content-type': 'application/json' }, this.cookie),
        body: JSON.stringify({ type: 'client-request', rpcId, method: endpoint, payload: { args } }),
        ...(signal === undefined ? {} : { signal }),
      })
    } catch (error) {
      throw new Error(`Harness RPC ${endpoint} transport failed: ${errorMessage(error)}`)
    }
    if (!response.ok) throw new Error(`Harness RPC ${endpoint} returned HTTP ${response.status}.`)
    const parsed = parseServerResponse(await response.json())
    if (parsed.rpcId !== rpcId) throw new Error(`Harness RPC ${endpoint} response id mismatch.`)
    if (!parsed.result.ok) throw new Error(`Harness RPC ${endpoint} failed: ${parsed.result.error.code}: ${parsed.result.error.message}`)
    return parsed.result.value as T
  }
}

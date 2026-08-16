import { randomUUID } from 'node:crypto'
import * as vscode from 'vscode'
import { errorMessage, type Logger } from '../platform/logger.js'
import { EventStream } from './event-stream.js'
import { isRecord, parseModelCatalog, parseModelSelectionResult, parsePresetCatalog, parsePresetSelectionResult, parseServerResponse, type HostDescription, type HostFrame, type ModelCatalog, type ModelSelection, type MuxFrame, type PresetCatalog, type SessionHistory, type SessionSummary, type WorkspaceRegistry } from './protocol.js'

export interface GatewayHandlers {
  readonly onMux: (frame: MuxFrame, rpcId: string) => void
  readonly onHost: (frame: HostFrame, rpcId: string) => void
  readonly onError: (error: Error) => void
}

export class GatewayClient implements vscode.Disposable {
  private stream: EventStream | undefined

  constructor(private readonly baseUrl: string, private readonly logger: Logger) {}

  async connect(handlers: GatewayHandlers): Promise<HostDescription> {
    const description = await this.call<HostDescription>('host.describe', {})
    this.stream = new EventStream(this.baseUrl, handlers, this.logger)
    this.stream.start()
    return description
  }

  dispose(): void {
    this.stream?.dispose()
    this.stream = undefined
  }

  call<T>(method: string, payload: unknown, signal?: AbortSignal): Promise<T> {
    return this.request<T>(method, payload, signal)
  }

  hostDescription(signal?: AbortSignal): Promise<HostDescription> {
    return this.call<HostDescription>('host.describe', {}, signal)
  }

  createSession(cwd: string, agentPreset?: string): Promise<{ readonly sessionId: string; readonly agentPreset?: string }> {
    return this.call('session.create', { cwd, ...(agentPreset === undefined ? {} : { agentPreset }) })
  }

  listSessions(): Promise<{ readonly items: SessionSummary[] }> {
    return this.call('session.list', {})
  }

  listWorkspaces(): Promise<WorkspaceRegistry> {
    return this.call('workspace.list', {})
  }

  archiveSession(sessionId: string): Promise<WorkspaceRegistry> {
    return this.call('workspace.archiveSession', { sessionId })
  }

  history(sessionId: string, maxMessages = 80): Promise<SessionHistory> {
    return this.call('session.history', { sessionId, maxMessages })
  }

  prompt(sessionId: string, text: string, mode: 'queue' | 'steer' = 'queue'): Promise<{ readonly accepted?: boolean }> {
    return this.call('session.prompt', { sessionId, mode, content: [{ type: 'text', text }] })
  }

  async cancel(sessionId: string): Promise<{ readonly accepted: true }> {
    const value: unknown = await this.call('session.cancel', { sessionId })
    if (!isRecord(value) || value.accepted !== true) throw new Error('Harness did not acknowledge the stop request.')
    return { accepted: true }
  }

  async models(sessionId: string): Promise<ModelCatalog> {
    return parseModelCatalog(await this.call('session.models', { sessionId }))
  }

  async selectModel(sessionId: string, provider: string, model: string, reasoningEffort?: string): Promise<{ readonly selected: ModelSelection }> {
    return parseModelSelectionResult(await this.call('session.selectModel', { sessionId, provider, model, ...(reasoningEffort === undefined ? {} : { reasoningEffort }) }))
  }

  async presets(): Promise<PresetCatalog> {
    return parsePresetCatalog(await this.call('agentPreset.list', {}))
  }

  async selectPreset(sessionId: string, agentPreset: string): Promise<{ readonly agentPreset: string }> {
    return parsePresetSelectionResult(await this.call('agentPreset.select', { sessionId, agentPreset }))
  }

  executeCommand(sessionId: string, line: string): Promise<{ readonly result?: { readonly kind?: string; readonly text?: string } }> {
    return this.call('commands.execute', { args: { agentId: sessionId, line } })
  }

  respond(rpcId: string, value: unknown): Promise<{ readonly accepted: boolean }> {
    return this.postRespond({ type: 'client-response', rpcId, result: { ok: true, value } })
  }

  rejectRequest(rpcId: string, code: string, message: string): Promise<{ readonly accepted: boolean }> {
    return this.postRespond({ type: 'client-response', rpcId, result: { ok: false, error: { code, message } } })
  }

  private async postRespond(body: unknown): Promise<{ readonly accepted: boolean }> {
    const response = await fetch(new URL('/api/respond', this.baseUrl), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!response.ok) throw new Error(`Harness response endpoint returned HTTP ${response.status}.`)
    const value: unknown = await response.json()
    if (!isRecord(value) || typeof value.accepted !== 'boolean') throw new Error('Malformed Harness response receipt.')
    return { accepted: value.accepted }
  }

  private async request<T>(method: string, payload: unknown, signal?: AbortSignal): Promise<T> {
    const rpcId = randomUUID()
    let response: Response
    try {
      response = await fetch(new URL(`/api/${method}`, this.baseUrl), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'client-request', rpcId, method, payload }),
        ...(signal === undefined ? {} : { signal }),
      })
    } catch (error) {
      throw new Error(`Harness RPC ${method} transport failed: ${errorMessage(error)}`)
    }
    if (!response.ok) throw new Error(`Harness RPC ${method} returned HTTP ${response.status}.`)
    const parsed = parseServerResponse(await response.json())
    if (parsed.rpcId !== rpcId) throw new Error(`Harness RPC ${method} response id mismatch.`)
    if (!parsed.result.ok) throw new Error(`Harness RPC ${method} failed: ${parsed.result.error.code}: ${parsed.result.error.message}`)
    return parsed.result.value as T
  }
}

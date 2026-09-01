import { randomUUID } from 'node:crypto'
import WebSocket from 'ws'
import { expandHistoryRecords, isRecord, type HostFrame, type MuxFrame } from './protocol.js'
import type { Logger } from '../platform/logger.js'

export interface EventHandlers {
  readonly onMux: (frame: MuxFrame, rpcId: string) => void
  readonly onHost: (frame: HostFrame, rpcId: string) => void
  readonly onError?: (error: Error) => void
  /** Correlate an alpha.3 Remote Event waterfall with its client id. */
  readonly onEventClient?: (eventId: string, clientId: string, event: string) => void
}

export interface SessionFollowSnapshot {
  readonly cursor: number
  readonly records: readonly unknown[]
  readonly hasMore: boolean
  readonly projections?: { readonly values?: Record<string, unknown> }
}

interface WorkspaceSnapshot {
  readonly archivedSessionIds: readonly string[]
}

interface StreamSpec {
  readonly key: string
  readonly endpoint: string
  readonly payload: unknown
  readonly onItem: (value: unknown) => void
  readonly onError?: (error: Error) => void
  socket: WebSocket | undefined
  retryDelay: number
  retryTimer: ReturnType<typeof setTimeout> | undefined
  closed: boolean
}

/**
 * alpha.3's browser transport is one authenticated RemoteStreamMux socket.
 * Each logical stream below is kept independent so a stalled session history
 * feed cannot block control, workspace, or approval events.
 */
export class EventStream implements Disposable {
  private readonly streams = new Map<string, StreamSpec>()
  private readonly workspaceWaiters: Array<{ resolve: (value: WorkspaceSnapshot) => void; reject: (error: Error) => void }> = []
  private workspaceBaseline: WorkspaceSnapshot | undefined
  private remoteEventClientId: string | undefined
  private stopped = true
  private started = false

  constructor(
    private readonly baseUrl: string,
    private readonly handlers: EventHandlers,
    private readonly logger: Logger,
    private readonly cookie?: string,
  ) {}

  start(): void {
    if (!this.stopped) return
    this.stopped = false
    this.started = true
    this.ensureStream({
      key: 'control',
      endpoint: 'session/control',
      payload: { args: {} },
      socket: undefined,
      retryTimer: undefined,
      retryDelay: 1_000,
      closed: false,
      onItem: value => { this.handleControl(value) },
    })
    this.ensureStream({
      key: 'workspace',
      endpoint: 'workspace/follow',
      payload: { args: {} },
      socket: undefined,
      retryTimer: undefined,
      retryDelay: 1_000,
      closed: false,
      onItem: value => { this.handleWorkspace(value) },
      onError: error => { this.rejectWorkspaceWaiters(error) },
    })
    this.ensureStream({
      key: 'events',
      endpoint: '$events',
      payload: { args: {} },
      socket: undefined,
      retryTimer: undefined,
      retryDelay: 1_000,
      closed: false,
      onItem: value => { this.handleRemoteEvent(value) },
    })
  }

  async openSession(sessionId: string, maxMessages = 40): Promise<SessionFollowSnapshot> {
    if (!this.started) this.start()
    this.removeStream('session')
    let initial = true
    let settled = false
    let resolveInitial!: (value: SessionFollowSnapshot) => void
    let rejectInitial!: (error: Error) => void
    const result = new Promise<SessionFollowSnapshot>((resolve, reject) => {
      resolveInitial = resolve
      rejectInitial = reject
    })
    const fail = (error: Error): void => {
      if (!settled) {
        settled = true
        rejectInitial(error)
      } else {
        this.logger.warn(`Session history stream failed: ${error.message}`)
      }
    }
    const spec: StreamSpec = {
      key: 'session',
      endpoint: 'session/follow',
      payload: {
        args: {
          request: {
            address: { kind: 'session', sessionId },
            maxMessages,
          },
        },
      },
      socket: undefined,
      retryTimer: undefined,
      retryDelay: 1_000,
      closed: false,
      onError: fail,
      onItem: value => {
        if (isSessionSnapshot(value)) {
          let snapshot: SessionFollowSnapshot
          try {
            snapshot = normalizeSessionSnapshot(value)
          } catch (error) {
            fail(error instanceof Error ? error : new Error(String(error)))
            return
          }
          if (initial) {
            initial = false
            settled = true
            resolveInitial(snapshot)
            return
          }
          this.handlers.onMux({ type: 'session/subscribed', sessionId, lastSeq: snapshot.cursor }, `session:${sessionId}`)
          for (const event of expandHistoryRecords(snapshot.records)) this.emitSessionEvent(sessionId, event.event)
          return
        }
        const event = expandHistoryRecords([value])[0]?.event
        if (event !== undefined) this.emitSessionEvent(sessionId, event)
      },
    }
    this.streams.set(spec.key, spec)
    this.open(spec)
    return result
  }

  workspaceSnapshot(): Promise<WorkspaceSnapshot> {
    if (!this.started) this.start()
    if (this.workspaceBaseline !== undefined) return Promise.resolve(this.workspaceBaseline)
    return new Promise<WorkspaceSnapshot>((resolve, reject) => {
      this.workspaceWaiters.push({ resolve, reject })
    })
  }

  dispose(): void {
    this.stopped = true
    this.remoteEventClientId = undefined
    for (const spec of this.streams.values()) {
      spec.closed = true
      if (spec.retryTimer !== undefined) clearTimeout(spec.retryTimer)
      spec.socket?.close()
    }
    this.streams.clear()
    this.rejectWorkspaceWaiters(new Error('Harness event stream disposed.'))
  }

  private ensureStream(spec: StreamSpec): void {
    if (this.streams.has(spec.key)) return
    this.streams.set(spec.key, spec)
    this.open(spec)
  }

  private open(spec: StreamSpec): void {
    if (this.stopped || spec.closed) return
    const url = new URL('/api/remote.mux', this.baseUrl)
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    const socket = new WebSocket(url.toString(), {
      handshakeTimeout: 5_000,
      ...(this.cookie === undefined ? {} : { headers: { cookie: this.cookie } }),
    })
    spec.socket = socket
    let opened = false
    socket.once('open', () => {
      opened = true
      spec.retryDelay = 1_000
      socket.send(JSON.stringify({ type: 'open', streamId: spec.key === 'session' ? randomUUID() : spec.key, endpoint: spec.endpoint, payload: spec.payload }))
    })
    socket.on('message', data => {
      let frame: unknown
      try {
        frame = JSON.parse(data.toString()) as unknown
      } catch (error) {
        this.reportError(spec, error instanceof Error ? error : new Error(String(error)))
        return
      }
      if (!isRecord(frame) || typeof frame.type !== 'string') return
      if (frame.type === 'item') {
        spec.onItem(frame.value)
        return
      }
      if (frame.type === 'error') {
        const detail = isRecord(frame.error) && typeof frame.error.message === 'string' ? frame.error.message : 'Remote stream failed.'
        this.reportError(spec, new Error(detail))
        socket.close()
        return
      }
      if (frame.type === 'end') {
        this.reportError(spec, new Error('Remote stream ended unexpectedly.'))
        socket.close()
      }
    })
    socket.once('error', error => {
      if (!opened) this.reportError(spec, error instanceof Error ? error : new Error(String(error)))
    })
    socket.once('close', () => {
      if (spec.socket !== socket) return
      spec.socket = undefined
      if (spec.closed || this.stopped) return
      this.scheduleReconnect(spec)
    })
  }

  private scheduleReconnect(spec: StreamSpec): void {
    if (spec.retryTimer !== undefined || spec.closed || this.stopped) return
    const delay = spec.retryDelay
    spec.retryDelay = Math.min(delay * 2, 15_000)
    spec.retryTimer = setTimeout(() => {
      spec.retryTimer = undefined
      this.open(spec)
    }, delay)
  }

  private removeStream(key: string): void {
    const spec = this.streams.get(key)
    if (spec === undefined) return
    spec.closed = true
    if (spec.retryTimer !== undefined) clearTimeout(spec.retryTimer)
    spec.socket?.close()
    this.streams.delete(key)
  }

  private handleControl(value: unknown): void {
    if (!isRecord(value) || typeof value.type !== 'string') return
    if (value.type === 'baseline' && isRecord(value.value)) {
      const baseline = value.value
      const queues = recordMap(baseline.queues)
      const jobs = recordMap(baseline.jobs)
      const projections = recordMap(baseline.projections)
      const ids = new Set([...Object.keys(queues), ...Object.keys(jobs), ...Object.keys(projections)])
      for (const sessionId of ids) {
        const projection = projections[sessionId]
        const lastSeq = isRecord(projection) && Number.isSafeInteger(projection.asOfSeq) ? Number(projection.asOfSeq) : 0
        this.handlers.onMux({ type: 'session/subscribed', sessionId, lastSeq }, `control:${sessionId}`)
        this.handlers.onMux({ type: 'session/queue', sessionId, items: Array.isArray(queues[sessionId]) ? queues[sessionId] : [] }, `control:${sessionId}`)
        this.handlers.onMux({ type: 'session/jobs', sessionId, jobs: Array.isArray(jobs[sessionId]) ? jobs[sessionId] : [] }, `control:${sessionId}`)
        this.emitProjectionValues(sessionId, isRecord(projection) ? projection : undefined)
      }
      return
    }
    if (value.type === 'queue' && typeof value.sessionId === 'string') {
      this.handlers.onMux({ type: 'session/queue', sessionId: value.sessionId, items: Array.isArray(value.items) ? value.items : [] }, 'control')
      return
    }
    if (value.type === 'jobs' && typeof value.sessionId === 'string') {
      this.handlers.onMux({ type: 'session/jobs', sessionId: value.sessionId, jobs: Array.isArray(value.jobs) ? value.jobs : [] }, 'control')
      return
    }
    if (value.type === 'projection' && typeof value.sessionId === 'string' && typeof value.key === 'string') {
      this.handlers.onMux({
        type: 'session/projection',
        sessionId: value.sessionId,
        key: value.key,
        value: value.value,
        seq: typeof value.seq === 'number' ? value.seq : 0,
      }, 'control')
    }
  }

  private emitProjectionValues(sessionId: string, projection: Record<string, unknown> | undefined): void {
    if (!isRecord(projection) || !isRecord(projection.values)) return
    const seq = Number.isSafeInteger(projection.asOfSeq) ? Number(projection.asOfSeq) : 0
    for (const [key, value] of Object.entries(projection.values)) {
      this.handlers.onMux({ type: 'session/projection', sessionId, key, value, seq }, 'control')
    }
  }

  private handleWorkspace(value: unknown): void {
    if (!isRecord(value) || typeof value.type !== 'string') return
    if (value.type === 'archived' && Array.isArray(value.archivedSessionIds)) {
      const archivedSessionIds = value.archivedSessionIds.filter((item): item is string => typeof item === 'string')
      const snapshot: WorkspaceSnapshot = { archivedSessionIds }
      this.workspaceBaseline = snapshot
      this.handlers.onHost({ type: 'host/archived-sessions-changed', archivedSessionIds }, 'workspace')
      return
    }
    if (value.type !== 'baseline' || !isRecord(value.value)) return
    const archivedSessionIds = Array.isArray(value.value.archivedSessionIds)
      ? value.value.archivedSessionIds.filter((item): item is string => typeof item === 'string')
      : []
    const snapshot: WorkspaceSnapshot = { archivedSessionIds }
    this.workspaceBaseline = snapshot
    const waiters = this.workspaceWaiters.splice(0)
    for (const waiter of waiters) waiter.resolve(snapshot)
    this.handlers.onHost({ type: 'host/archived-sessions-changed', archivedSessionIds }, 'workspace')
  }

  private handleRemoteEvent(value: unknown): void {
    if (!isRecord(value) || typeof value.type !== 'string') return
    if (value.type === 'ready' && typeof value.clientId === 'string') {
      this.remoteEventClientId = value.clientId
      return
    }
    if (value.type === 'emit' && typeof value.event === 'string' && Array.isArray(value.args)) {
      this.handleEmittedEvent(value.event, value.args)
      return
    }
    if (value.type !== 'waterfall' || typeof value.event !== 'string' || typeof value.eventId !== 'string'
      || typeof value.agentId !== 'string' || !isRecord(value.request)) return
    const clientId = this.remoteEventClientId
    if (clientId !== undefined) this.handlers.onEventClient?.(value.eventId, clientId, value.event)
    if (value.event === 'approval/request') {
      this.handlers.onMux({
        type: 'approval/requested',
        sessionId: value.agentId,
        approvalId: value.eventId,
        toolName: typeof value.request.toolName === 'string' ? value.request.toolName : 'approval',
        ...(typeof value.request.callId === 'string' ? { callId: value.request.callId } : {}),
        ...(typeof value.request.reason === 'string' ? { reason: value.request.reason } : {}),
      }, value.eventId)
      return
    }
    if (value.event === 'user-questions/request') {
      const questions = Array.isArray(value.request.questions) ? value.request.questions : []
      this.handlers.onMux({ type: 'question/requested', sessionId: value.agentId, questions: questions as never[] }, value.eventId)
    }
  }

  private handleEmittedEvent(event: string, args: readonly unknown[]): void {
    if (event === 'api-session/added' && isRecord(args[0]) && typeof args[0].sessionId === 'string') {
      const summary = args[0]
      this.handlers.onHost({
        type: 'host/session-added',
        sessionId: summary.sessionId as string,
        ...(typeof summary.cwd === 'string' ? { cwd: summary.cwd } : {}),
        ...(typeof summary.agentPreset === 'string' ? { agentPreset: summary.agentPreset } : {}),
      }, 'events')
    } else if (event === 'api-session/removed' && typeof args[0] === 'string') {
      this.handlers.onHost({ type: 'host/session-removed', sessionId: args[0] }, 'events')
    } else if (event === 'api-session/status' && typeof args[0] === 'string' && typeof args[1] === 'boolean') {
      this.handlers.onHost({ type: 'host/session-status', sessionId: args[0], running: args[1] }, 'events')
    } else if (event === 'api-session/error' && typeof args[0] === 'string' && typeof args[1] === 'string') {
      this.handlers.onHost({ type: 'host/agent-error', sessionId: args[0], message: args[1] }, 'events')
    }
  }

  private emitSessionEvent(sessionId: string, event: import('./protocol.js').SessionEvent): void {
    this.handlers.onMux({ type: 'session/event', sessionId, event }, `session:${sessionId}`)
  }

  private rejectWorkspaceWaiters(error: Error): void {
    const waiters = this.workspaceWaiters.splice(0)
    for (const waiter of waiters) waiter.reject(error)
  }

  private reportError(spec: StreamSpec, error: Error): void {
    spec.onError?.(error)
    this.handlers.onError?.(error)
  }
}

function isSessionSnapshot(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && value.type === 'snapshot'
}

function normalizeSessionSnapshot(value: Record<string, unknown>): SessionFollowSnapshot {
  if (!Number.isSafeInteger(value.cursor) || !Array.isArray(value.records)) throw new Error('Malformed Harness session follow snapshot.')
  const projectionValues = isRecord(value.projections) && isRecord(value.projections.values) ? value.projections.values : undefined
  return {
    cursor: Number(value.cursor),
    records: value.records,
    hasMore: value.hasMore === true,
    ...(projectionValues === undefined ? {} : { projections: { values: projectionValues } }),
  }
}

function recordMap(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {}
}

type Disposable = { dispose(): void }

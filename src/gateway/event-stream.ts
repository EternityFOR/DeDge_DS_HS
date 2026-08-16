import WebSocket from 'ws'
import { parseHostFrame, parseMuxFrame, parseServerRequest, type HostFrame, type MuxFrame } from './protocol.js'
import type { Logger } from '../platform/logger.js'

export interface EventHandlers {
  readonly onMux: (frame: MuxFrame, rpcId: string) => void
  readonly onHost: (frame: HostFrame, rpcId: string) => void
  readonly onError: (error: Error) => void
}

type EventPath = '/api/events.mux' | '/api/events.host'

export class EventStream implements Disposable {
  private readonly sockets = new Set<WebSocket>()
  private readonly retryTimers = new Map<EventPath, ReturnType<typeof setTimeout>>()
  private readonly retryDelays = new Map<EventPath, number>()
  private stopped = true

  constructor(private readonly baseUrl: string, private readonly handlers: EventHandlers, private readonly logger: Logger) {}

  start(): void {
    if (!this.stopped) return
    this.stopped = false
    this.retryDelays.set('/api/events.mux', 1_000)
    this.retryDelays.set('/api/events.host', 1_000)
    this.open('/api/events.mux', true)
    this.open('/api/events.host', false)
  }

  dispose(): void {
    this.stopped = true
    for (const timer of this.retryTimers.values()) clearTimeout(timer)
    this.retryTimers.clear()
    this.retryDelays.clear()
    for (const socket of this.sockets) socket.close()
    this.sockets.clear()
  }

  private open(path: EventPath, mux: boolean): void {
    if (this.stopped) return
    const url = new URL(path, this.baseUrl)
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    const socket = new WebSocket(url.toString(), { handshakeTimeout: 5_000 })
    this.sockets.add(socket)
    socket.once('open', () => {
      this.retryDelays.set(path, 1_000)
      this.logger.info(`Connected ${path}`)
    })
    socket.on('message', data => {
      try {
        const envelope = parseServerRequest(JSON.parse(data.toString()))
        if (mux) this.handlers.onMux(parseMuxFrame(envelope.payload), envelope.rpcId)
        else this.handlers.onHost(parseHostFrame(envelope.payload), envelope.rpcId)
      } catch (error) {
        this.handlers.onError(error instanceof Error ? error : new Error(String(error)))
      }
    })
    socket.once('error', error => this.handlers.onError(error instanceof Error ? error : new Error(String(error))))
    socket.once('close', () => {
      this.sockets.delete(socket)
      if (this.stopped) return
      this.logger.warn(`${path} disconnected; reconnecting`)
      this.scheduleReconnect(path, mux)
    })
  }

  private scheduleReconnect(path: EventPath, mux: boolean): void {
    if (this.stopped || this.retryTimers.has(path)) return
    const delay = this.retryDelays.get(path) ?? 1_000
    this.retryDelays.set(path, Math.min(delay * 2, 15_000))
    const timer = setTimeout(() => {
      this.retryTimers.delete(path)
      this.open(path, mux)
    }, delay)
    this.retryTimers.set(path, timer)
  }
}

type Disposable = { dispose(): void }

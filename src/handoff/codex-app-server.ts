import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { once } from 'node:events'
import { createInterface, type Interface } from 'node:readline'
import { setTimeout as delay } from 'node:timers/promises'
import type { ExternalSessionDescriptor } from './types.js'

const REQUEST_TIMEOUT_MS = 30_000
const SHUTDOWN_GRACE_MS = 750
const STDERR_LIMIT = 8 * 1024

interface PendingRequest {
  readonly resolve: (value: unknown) => void
  readonly reject: (error: Error) => void
  readonly timeout: NodeJS.Timeout
}

export async function listCodexSessionsViaAppServer(
  executable: string,
  codexHome: string,
  limit = 50,
): Promise<ExternalSessionDescriptor[]> {
  const pageSize = Math.max(1, Math.min(100, Math.trunc(limit)))
  const client = new CodexAppServerClient(executable, codexHome)
  try {
    await client.request('initialize', {
      clientInfo: { name: 'dedge-deepseek-harness', title: 'DeDge DeepSeek Harness', version: '0.1.9' },
      capabilities: null,
    })
    client.notify('initialized')

    let response: unknown
    try {
      response = await client.request('thread/list', {
        archived: false,
        cursor: null,
        limit: pageSize,
        modelProviders: null,
        sortKey: 'recency_at',
        sourceKinds: [],
        useStateDbOnly: true,
      })
    } catch (error) {
      response = await client.request('thread/list', {
        archived: false,
        cursor: null,
        limit: pageSize,
        modelProviders: null,
        sortKey: 'updated_at',
      }).catch(() => { throw error })
    }
    return codexThreadListDescriptors(response, pageSize)
  } finally {
    await client.dispose()
  }
}

export function codexThreadListDescriptors(value: unknown, limit = 50): ExternalSessionDescriptor[] {
  if (!isRecord(value) || !Array.isArray(value.data)) throw new Error('Codex thread/list returned an invalid response.')
  const output: ExternalSessionDescriptor[] = []
  const seen = new Set<string>()
  for (const item of value.data) {
    if (!isRecord(item) || item.ephemeral === true || item.threadSource === 'ambient_suggestions') continue
    const id = stringValue(item.id)
    const filePath = stringValue(item.path)
    if (id === undefined || filePath === undefined || seen.has(id)) continue
    seen.add(id)
    const name = stringValue(item.name)
    const preview = stringValue(item.preview)
    const cwd = stringValue(item.cwd)
    const updatedAt = protocolTimestamp(item.recencyAt)
      ?? protocolTimestamp(item.updatedAt)
      ?? protocolTimestamp(item.createdAt)
      ?? 0
    output.push({
      platform: 'codex',
      source: 'active',
      id,
      title: name ?? preview ?? `Codex ${id.slice(0, 8)}`,
      filePath,
      updatedAt,
      ...(cwd === undefined ? {} : { cwd }),
    })
    if (output.length >= limit) break
  }
  return output
}

class CodexAppServerClient {
  private readonly child: ChildProcessWithoutNullStreams
  private readonly lines: Interface
  private readonly pending = new Map<string, PendingRequest>()
  private nextId = 1
  private stderr = ''
  private closed = false

  constructor(executable: string, codexHome: string) {
    this.child = spawn(executable, ['app-server', '--stdio'], {
      env: { ...process.env, CODEX_HOME: codexHome },
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    })
    this.lines = createInterface({ input: this.child.stdout, crlfDelay: Number.POSITIVE_INFINITY })
    this.child.stderr.setEncoding('utf8')
    this.child.stderr.on('data', chunk => {
      this.stderr = `${this.stderr}${String(chunk)}`.slice(-STDERR_LIMIT)
    })
    this.lines.on('line', line => { this.handleLine(line) })
    this.child.once('error', error => { this.rejectAll(error) })
    this.child.once('exit', (code, signal) => {
      if (!this.closed) this.rejectAll(new Error(`Codex app-server exited before replying (${String(code ?? signal ?? 'unknown')}).`))
    })
  }

  request(method: string, params: unknown): Promise<unknown> {
    const id = String(this.nextId++)
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`Codex app-server timed out during ${method}.${this.stderrSuffix()}`))
      }, REQUEST_TIMEOUT_MS)
      this.pending.set(id, { resolve, reject, timeout })
      this.write({ id, method, params })
    })
  }

  notify(method: string, params?: unknown): void {
    this.write(params === undefined ? { method } : { method, params })
  }

  async dispose(): Promise<void> {
    if (this.closed) return
    this.closed = true
    this.rejectAll(new Error('Codex app-server connection closed.'))
    if (!this.child.stdin.destroyed) this.child.stdin.end()
    if (this.child.exitCode === null && this.child.signalCode === null) {
      await Promise.race([once(this.child, 'exit'), delay(SHUTDOWN_GRACE_MS)])
    }
    if (this.child.exitCode === null && this.child.signalCode === null) this.child.kill()
    this.lines.close()
  }

  private write(message: Record<string, unknown>): void {
    if (this.closed || this.child.stdin.destroyed) throw new Error('Codex app-server connection is closed.')
    this.child.stdin.write(`${JSON.stringify(message)}\n`)
  }

  private handleLine(line: string): void {
    let message: unknown
    try {
      message = JSON.parse(line)
    } catch {
      return
    }
    if (!isRecord(message) || (typeof message.id !== 'string' && typeof message.id !== 'number')) return
    const id = String(message.id)
    const pending = this.pending.get(id)
    if (pending === undefined) return
    this.pending.delete(id)
    clearTimeout(pending.timeout)
    if (isRecord(message.error)) {
      pending.reject(new Error(`Codex app-server request failed: ${stringValue(message.error.message) ?? 'unknown error'}`))
    } else {
      pending.resolve(message.result)
    }
  }

  private rejectAll(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout)
      pending.reject(error)
    }
    this.pending.clear()
  }

  private stderrSuffix(): string {
    const normalized = this.stderr.replace(/\s+/gu, ' ').trim()
    return normalized === '' ? '' : ` ${normalized}`
  }
}

function protocolTimestamp(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return undefined
  return value > 10_000_000_000 ? value : value * 1_000
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

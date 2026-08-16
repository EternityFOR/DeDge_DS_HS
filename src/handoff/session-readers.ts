import { createReadStream } from 'node:fs'
import { open, readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import * as path from 'node:path'
import { createInterface } from 'node:readline'
import type { ExternalAgentPlatform, ExternalSessionDescriptor, HandoffSource, HandoffTurn } from './types.js'

const HEADER_BYTES = 256 * 1024
const TRANSCRIPT_SCAN_BYTES = 32 * 1024 * 1024
const MAX_RECORD_BYTES = 8 * 1024 * 1024
const MAX_DISCOVERED_FILES = 10_000
const DISCOVERY_BATCH_SIZE = 64

interface CodexIndexEntry {
  readonly title: string
  readonly updatedAt?: number
}

export async function listExternalSessions(
  platform: ExternalAgentPlatform,
  configuredHome: string,
  limit = 50,
): Promise<ExternalSessionDescriptor[]> {
  const home = expandUserPath(configuredHome)
  const root = platform === 'codex' ? path.join(home, 'sessions') : path.join(home, 'projects')
  const codexIndex = platform === 'codex' ? await readCodexSessionIndex(home) : new Map<string, CodexIndexEntry>()
  const files = await discoverJsonl(root)
  const withStats = await Promise.all(files.map(async filePath => {
    try {
      const value = await stat(filePath)
      return { filePath, updatedAt: value.mtimeMs }
    } catch {
      return undefined
    }
  }))
  const recent = withStats
    .filter((item): item is { readonly filePath: string; readonly updatedAt: number } => item !== undefined)
    .sort((left, right) => right.updatedAt - left.updatedAt)
  const unique = new Map<string, ExternalSessionDescriptor>()
  for (let offset = 0; offset < recent.length && unique.size < limit; offset += DISCOVERY_BATCH_SIZE) {
    const batch = recent.slice(offset, offset + DISCOVERY_BATCH_SIZE)
    const described = await Promise.all(batch.map(item => describeSession(platform, item.filePath, item.updatedAt, codexIndex)))
    for (const item of described) {
      if (item === undefined) continue
      const current = unique.get(item.id)
      if (current === undefined || item.updatedAt > current.updatedAt) unique.set(item.id, item)
    }
  }
  return [...unique.values()].sort((left, right) => right.updatedAt - left.updatedAt).slice(0, limit)
}

export async function readExternalSession(descriptor: ExternalSessionDescriptor, maxBytes: number): Promise<HandoffSource> {
  const turns: HandoffTurn[] = []
  let totalBytes = 0
  const fileStats = await stat(descriptor.filePath)
  const start = Math.max(0, fileStats.size - TRANSCRIPT_SCAN_BYTES)
  const input = createReadStream(descriptor.filePath, { encoding: 'utf8', start })
  const lines = createInterface({ input, crlfDelay: Number.POSITIVE_INFINITY })
  let discardPartialLine = start > 0
  try {
    for await (const line of lines) {
      if (discardPartialLine) {
        discardPartialLine = false
        continue
      }
      const rootType = rootRecordType(line)
      if (descriptor.platform === 'codex' && rootType === 'session_meta') {
        const metaId = codexSessionMeta(line).id
        if (metaId !== undefined && metaId !== descriptor.id) {
          throw new Error(`Codex rollout changed session ID from ${descriptor.id} to ${metaId}; refusing to merge session boundaries.`)
        }
        continue
      }
      if (descriptor.platform === 'codex' ? rootType !== 'event_msg' : rootType !== 'user' && rootType !== 'assistant') continue
      if (Buffer.byteLength(line, 'utf8') > MAX_RECORD_BYTES) continue
      const record = parseRecord(line)
      if (record === undefined) continue
      const turn = descriptor.platform === 'codex' ? codexTurn(record) : claudeTurn(record)
      if (turn === undefined) continue
      const bytes = Buffer.byteLength(turn.text, 'utf8')
      turns.push(bytes > maxBytes ? { ...turn, text: truncateUtf8(turn.text, maxBytes) } : turn)
      totalBytes += Math.min(bytes, maxBytes)
      while (turns.length > 1 && totalBytes > maxBytes) {
        const removed = turns.shift()
        if (removed !== undefined) totalBytes -= Buffer.byteLength(removed.text, 'utf8')
      }
    }
  } finally {
    lines.close()
    input.destroy()
  }
  return {
    platform: descriptor.platform,
    sessionId: descriptor.id,
    title: descriptor.title,
    turns,
    ...(descriptor.cwd === undefined ? {} : { cwd: descriptor.cwd }),
    updatedAt: descriptor.updatedAt,
  }
}

export function expandUserPath(value: string, userHome = homedir()): string {
  const normalized = value.trim()
    .replaceAll('${userHome}', userHome)
    .replaceAll('${env:HOME}', process.env.HOME ?? userHome)
    .replaceAll('${env:USERPROFILE}', process.env.USERPROFILE ?? userHome)
  if (normalized === '~') return userHome
  if (normalized.startsWith(`~${path.sep}`) || normalized.startsWith('~/') || normalized.startsWith('~\\')) {
    return path.join(userHome, normalized.slice(2))
  }
  return path.resolve(normalized)
}

async function describeSession(
  platform: ExternalAgentPlatform,
  filePath: string,
  updatedAt: number,
  codexIndex: ReadonlyMap<string, CodexIndexEntry>,
): Promise<ExternalSessionDescriptor | undefined> {
  const text = await readHeader(filePath)
  let id: string | undefined = uuidFromFilename(filePath)
  let cwd: string | undefined
  let title: string | undefined
  if (platform === 'codex') {
    const meta = codexSessionMeta(text)
    id = meta.id ?? id
    cwd = meta.cwd
    if (id !== undefined) title = codexIndex.get(id)?.title
  }
  for (const line of text.split(/\r?\n/u)) {
    const record = parseRecord(line)
    if (record === undefined) continue
    if (platform === 'codex') {
      if (record.type === 'session_meta' && isRecord(record.payload)) {
        if (!isCodexInteractiveSource(record.payload.source)) return undefined
        id = stringValue(record.payload.id) ?? stringValue(record.payload.session_id) ?? id
        cwd = stringValue(record.payload.cwd) ?? cwd
      }
      if (title === undefined && record.type === 'event_msg' && isRecord(record.payload) && record.payload.type === 'user_message') {
        title = titleFrom(stringValue(record.payload.message))
      }
    } else {
      id = stringValue(record.sessionId) ?? id
      cwd = stringValue(record.cwd) ?? cwd
      if (title === undefined && record.type === 'user' && isRecord(record.message)) title = titleFrom(contentText(record.message.content))
    }
    if (id !== undefined && title !== undefined && cwd !== undefined) break
  }
  if (id === undefined) return undefined
  const indexed = platform === 'codex' ? codexIndex.get(id) : undefined
  return {
    platform,
    source: 'active',
    id,
    title: title ?? `${platform === 'codex' ? 'Codex' : 'Claude'} ${id.slice(0, 8)}`,
    filePath,
    updatedAt: Math.max(updatedAt, indexed?.updatedAt ?? 0),
    ...(cwd === undefined ? {} : { cwd }),
  }
}

function isCodexInteractiveSource(value: unknown): boolean {
  if (value === undefined || value === null) return true
  if (value === 'cli' || value === 'vscode' || value === 'custom:atlas' || value === 'custom:chatgpt') return true
  if (!isRecord(value)) return false
  const keys = Object.keys(value)
  if (keys.length === 0) return true
  return keys.length === 1 && (value.custom === 'atlas' || value.custom === 'chatgpt')
}

async function readCodexSessionIndex(home: string): Promise<Map<string, CodexIndexEntry>> {
  const output = new Map<string, CodexIndexEntry>()
  const indexPath = path.join(home, 'session_index.jsonl')
  try {
    await stat(indexPath)
  } catch {
    return output
  }
  const input = createReadStream(indexPath, { encoding: 'utf8' })
  const lines = createInterface({ input, crlfDelay: Number.POSITIVE_INFINITY })
  input.on('error', () => lines.close())
  try {
    for await (const line of lines) {
      const record = parseRecord(line)
      const id = stringValue(record?.id)
      const title = titleFrom(stringValue(record?.thread_name))
      if (id === undefined || title === undefined) continue
      const timestamp = stringValue(record?.updated_at)
      const parsed = timestamp === undefined ? Number.NaN : Date.parse(timestamp)
      const current = output.get(id)
      if (current?.updatedAt !== undefined && Number.isFinite(parsed) && parsed < current.updatedAt) continue
      output.set(id, { title, ...(Number.isFinite(parsed) ? { updatedAt: parsed } : {}) })
    }
  } catch {
    return output
  } finally {
    lines.close()
    input.destroy()
  }
  return output
}

async function discoverJsonl(root: string): Promise<string[]> {
  const output: string[] = []
  const pending = [root]
  while (pending.length > 0 && output.length < MAX_DISCOVERED_FILES) {
    const current = pending.pop()
    if (current === undefined) break
    let entries
    try {
      entries = await readdir(current, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name)
      if (entry.isDirectory()) pending.push(fullPath)
      else if (entry.isFile() && entry.name.toLowerCase().endsWith('.jsonl')) output.push(fullPath)
      if (output.length >= MAX_DISCOVERED_FILES) break
    }
  }
  return output
}

async function readHeader(filePath: string): Promise<string> {
  const handle = await open(filePath, 'r')
  try {
    const buffer = Buffer.allocUnsafe(HEADER_BYTES)
    const result = await handle.read(buffer, 0, buffer.byteLength, 0)
    return buffer.subarray(0, result.bytesRead).toString('utf8')
  } finally {
    await handle.close()
  }
}

function codexTurn(record: Record<string, unknown>): HandoffTurn | undefined {
  if (record.type !== 'event_msg' || !isRecord(record.payload)) return undefined
  const type = record.payload.type
  const message = stringValue(record.payload.message)?.trim()
  if (message === undefined || message === '') return undefined
  if (type === 'user_message') return { role: 'user', text: message, ...timestamp(record) }
  if (type === 'agent_message' && (record.payload.phase === undefined || record.payload.phase === 'final_answer')) {
    return { role: 'assistant', text: message, ...timestamp(record) }
  }
  return undefined
}

function rootRecordType(line: string): string | undefined {
  return partialJsonString(line.slice(0, 512), 'type')
}

function codexSessionMeta(value: string): { readonly id?: string; readonly cwd?: string } {
  const prefix = value.slice(0, 16 * 1024)
  if (rootRecordType(prefix) !== 'session_meta') return {}
  const id = partialJsonString(prefix, 'session_id') ?? partialJsonString(prefix, 'id')
  const cwd = partialJsonString(prefix, 'cwd')
  return { ...(id === undefined ? {} : { id }), ...(cwd === undefined ? {} : { cwd }) }
}

function partialJsonString(value: string, key: string): string | undefined {
  const match = new RegExp(`"${key}"\\s*:\\s*("(?:[^"\\\\]|\\\\.)*")`, 'u').exec(value)
  if (match?.[1] === undefined) return undefined
  try {
    const parsed: unknown = JSON.parse(match[1])
    return stringValue(parsed)
  } catch {
    return undefined
  }
}

function claudeTurn(record: Record<string, unknown>): HandoffTurn | undefined {
  if (record.isSidechain === true || (record.type !== 'user' && record.type !== 'assistant') || !isRecord(record.message)) return undefined
  const text = contentText(record.message.content).trim()
  if (text === '') return undefined
  return { role: record.type, text, ...timestamp(record) }
}

function contentText(value: unknown): string {
  if (typeof value === 'string') return value
  if (!Array.isArray(value)) return ''
  const output: string[] = []
  for (const item of value) {
    if (isRecord(item) && item.type === 'text' && typeof item.text === 'string') output.push(item.text)
  }
  return output.join('\n')
}

function timestamp(record: Record<string, unknown>): { readonly timestamp?: string } {
  return typeof record.timestamp === 'string' ? { timestamp: record.timestamp } : {}
}

function parseRecord(line: string): Record<string, unknown> | undefined {
  if (line.trim() === '') return undefined
  try {
    const value: unknown = JSON.parse(line)
    return isRecord(value) ? value : undefined
  } catch {
    return undefined
  }
}

function titleFrom(value: string | undefined): string | undefined {
  const normalized = value?.replace(/\s+/gu, ' ').trim()
  if (normalized === undefined || normalized === '') return undefined
  return normalized.length > 80 ? `${normalized.slice(0, 77)}...` : normalized
}

function uuidFromFilename(filePath: string): string | undefined {
  return /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/iu.exec(path.basename(filePath))?.[1]
}

function truncateUtf8(value: string, maxBytes: number): string {
  const bytes = Buffer.from(value, 'utf8')
  let end = Math.min(bytes.byteLength, maxBytes)
  while (end > 0 && (bytes[end] ?? 0) >> 6 === 0b10) end--
  return `${bytes.subarray(0, end).toString('utf8')}\n[earlier content truncated]`
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

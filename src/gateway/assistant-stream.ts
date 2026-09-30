import { isRecord, type SessionEvent } from './protocol.js'

export interface LiveAssistantMessage {
  readonly id: string
  readonly role: 'assistant' | 'reasoning'
  readonly text: string
  readonly textLength?: number
  readonly seq: number
  readonly time: number
}

export interface LiveAssistantSnapshot {
  readonly revision: number
  readonly messages: readonly LiveAssistantMessage[]
}

interface Attempt {
  readonly id: string
  readonly turn: number
  readonly step: number
  readonly after: number
  nextIndex: number
  readonly blocks: Map<number, { role: 'assistant' | 'reasoning'; text: string; length: number; time: number }>
}

/** Cursorless 0.2 presentation. It never creates or advances a journal event. */
export class AssistantStreamProjection {
  private revision = -1
  private attempt: Attempt | undefined

  replace(value: unknown): LiveAssistantSnapshot {
    this.attempt = undefined
    this.revision = isRecord(value) && integer(value.revision, 0) ? value.revision : 0
    const opening = isRecord(value) && isRecord(value.activeAttempt) ? value.activeAttempt : undefined
    const attempt = opening === undefined ? undefined : this.start(opening)
    if (opening !== undefined && attempt !== undefined && Array.isArray(opening.stream)) {
      for (const record of opening.stream) {
        if (!isRecord(record)) continue
        if (record.type === 'chunk' && typeof record.time === 'number') this.chunk(record.chunk, record.time)
        else if ((record.type === 'text-chunks' || record.type === 'reasoning-chunks') && Array.isArray(record.texts)) {
          for (const text of record.texts) this.chunk({ type: record.type === 'text-chunks' ? 'text-delta' : 'reasoning-delta', index: record.index, text }, typeof record.time0 === 'number' ? record.time0 : 0)
        }
      }
      if (integer(opening.nextIndex, 0)) attempt.nextIndex = opening.nextIndex
    }
    return this.snapshot()
  }

  accept(value: unknown): LiveAssistantSnapshot | undefined {
    if (!isRecord(value) || !integer(value.revision, 0) || value.revision <= this.revision || typeof value.attemptId !== 'string') return undefined
    this.revision = value.revision
    if (value.type === 'start') {
      this.start(value)
      return this.snapshot()
    }
    const attempt = this.attempt
    if (attempt === undefined || attempt.id !== value.attemptId) return undefined
    if (value.type === 'chunk') {
      if (value.index !== attempt.nextIndex || typeof value.time !== 'number' || !Number.isFinite(value.time)) {
        this.attempt = undefined // A missing chunk must not become reordered or duplicated text.
      } else {
        attempt.nextIndex++
        this.chunk(value.chunk, value.time)
      }
    } else if (value.type === 'end') this.attempt = undefined
    else return undefined
    return this.snapshot()
  }

  retire(event: SessionEvent): LiveAssistantSnapshot | undefined {
    const attempt = this.attempt
    if (attempt === undefined || !isRecord(event.data) || event.data.turn !== attempt.turn || event.data.step !== attempt.step) return undefined
    if (event.type !== 'assistant/message' && event.type !== 'assistant/attempt' && event.type !== 'step/end') return undefined
    this.attempt = undefined
    return this.snapshot()
  }

  private start(value: Record<string, unknown>): Attempt | undefined {
    this.attempt = undefined
    if (typeof value.attemptId !== 'string' || value.attemptId === '' || !integer(value.turn, 1) || !integer(value.step, 1) || !integer(value.startedAfterSeq, -1)) return undefined
    const attempt: Attempt = { id: value.attemptId, turn: value.turn, step: value.step, after: value.startedAfterSeq, nextIndex: 0, blocks: new Map() }
    this.attempt = attempt
    return attempt
  }

  private chunk(value: unknown, time: number): void {
    const attempt = this.attempt
    if (attempt === undefined || !isRecord(value) || !integer(value.index, 0) || value.index > 1024 || typeof value.text !== 'string') return
    if (value.type !== 'text-delta' && value.type !== 'reasoning-delta') return
    const role = value.type === 'reasoning-delta' ? 'reasoning' : 'assistant'
    const block = attempt.blocks.get(value.index) ?? { role, text: '', length: 0, time }
    block.length += value.text.length
    block.text = (block.text + value.text).slice(0, 65_536)
    block.time = time
    attempt.blocks.set(value.index, block)
  }

  private snapshot(): LiveAssistantSnapshot {
    const attempt = this.attempt
    return {
      revision: this.revision,
      messages: attempt === undefined ? [] : [...attempt.blocks.entries()].sort(([a], [b]) => a - b).map(([index, block]) => ({
        id: `live:${attempt.id}:${index}:${block.role}`,
        role: block.role,
        text: block.text,
        ...(block.length > block.text.length ? { textLength: block.length } : {}),
        seq: attempt.after + 0.5,
        time: block.time,
      })),
    }
  }
}

function integer(value: unknown, minimum: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum
}

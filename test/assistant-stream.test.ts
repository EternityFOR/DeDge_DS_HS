import { describe, expect, it } from 'vitest'
import { AssistantStreamProjection } from '../src/gateway/assistant-stream.js'
import { projectMessages } from '../src/session/session-store.js'
import type { HistoryEntry } from '../src/gateway/protocol.js'

function start(projection: AssistantStreamProjection, revision = 1, attemptId = 'attempt-1') {
  return projection.accept({ type: 'start', revision, attemptId, startedAfterSeq: 4, turn: 1, step: 1 })
}

describe('cursorless Harness 0.2 assistant presentation', () => {
  it('renders reasoning and text after the durable user prefix without changing its cursor', () => {
    const projection = new AssistantStreamProjection()
    start(projection)
    projection.accept({ type: 'chunk', revision: 2, attemptId: 'attempt-1', index: 0, time: 10, chunk: { type: 'reasoning-delta', index: 0, text: 'Think' } })
    const live = projection.accept({ type: 'chunk', revision: 3, attemptId: 'attempt-1', index: 1, time: 11, chunk: { type: 'text-delta', index: 1, text: 'Answer' } })
    const history: HistoryEntry[] = [
      { event: { type: 'turn/start', seq: 1, time: 1, data: { turn: 1 } } },
      { event: { type: 'user/message', seq: 2, time: 2, data: { turn: 1, step: 1, content: [{ type: 'text', text: 'Question' }], source: { kind: 'user' } } } },
      { event: { type: 'step/start', seq: 4, time: 4, data: { turn: 1, step: 1 } } },
    ]
    const messages = projectMessages(history, { liveMessages: live?.messages.map(message => ({ ...message, status: 'streaming' })) ?? [] })
    expect(messages.map(message => message.text)).toEqual(['Question', 'Think', 'Answer'])
    expect(messages[1]?.taskId).toBe(messages[0]?.taskId)
    expect(history.map(row => row.event.seq)).toEqual([1, 2, 4])
  })

  it('reconstructs a compact reconnect prefix and accepts only the next dense chunk', () => {
    const projection = new AssistantStreamProjection()
    expect(projection.replace({ revision: 6, activeAttempt: { attemptId: 'attempt-1', turn: 1, step: 1, startedAfterSeq: 4, nextIndex: 2,
      stream: [{ type: 'text-chunks', index: 0, time0: 10, dt: [1], texts: ['Hello ', 'world'] }],
    } }).messages[0]?.text).toBe('Hello world')
    expect(projection.accept({ type: 'chunk', revision: 7, attemptId: 'attempt-1', index: 2, time: 12, chunk: { type: 'text-delta', index: 0, text: '!' } })?.messages[0]?.text).toBe('Hello world!')
    expect(projection.accept({ type: 'chunk', revision: 7, attemptId: 'attempt-1', index: 2, time: 12, chunk: { type: 'text-delta', index: 0, text: '!' } })).toBeUndefined()
    expect(projection.accept({ type: 'chunk', revision: 8, attemptId: 'attempt-1', index: 4, time: 12, chunk: { type: 'text-delta', index: 0, text: 'wrong order' } })?.messages).toEqual([])
  })

  it('retires the live attempt when its durable settlement arrives', () => {
    const projection = new AssistantStreamProjection()
    start(projection)
    projection.accept({ type: 'chunk', revision: 2, attemptId: 'attempt-1', index: 0, time: 10, chunk: { type: 'text-delta', index: 0, text: 'Partial' } })
    expect(projection.retire({ type: 'assistant/message', seq: 5, time: 11, data: { turn: 1, step: 1 } })?.messages).toEqual([])
    expect(projection.accept({ type: 'chunk', revision: 3, attemptId: 'attempt-1', index: 1, time: 12, chunk: { type: 'text-delta', index: 0, text: 'duplicate' } })).toBeUndefined()
  })

  it('clears abandoned attempts and bounds a very long live reasoning block', () => {
    const projection = new AssistantStreamProjection()
    start(projection)
    const live = projection.accept({ type: 'chunk', revision: 2, attemptId: 'attempt-1', index: 0, time: 10, chunk: { type: 'reasoning-delta', index: 0, text: 'x'.repeat(100_000) } })
    expect(live?.messages[0]?.text.length).toBe(65_536)
    expect(live?.messages[0]?.textLength).toBe(100_000)
    expect(projection.accept({ type: 'end', revision: 3, attemptId: 'attempt-1', index: 1, outcome: { kind: 'abandoned' } })?.messages).toEqual([])
  })
})

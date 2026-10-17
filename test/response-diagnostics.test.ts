import { describe, expect, it } from 'vitest'
import { emptyAttemptReasoning, isReasoningOnlyResponse } from '../src/session/response-diagnostics.js'
import { projectMessages } from '../src/session/session-store.js'
import type { HistoryEntry } from '../src/gateway/protocol.js'

const row = (type: string, seq: number, data: unknown): HistoryEntry => ({ event: { type, seq, time: seq, data } })
const reasoning = { type: 'reasoning', text: 'FINAL. Here is a conclusion.' }
const response = (content: unknown[], extra = {}) => ({ turn: 1, step: 1, message: { content, ...extra } })
const turn = (content: unknown[], kind = 'completed') => [
  row('turn/start', 1, { turn: 1 }),
  row('user/message', 2, { content: [{ type: 'text', text: 'Review' }] }),
  row('assistant/message', 3, response(content)),
  row('turn/end', 4, { turn: 1, reason: { kind } }),
]

describe('reasoning-only completion diagnostics', () => {
  const attempt = (code = 'EMPTY_RESPONSE') => ({ turn: 1, step: 1, stream: [
    { type: 'chunk', chunk: { type: 'block-end', index: 0, block: reasoning } },
    { type: 'chunk', chunk: { type: 'finish', reason: { kind: 'error', failure: { code } } } },
  ] })

  it('retains reasoning from explicit failed attempts, not unrelated errors or arbitrary streams', () => {
    expect(emptyAttemptReasoning(attempt())).toEqual([reasoning.text])
    expect(emptyAttemptReasoning(attempt('TRANSPORT'))).toEqual([])
    expect(emptyAttemptReasoning({ stream: [null, { type: 'reasoning-chunks', texts: ['unsettled'] }] })).toEqual([])
  })

  it('projects recovery without fabricating an answer or losing the received reasoning', () => {
    const entries = [
      row('turn/start', 1, { turn: 1 }),
      row('user/message', 2, { content: [{ type: 'text', text: 'Review' }] }),
      row('assistant/attempt', 3, attempt()),
      row('llm/retry', 4, { turn: 1, step: 1, retry: 1, maxRetries: 1, failure: { code: 'EMPTY_RESPONSE' } }),
      row('assistant/message', 5, response([{ type: 'text', text: 'Recovered answer' }])),
      row('turn/end', 6, { turn: 1, reason: { kind: 'completed' } }),
    ]
    const messages = projectMessages(entries)
    expect(messages.filter(x => x.role === 'user')).toHaveLength(1)
    expect(messages.filter(x => x.role === 'reasoning').map(x => x.text)).toEqual([reasoning.text])
    expect(messages.filter(x => x.role === 'assistant').map(x => x.text)).toEqual(['Recovered answer'])
    expect(messages.find(x => x.title === 'Retrying response')?.taskComplete).toBe(true)
    expect(messages.every(x => x.status !== 'streaming')).toBe(true)
  })

  it('settles exhausted retries as error without a false completed-answer notice', () => {
    const messages = projectMessages([
      row('turn/start', 1, { turn: 1 }), row('assistant/attempt', 2, attempt()),
      row('turn/end', 3, { turn: 1, reason: { kind: 'error', error: { code: 'EMPTY_RESPONSE', message: 'No final answer' } } }),
    ])
    expect(messages.some(x => x.role === 'reasoning')).toBe(true)
    expect(messages.at(-1)).toMatchObject({ status: 'error', text: 'No final answer', taskComplete: true })
    expect(messages.some(x => x.id.startsWith('reasoning-only:'))).toBe(false)
  })
  it('recognizes only nonempty reasoning without text, media or tool calls', () => {
    expect(isReasoningOnlyResponse(response([reasoning]))).toBe(true)
    expect(isReasoningOnlyResponse(response([reasoning, { type: 'text', text: '  ' }]))).toBe(true)
    for (const block of [{ type: 'text', text: 'Answer' }, { type: 'image' }, { type: 'tool-call' }, null]) {
      expect(isReasoningOnlyResponse(response([reasoning, block]))).toBe(false)
    }
    expect(isReasoningOnlyResponse(response([]))).toBe(false)
    expect(isReasoningOnlyResponse(response([{ type: 'reasoning', text: ' ' }]))).toBe(false)
    expect(isReasoningOnlyResponse(response([reasoning], { interrupted: true }))).toBe(false)
  })

  it('keeps reasoning unchanged and adds one settled diagnostic without inventing an answer', () => {
    const messages = projectMessages(turn([reasoning]))
    expect(messages.find(x => x.role === 'reasoning')?.text).toBe(reasoning.text)
    expect(messages.some(x => x.role === 'assistant')).toBe(false)
    expect(messages.filter(x => x.id.startsWith('reasoning-only:'))).toMatchObject([
      { role: 'system', status: 'complete', taskComplete: true, title: 'No final answer' },
    ])
  })

  it('does not warn while running or on cancellation and failure', () => {
    for (const entries of [turn([reasoning]).slice(0, -1), turn([reasoning], 'cancelled'), turn([reasoning], 'error')]) {
      expect(projectMessages(entries).some(x => x.id.startsWith('reasoning-only:'))).toBe(false)
    }
  })

  it('uses the final response in each turn and never infers finality from FINAL text', () => {
    const entries = turn([reasoning]).slice(0, -1)
    entries.push(row('assistant/message', 4, response([{ type: 'text', text: 'Actual answer' }])))
    entries.push(row('turn/end', 5, { turn: 1, reason: { kind: 'completed' } }))
    expect(projectMessages(entries).some(x => x.id.startsWith('reasoning-only:'))).toBe(false)
  })

  it('does not mistake tool-only steps, partial history or replaced surfaces for a missing answer', () => {
    expect(projectMessages(turn([reasoning, { type: 'tool-call', id: 'a', name: 'read' }])).some(x => x.id.startsWith('reasoning-only:'))).toBe(false)
    expect(projectMessages([row('turn/end', 1, { turn: 1, reason: { kind: 'completed' } })])).toEqual([])
    const entries = turn([reasoning])
    Object.assign(entries[2]!.event, { surfaceOp: 'replace' })
    expect(projectMessages(entries).some(x => x.id.startsWith('reasoning-only:'))).toBe(false)
  })
})

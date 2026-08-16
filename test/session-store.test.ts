import { describe, expect, it } from 'vitest'
import { SessionStore, projectMessages } from '../src/session/session-store.js'
import type { HistoryEntry, SessionEvent } from '../src/gateway/protocol.js'

function entry(type: string, seq: number, data: unknown, time = seq): HistoryEntry {
  const event: SessionEvent = { type, seq, time, data }
  return { event }
}

describe('session event projection', () => {
  it('merges streamed text, reasoning, tool calls and tool results in sequence order', () => {
    const messages = projectMessages([
      entry('user/message', 1, { content: [{ type: 'text', text: 'Inspect this file' }] }),
      entry('assistant/chunk', 2, { turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: 'Hel' } }),
      entry('assistant/chunk', 3, { turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: 'lo' } }),
      entry('assistant/chunk', 4, { turn: 1, step: 1, chunk: { type: 'reasoning-delta', index: 0, text: 'Check' } }),
      entry('tool/call', 5, { callId: 'call-1', name: 'read_file', arguments: { path: 'src/app.ts' } }),
      entry('tool/result', 6, { message: { source: { callId: 'call-1' }, content: [{ type: 'text', text: 'contents' }] } }),
    ])

    expect(messages).toEqual([
      { id: 'user:1', role: 'user', text: 'Inspect this file', seq: 1, time: 1, status: 'complete' },
      { id: 'stream:1:1:0:assistant', role: 'assistant', text: 'Hello', status: 'streaming', seq: 3, time: 2 },
      { id: 'stream:1:1:0:reasoning', role: 'reasoning', text: 'Check', status: 'streaming', seq: 4, time: 4 },
      { id: 'tool:call-1', role: 'tool', title: 'read_file', text: 'contents', status: 'complete', seq: 6, time: 5 },
    ])
  })

  it('replaces a streamed assistant message with the canonical completed blocks', () => {
    const messages = projectMessages([
      entry('assistant/chunk', 1, { turn: 2, step: 1, chunk: { type: 'text-delta', index: 0, text: 'partial' } }),
      entry('assistant/message', 2, {
        turn: 2,
        step: 1,
        message: { content: [{ type: 'text', text: 'complete' }, { type: 'reasoning', text: 'why' }] },
      }),
    ])
    expect(messages).toEqual([
      { id: 'assistant:2:0', role: 'assistant', text: 'complete', status: 'complete', seq: 2, time: 2 },
      { id: 'assistant:2:1', role: 'reasoning', text: 'why', status: 'complete', seq: 2, time: 2 },
    ])
  })

  it('projects imported context as attachment metadata instead of a full user transcript', () => {
    const messages = projectMessages([
      entry('user/message', 1, { content: [{
        type: 'text',
        text: '<editor_context kind="file" label="codex-handoff-Project.md">\n# Isolated agent handoff\nlarge transcript\n</editor_context>\n\nContinue the task.',
      }] }),
    ])
    expect(messages).toEqual([{
      id: 'user:1',
      role: 'user',
      text: 'Continue the task.',
      attachments: [{ kind: 'handoff', label: 'Codex handoff - Project' }],
      seq: 1,
      time: 1,
      status: 'complete',
    }])
  })

  it('surfaces turn errors and updates session metadata from events', () => {
    const store = new SessionStore({ provider: 'deepseek-official', model: 'deepseek-v4-flash', reasoningEffort: 'high', agentPreset: 'standard', permissionMode: 'workspace-write', contextWindowTokens: 1_000_000 })
    store.setActive('s-1')
    store.appendEvent('s-1', { type: 'session/title', seq: 1, time: 10, data: { title: 'Review' } })
    store.appendEvent('s-1', { type: 'turn/start', seq: 2, time: 11, data: {} })
    store.appendEvent('s-1', { type: 'turn/end', seq: 3, time: 12, data: { reason: { kind: 'error', error: { message: 'rate limited' } } } })

    const snapshot = store.snapshot()
    expect(snapshot.sessions).toEqual([{ id: 's-1', title: 'Review', running: false, blank: false, updatedAt: 12 }])
    expect(snapshot.messages).toEqual([{ id: 'error:3', role: 'system', text: 'rate limited', status: 'error', seq: 3, time: 12 }])
  })

  it('projects active-session catalogs and keeps duplicate question ids in separate RPC batches', () => {
    const store = new SessionStore({ provider: 'fallback', model: 'fallback-model', reasoningEffort: 'fallback-effort', agentPreset: 'standard', permissionMode: 'workspace-write', contextWindowTokens: 1_000_000 })
    store.addSession({ sessionId: 's-1', blank: true, running: false, agentPreset: 'cordis' })
    store.setActive('s-1')
    store.setModelCatalog('s-1', {
      current: { provider: 'deepseek-official', model: 'deepseek-v4' },
      routable: true,
      groups: [],
      failures: [],
    })
    store.setPresetCatalog({ presets: [{ id: 'cordis', trust: 'system', isDefault: true }], authorable: false, hasDocument: false })
    store.setContextPressure('s-1', { projectedTokens: 600_000, contextWindow: 1_000_000 })
    store.addQuestions([
      { id: 'mode', rpcId: 'rpc-1', sessionId: 's-1', question: 'First?', options: [], multiSelect: false },
      { id: 'mode', rpcId: 'rpc-2', sessionId: 's-1', question: 'Second?', options: [], multiSelect: false },
    ])

    const snapshot = store.snapshot()
    expect(snapshot).toMatchObject({ provider: 'deepseek-official', model: 'deepseek-v4', reasoningEffort: '', agentPreset: 'cordis', contextWindowTokens: 1_000_000, contextPressure: { projectedTokens: 600_000, contextWindow: 1_000_000 } })
    expect(snapshot.questions.map(question => question.rpcId)).toEqual(['rpc-1', 'rpc-2'])
    store.resolveQuestions('rpc-1')
    expect(store.snapshot().questions.map(question => question.rpcId)).toEqual(['rpc-2'])
  })

  it('hides archived sessions and clears an archived active selection', () => {
    const store = new SessionStore({ provider: 'deepseek-official', model: 'deepseek-v4-flash', reasoningEffort: 'high', agentPreset: 'standard', permissionMode: 'workspace-write', contextWindowTokens: 1_000_000 })
    store.replaceSessions([
      { sessionId: 'session-one', blank: false, running: false, updatedAt: 10 },
      { sessionId: 'session-two', blank: false, running: false, updatedAt: 20 },
    ])
    store.setActive('session-two')
    store.replaceArchivedSessions(['session-two'])

    expect(store.snapshot().activeSessionId).toBeUndefined()
    expect(store.snapshot().sessions.map(session => session.id)).toEqual(['session-one'])
  })

  it('projects a deleting operation while the underlying mutation is in flight', () => {
    const store = new SessionStore({ provider: 'deepseek-official', model: 'deepseek-v4-flash', reasoningEffort: 'high', agentPreset: 'standard', permissionMode: 'workspace-write', contextWindowTokens: 1_000_000 })
    store.addSession({ sessionId: 'session-one', blank: false, running: false })
    store.setSessionOperation('session-one', 'deleting')
    expect(store.snapshot().sessions[0]).toMatchObject({ id: 'session-one', operation: 'deleting' })
    store.setSessionOperation('session-one', undefined)
    expect(store.snapshot().sessions[0]?.operation).toBeUndefined()
  })
})

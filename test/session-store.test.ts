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

  it('keeps alpha.3 user-rpc prompts visible as human messages', () => {
    const messages = projectMessages([
      entry('user/message', 1, { source: { kind: 'user-rpc', rpcId: 'request-1' }, content: [{ type: 'text', text: 'Alpha prompt' }] }),
    ])
    expect(messages).toMatchObject([{ role: 'user', text: 'Alpha prompt' }])
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

  it('groups inserted prompts and intermediate work inside a completed task turn', () => {
    const messages = projectMessages([
      entry('user/message', 1, { source: { kind: 'user' }, content: [{ type: 'text', text: 'Start task' }] }),
      entry('turn/start', 2, {}),
      entry('assistant/message', 3, { turn: 1, step: 1, message: { content: [{ type: 'text', text: 'Working' }] } }),
      entry('user/message', 4, { source: { kind: 'user' }, content: [{ type: 'text', text: 'Steer this' }] }),
      entry('tool/call', 5, { callId: 'call-1', name: 'read_file', arguments: {} }),
      entry('assistant/message', 6, { turn: 1, step: 2, message: { content: [{ type: 'text', text: 'Final summary' }] } }),
      entry('turn/end', 7, { reason: { kind: 'complete' } }),
    ])

    expect(messages.map(message => [message.text, message.taskId, message.taskComplete])).toEqual([
      ['Start task', 'turn:2', true],
      ['Working', 'turn:2', true],
      ['Steer this', 'turn:2', true],
      ['{}', 'turn:2', true],
      ['Final summary', 'turn:2', true],
    ])
  })

  it('closes a dangling task when a later turn starts in a truncated history window', () => {
    const messages = projectMessages([
      entry('user/message', 1, { source: { kind: 'user' }, content: [{ type: 'text', text: 'Older prompt' }] }),
      entry('turn/start', 2, { turn: 1 }),
      entry('assistant/message', 3, { turn: 1, step: 1, message: { content: [{ type: 'text', text: 'Older result' }] } }),
      // The first turn/end is outside this loaded window. A new turn/start is
      // still an authoritative boundary and must not be swallowed by turn 1.
      entry('turn/start', 4, { turn: 2 }),
      entry('user/message', 5, { source: { kind: 'user' }, content: [{ type: 'text', text: 'New prompt' }] }),
      entry('assistant/message', 6, { turn: 2, step: 1, message: { content: [{ type: 'text', text: 'New result' }] } }),
      entry('turn/end', 7, { turn: 2, reason: { kind: 'completed' } }),
    ])

    expect(messages.map(message => [message.text, message.taskId, message.taskComplete])).toEqual([
      ['Older prompt', 'turn:1', true],
      ['Older result', 'turn:1', true],
      ['New prompt', 'turn:2', true],
      ['New result', 'turn:2', true],
    ])
  })

  it('marks only messages claimed from the next-step inbox as steering', () => {
    const messages = projectMessages([
      entry('agent/inbox/spliced', 1, { target: 'next-step', start: 0, inserted: [{ id: 'steer-1' }] }),
      entry('turn/start', 2, { turn: 1 }),
      entry('agent/inbox/spliced', 3, { target: 'next-step', start: 0, removedCount: 1, inserted: [] }),
      entry('user/message', 4, { id: 'steer-1', source: { kind: 'user' }, content: [{ type: 'text', text: 'Steer now' }] }),
      entry('user/message', 5, { id: 'ordinary-1', source: { kind: 'user' }, content: [{ type: 'text', text: 'Ordinary prompt' }] }),
      entry('assistant/message', 6, { turn: 1, step: 1, message: { content: [{ type: 'text', text: 'Result' }] } }),
      entry('turn/end', 7, { turn: 1, reason: { kind: 'completed' } }),
    ])

    expect(messages.find(message => message.text === 'Steer now')).toMatchObject({ inputKind: 'steering' })
    expect(messages.find(message => message.text === 'Ordinary prompt')).not.toHaveProperty('inputKind')
  })

  it('keeps autonomous goal-round prompts visible without presenting them as user steering', () => {
    const messages = projectMessages([
      entry('turn/start', 1, { turn: 1 }),
      entry('user/message', 2, { source: { kind: 'user' }, content: [{ type: 'text', text: 'Start the long-running task.' }] }),
      entry('assistant/message', 3, { turn: 1, step: 1, message: { content: [{ type: 'text', text: 'Started.' }] } }),
      entry('turn/end', 4, { turn: 1, reason: { kind: 'completed' } }),
      entry('turn/start', 5, { turn: 2 }),
      entry('user/message', 6, {
        id: 'goal-round-1',
        source: { kind: 'goal', goalId: 'goal-1', revision: 1, round: 3 },
        content: [{ type: 'text', text: '<goal_round>Resume the long-running task.</goal_round>' }],
      }),
      entry('assistant/message', 7, { turn: 2, step: 1, message: { content: [{ type: 'text', text: 'Resumed.' }] } }),
      entry('turn/end', 8, { turn: 2, reason: { kind: 'completed' } }),
    ])

    expect(messages.find(message => message.text.includes('Resume the long-running task.'))).toMatchObject({ inputKind: 'automation' })
    expect(messages.filter(message => message.taskId === 'turn:1').map(message => message.text)).toEqual(['Start the long-running task.', 'Started.'])
    expect(messages.filter(message => message.taskId === 'turn:2').map(message => message.text)).toEqual(['<goal_round>Resume the long-running task.</goal_round>', 'Resumed.'])
  })

  it('keeps scheduled follow-up prompts separate from human and steering messages', () => {
    const messages = projectMessages([
      entry('turn/start', 1, { turn: 1 }),
      entry('user/message', 2, { id: 'scheduled-1', source: { kind: 'plugin', plugin: 'schedule' }, content: [{ type: 'text', text: 'Run the scheduled market check.' }] }),
      entry('assistant/message', 3, { turn: 1, step: 1, message: { content: [{ type: 'text', text: 'Scheduled result.' }] } }),
      entry('turn/end', 4, { turn: 1, reason: { kind: 'completed' } }),
    ])

    expect(messages[0]).toMatchObject({ inputKind: 'automation', automationKind: 'schedule', taskId: 'turn:1' })
  })

  it('recovers a foldable task when a history page starts inside a turn', () => {
    const messages = projectMessages([
      entry('assistant/chunk', 100, { turn: 9, step: 4, chunk: { type: 'reasoning-delta', index: 0, text: 'Continue' } }),
      entry('step/start', 101, { turn: 9, step: 4 }),
      entry('tool/call', 102, { turn: 9, step: 4, callId: 'call-9', name: 'pwsh', arguments: { command: 'sleep' } }),
      entry('tool/result', 103, { turn: 9, step: 4, message: { source: { callId: 'call-9' }, content: [{ type: 'text', text: 'done' }] } }),
      entry('step/end', 104, { turn: 9, step: 4 }),
      entry('assistant/message', 105, { turn: 9, step: 5, message: { content: [{ type: 'text', text: 'Finished' }] } }),
    ])

    expect(messages).toHaveLength(3)
    expect(messages.map(message => [message.taskId, message.taskComplete])).toEqual([
      ['turn:9', false],
      ['turn:9', false],
      ['turn:9', false],
    ])
  })

  it('keeps a user-stopped task settled and marks the whole fold as interrupted', () => {
    const messages = projectMessages([
      entry('user/message', 1, { source: { kind: 'user' }, content: [{ type: 'text', text: 'Start a long task' }] }),
      entry('turn/start', 2, {}),
      entry('assistant/message', 3, { turn: 1, step: 1, message: { content: [{ type: 'reasoning', text: 'Partial work' }] } }),
      entry('tool/call', 4, { callId: 'call-1', name: 'read_file', arguments: {} }),
      entry('assistant/message', 5, { turn: 1, step: 2, message: { interrupted: true, content: [{ type: 'text', text: 'Stopped here.' }] } }),
    ])

    expect(messages.map(message => [message.text, message.taskId, message.taskComplete, message.taskInterrupted])).toEqual([
      ['Start a long task', 'turn:2', true, true],
      ['Partial work', 'turn:2', true, true],
      ['{}', 'turn:2', true, true],
      ['Stopped here.', 'turn:2', true, true],
    ])
  })

  it('recognizes cancelled turn-end events when no interrupted assistant message is emitted', () => {
    const messages = projectMessages([
      entry('user/message', 1, { source: { kind: 'user' }, content: [{ type: 'text', text: 'Stop me' }] }),
      entry('turn/start', 2, {}),
      entry('assistant/message', 3, { turn: 1, step: 1, message: { content: [{ type: 'text', text: 'Partial result' }] } }),
      entry('turn/end', 4, { reason: { kind: 'cancelled' } }),
    ])

    expect(messages.map(message => [message.taskComplete, message.taskInterrupted])).toEqual([
      [true, true],
      [true, true],
    ])
  })

  it('bounds verbose reasoning in workbench snapshots while retaining its original length', () => {
    const reasoning = 'x'.repeat(80_000)
    const messages = projectMessages([
      entry('assistant/message', 1, { turn: 1, step: 1, message: { content: [{ type: 'reasoning', text: reasoning }] } }),
    ])
    expect(messages[0]?.text.length).toBeLessThan(70_000)
    expect(messages[0]?.textLength).toBe(reasoning.length)
    expect(messages[0]?.text).toContain('complete event remains in Harness session data')
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

  it('keeps durable image references on historical user messages without exposing image bytes', () => {
    const messages = projectMessages([
      entry('user/message', 1, {
        source: { kind: 'user' },
        content: [
          { type: 'image', attachment: { attachmentId: 'att-1', mediaType: 'image/png', bytes: 3, width: 2, height: 2, name: 'reminder.png' } },
          { type: 'text', text: 'Continue from this reminder.' },
        ],
      }),
    ])

    expect(messages).toEqual([{
      id: 'user:1',
      role: 'user',
      text: 'Continue from this reminder.',
      attachments: [{
        kind: 'image',
        label: 'Image: reminder.png',
        detail: '2 x 2 pixels, 3 bytes',
        image: { attachmentId: 'att-1', mimeType: 'image/png', bytes: 3, width: 2, height: 2, name: 'reminder.png' },
      }],
      seq: 1,
      time: 1,
      status: 'complete',
    }])
    expect(JSON.stringify(messages)).not.toContain('base64')
  })

  it('hydrates a historical image into the active session snapshot by attachment id', () => {
    const store = new SessionStore({ provider: 'deepseek-official', model: 'deepseek-v4-flash', reasoningEffort: 'high', agentPreset: 'standard', permissionMode: 'workspace-write', contextWindowTokens: 1_000_000, pasteFileThreshold: 8_192 })
    store.addSession({ sessionId: 's-1', blank: false, running: false })
    store.setActive('s-1')
    store.replaceHistory('s-1', [entry('user/message', 1, {
      source: { kind: 'user' },
      content: [{ type: 'image', attachment: { attachmentId: 'att-1', mediaType: 'image/png', bytes: 3, width: 2, height: 2, name: 'reminder.png' } }],
    })])
    store.setHistoryImage('s-1', 'att-1', { mimeType: 'image/png', dataBase64: 'YWJj' })

    expect(store.snapshot().messages[0]?.attachments?.[0]?.image?.dataBase64).toBe('YWJj')
    expect(store.hasHistoryImage('s-1', 'att-1')).toBe(true)
  })

  it('surfaces turn errors and updates session metadata from events', () => {
    const store = new SessionStore({ provider: 'deepseek-official', model: 'deepseek-v4-flash', reasoningEffort: 'high', agentPreset: 'standard', permissionMode: 'workspace-write', contextWindowTokens: 1_000_000,
    pasteFileThreshold: 8_192, })
    store.setActive('s-1')
    store.appendEvent('s-1', { type: 'session/title', seq: 1, time: 10, data: { title: 'Review' } })
    store.appendEvent('s-1', { type: 'turn/start', seq: 2, time: 11, data: {} })
    store.appendEvent('s-1', { type: 'turn/end', seq: 3, time: 12, data: { reason: { kind: 'error', error: { message: 'rate limited' } } } })

    const snapshot = store.snapshot()
    expect(snapshot.sessions).toEqual([{ id: 's-1', title: 'Review', running: false, blank: false, updatedAt: 12 }])
    expect(snapshot.messages).toEqual([{ id: 'error:3', role: 'system', text: 'rate limited', status: 'error', seq: 3, time: 12 }])
  })

  it('retains the agent preset recorded by a session event', () => {
    const store = new SessionStore({ provider: 'deepseek-official', model: 'deepseek-v4-flash', reasoningEffort: 'high', agentPreset: 'standard', permissionMode: 'workspace-write', contextWindowTokens: 1_000_000, pasteFileThreshold: 8_192 })
    store.addSession({ sessionId: 's-1', blank: false, running: false, agentPreset: 'standard' })
    store.appendEvent('s-1', { type: 'agent-preset/selected', seq: 1, time: 10, data: { agentPreset: 'minimal' } })

    expect(store.snapshot().sessions[0]).toMatchObject({ id: 's-1', agentPreset: 'minimal' })
    store.setActive('s-1')
    expect(store.snapshot().agentPreset).toBe('minimal')
  })

  it('projects transient queue and background-job state for an idle active session', () => {
    const store = new SessionStore({ provider: 'deepseek-official', model: 'deepseek-v4-flash', reasoningEffort: 'high', agentPreset: 'standard', permissionMode: 'workspace-write', contextWindowTokens: 1_000_000, pasteFileThreshold: 8_192 })
    store.addSession({ sessionId: 's-1', blank: false, running: false })
    store.setActive('s-1')
    store.setSessionQueue('s-1', [{ id: 'wake-1', placement: 'queued', message: { source: { kind: 'plugin', plugin: 'goal' } } }, { id: 'user-1', placement: 'queued', message: { source: { kind: 'user' } } }])
    store.setSessionJobs('s-1', [{ id: 'job-1', kind: 'bash', label: 'npm test', status: 'running' }])

    expect(store.snapshot().queueItems).toEqual([
      { id: 'wake-1', placement: 'queued', sourceKind: 'plugin' },
      { id: 'user-1', placement: 'queued', sourceKind: 'user' },
    ])
    expect(store.snapshot().jobs).toEqual([{ id: 'job-1', kind: 'bash', label: 'npm test', status: 'running' }])
  })

  it('projects user queue text while redacting non-text content', () => {
    const store = new SessionStore({ provider: 'deepseek-official', model: 'deepseek-v4-flash', reasoningEffort: 'high', agentPreset: 'standard', permissionMode: 'workspace-write', contextWindowTokens: 1_000_000, pasteFileThreshold: 8_192 })
    store.addSession({ sessionId: 's-1', blank: false, running: false })
    store.setActive('s-1')
    store.setSessionQueue('s-1', [
      {
        id: 'text-1',
        placement: 'queued',
        message: { source: { kind: 'user' }, content: [{ type: 'text', text: '  Continue the review  ' }] },
      },
      {
        id: 'mixed-1',
        placement: 'queued',
        message: {
          source: { kind: 'user' },
          content: [{ type: 'text', text: 'Inspect this image' }, { type: 'image', data: 'private-base64-data' }],
        },
      },
    ])

    expect(store.snapshot().queueItems).toEqual([
      { id: 'text-1', placement: 'queued', sourceKind: 'user', text: '  Continue the review  ', preview: 'Continue the review' },
      { id: 'mixed-1', placement: 'queued', sourceKind: 'user', text: 'Inspect this image', preview: 'Inspect this image [image]', hasNonText: true },
    ])
    expect(JSON.stringify(store.snapshot().queueItems)).not.toContain('private-base64-data')
  })

  it('projects active-session catalogs and keeps duplicate question ids in separate RPC batches', () => {
    const store = new SessionStore({ provider: 'fallback', model: 'fallback-model', reasoningEffort: 'fallback-effort', agentPreset: 'standard', permissionMode: 'workspace-write', contextWindowTokens: 1_000_000,
    pasteFileThreshold: 8_192, })
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
    expect(snapshot).toMatchObject({ provider: 'deepseek-official', model: 'deepseek-v4', reasoningEffort: '', agentPreset: 'cordis', contextWindowTokens: 1_000_000, pasteFileThreshold: 8_192, contextPressure: { projectedTokens: 600_000, contextWindow: 1_000_000 } })
    expect(snapshot.questions.map(question => question.rpcId)).toEqual(['rpc-1', 'rpc-2'])
    store.resolveQuestions('rpc-1')
    expect(store.snapshot().questions.map(question => question.rpcId)).toEqual(['rpc-2'])
  })

  it('hides archived sessions and clears an archived active selection', () => {
    const store = new SessionStore({ provider: 'deepseek-official', model: 'deepseek-v4-flash', reasoningEffort: 'high', agentPreset: 'standard', permissionMode: 'workspace-write', contextWindowTokens: 1_000_000,
    pasteFileThreshold: 8_192, })
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
    const store = new SessionStore({ provider: 'deepseek-official', model: 'deepseek-v4-flash', reasoningEffort: 'high', agentPreset: 'standard', permissionMode: 'workspace-write', contextWindowTokens: 1_000_000,
    pasteFileThreshold: 8_192, })
    store.addSession({ sessionId: 'session-one', blank: false, running: false })
    store.setSessionOperation('session-one', 'deleting')
    expect(store.snapshot().sessions[0]).toMatchObject({ id: 'session-one', operation: 'deleting' })
    store.setSessionOperation('session-one', undefined)
    expect(store.snapshot().sessions[0]?.operation).toBeUndefined()
  })

  it('accumulates three earlier history pages in chronological order without duplicate boundaries', () => {
    const store = new SessionStore({ provider: 'deepseek-official', model: 'deepseek-v4-flash', reasoningEffort: 'high', agentPreset: 'standard', permissionMode: 'workspace-write', contextWindowTokens: 1_000_000,
      pasteFileThreshold: 8_192, })
    store.addSession({ sessionId: 'session-one', blank: false, running: false })
    store.setActive('session-one')
    store.replaceHistory('session-one', [
      entry('user/message', 7, { content: [{ type: 'text', text: 'Newest task' }] }),
      entry('assistant/message', 8, { turn: 4, step: 1, message: { content: [{ type: 'text', text: 'Newest result' }] } }),
    ], true)
    store.prependHistory('session-one', [
      entry('user/message', 5, { content: [{ type: 'text', text: 'Third task' }] }),
      entry('assistant/message', 6, { turn: 3, step: 1, message: { content: [{ type: 'text', text: 'Third result' }] } }),
      entry('user/message', 7, { content: [{ type: 'text', text: 'Newest task' }] }),
    ], true)
    store.prependHistory('session-one', [
      entry('user/message', 3, { content: [{ type: 'text', text: 'Second task' }] }),
      entry('assistant/message', 4, { turn: 2, step: 1, message: { content: [{ type: 'text', text: 'Second result' }] } }),
      entry('user/message', 5, { content: [{ type: 'text', text: 'Third task' }] }),
    ], true)
    store.prependHistory('session-one', [
      entry('user/message', 1, { content: [{ type: 'text', text: 'First task' }] }),
      entry('assistant/message', 2, { turn: 1, step: 1, message: { content: [{ type: 'text', text: 'First result' }] } }),
      entry('user/message', 3, { content: [{ type: 'text', text: 'Second task' }] }),
    ], false)

    expect(store.snapshot().messages.map(message => message.text)).toEqual([
      'First task', 'First result',
      'Second task', 'Second result',
      'Third task', 'Third result',
      'Newest task', 'Newest result',
    ])
    expect(store.snapshot().hasMoreHistory).toBe(false)
    expect(store.snapshot().historyExpanded).toBe(true)

    store.hideOlderHistory('session-one')

    expect(store.snapshot().messages.map(message => message.text)).toEqual([
      'Second task', 'Second result',
      'Third task', 'Third result',
      'Newest task', 'Newest result',
    ])
    expect(store.snapshot().historyExpanded).toBe(true)

    store.hideOlderHistory('session-one', true)

    expect(store.snapshot().messages.map(message => message.text)).toEqual(['Newest task', 'Newest result'])
    expect(store.snapshot().hasMoreHistory).toBe(true)
    expect(store.snapshot().historyExpanded).toBe(false)
  })

  it('does not let a replayed session-added frame mark a known non-empty session blank', () => {
    const store = new SessionStore({ provider: 'deepseek-official', model: 'deepseek-v4-flash', reasoningEffort: 'high', agentPreset: 'standard', permissionMode: 'workspace-write', contextWindowTokens: 1_000_000,
      pasteFileThreshold: 8_192, })
    store.replaceSessions([{ sessionId: 'session-one', blank: false, title: 'Existing session' }])
    store.addSession({ sessionId: 'session-one', blank: true, running: false })

    expect(store.snapshot().sessions[0]).toMatchObject({ id: 'session-one', title: 'Existing session', blank: false })
  })

  it('hide all keeps only the latest complete task even before older pages were loaded', () => {
    const store = new SessionStore({ provider: 'deepseek-official', model: 'deepseek-v4-flash', reasoningEffort: 'high', agentPreset: 'standard', permissionMode: 'workspace-write', contextWindowTokens: 1_000_000,
      pasteFileThreshold: 8_192, })
    store.addSession({ sessionId: 'session-one', blank: false, running: false })
    store.setActive('session-one')
    store.replaceHistory('session-one', [
      entry('turn/start', 1, { turn: 1 }),
      entry('user/message', 2, { content: [{ type: 'text', text: 'Older task' }] }),
      entry('assistant/message', 3, { turn: 1, step: 1, message: { content: [{ type: 'text', text: 'Older result' }] } }),
      entry('turn/end', 4, { turn: 1 }),
      entry('turn/start', 5, { turn: 2 }),
      entry('user/message', 6, { content: [{ type: 'text', text: 'Latest task' }] }),
      entry('assistant/message', 7, { turn: 2, step: 1, message: { content: [{ type: 'text', text: 'Latest result' }] } }),
      entry('turn/end', 8, { turn: 2 }),
    ], true)

    expect(store.snapshot().historyCanHideAll).toBe(true)
    store.hideOlderHistory('session-one', true)

    expect(store.snapshot().messages.map(message => message.text)).toEqual(['Latest task', 'Latest result'])
    expect(store.snapshot().historyCanHideAll).toBe(false)
    expect(store.historyBeforeSeq('session-one')).toBe(5)
  })

  it('pages from the earliest raw event even when that event is not a visible message', () => {
    const store = new SessionStore({ provider: 'deepseek-official', model: 'deepseek-v4-flash', reasoningEffort: 'high', agentPreset: 'standard', permissionMode: 'workspace-write', contextWindowTokens: 1_000_000,
      pasteFileThreshold: 8_192, })
    store.addSession({ sessionId: 'session-one', blank: false, running: false })
    store.setActive('session-one')
    store.replaceHistory('session-one', [
      entry('context/pressure', 90, { projectedTokens: 10 }),
      entry('user/message', 100, { content: [{ type: 'text', text: 'Visible message' }] }),
    ], true)

    expect(store.snapshot().messages.map(message => message.seq)).toEqual([100])
    expect(store.historyBeforeSeq('session-one')).toBe(90)
  })

  it('merges reconnect history without discarding loaded earlier pages', () => {
    const store = new SessionStore({ provider: 'deepseek-official', model: 'deepseek-v4-flash', reasoningEffort: 'high', agentPreset: 'standard', permissionMode: 'workspace-write', contextWindowTokens: 1_000_000, pasteFileThreshold: 8_192 })
    store.addSession({ sessionId: 'session-one', blank: false, running: false })
    store.setActive('session-one')
    store.replaceHistory('session-one', [
      entry('user/message', 1, { source: { kind: 'user' }, content: [{ type: 'text', text: 'Earlier task' }] }),
      entry('turn/start', 2, { turn: 1 }),
      entry('assistant/message', 3, { turn: 1, step: 1, message: { content: [{ type: 'text', text: 'Earlier result' }] } }),
    ], true)
    store.prependHistory('session-one', [
      entry('user/message', 0, { source: { kind: 'user' }, content: [{ type: 'text', text: 'Oldest task' }] }),
    ], true)

    store.mergeRecentHistory('session-one', [
      entry('turn/start', 2, { turn: 1 }),
      entry('assistant/message', 3, { turn: 1, step: 1, message: { content: [{ type: 'text', text: 'Earlier result, completed' }] } }),
      entry('turn/end', 4, { turn: 1, reason: { kind: 'completed' } }),
      entry('user/message', 5, { source: { kind: 'user' }, content: [{ type: 'text', text: 'Newest task' }] }),
    ], false)

    expect(store.snapshot().messages.map(message => message.text)).toEqual(['Oldest task', 'Earlier task', 'Earlier result, completed', 'Newest task'])
    expect(store.snapshot().hasMoreHistory).toBe(false)
    expect(store.snapshot().historyPageCount).toBe(1)
  })

  it('settles an incomplete persisted turn after an authoritative restart stop', () => {
    const store = new SessionStore({ provider: 'deepseek-official', model: 'deepseek-v4-flash', reasoningEffort: 'high', agentPreset: 'standard', permissionMode: 'workspace-write', contextWindowTokens: 1_000_000, pasteFileThreshold: 8_192 })
    store.addSession({ sessionId: 'session-one', blank: false, running: false })
    store.setActive('session-one')
    store.replaceHistory('session-one', [
      entry('user/message', 1, { source: { kind: 'user' }, content: [{ type: 'text', text: 'Interrupted task' }] }),
      entry('turn/start', 2, { turn: 1 }),
      entry('assistant/chunk', 3, { turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: 'partial' } }),
    ])

    expect(store.snapshot().messages.some(message => message.taskComplete === false)).toBe(true)
    store.markSessionStopped('session-one')

    expect(store.snapshot().messages.filter(message => message.taskComplete === false)).toHaveLength(0)
    expect(store.snapshot().messages.filter(message => message.taskInterrupted === true)).not.toHaveLength(0)
  })
})

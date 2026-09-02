import { describe, expect, it } from 'vitest'
import { isWaitingForUserMessage, shouldShowUserMessageActions } from '../src/ui/message-actions.js'
import type { WorkbenchMessage, WorkbenchSnapshot } from '../src/session/types.js'

function snapshot(messages: WorkbenchMessage[], overrides: Partial<WorkbenchSnapshot> = {}): WorkbenchSnapshot {
  return {
    phase: 'connected',
    runtime: { phase: 'ready', version: '0.1.2-alpha.3' },
    hasApiKey: true,
    sessions: [{ id: 's-1', title: 'Session', running: true, blank: false }],
    activeSessionId: 's-1',
    messages,
    hasMoreHistory: false,
    historyLoading: false,
    approvals: [],
    questions: [],
    provider: 'deepseek-official',
    model: 'deepseek-v4-flash',
    reasoningEffort: 'high',
    agentPreset: 'standard',
    permissionMode: 'workspace-write',
    permissionChanging: false,
    contextWindowTokens: 1_000_000,
    pasteFileThreshold: 4_096,
    modelCatalog: {
      current: { provider: 'deepseek-official', model: 'deepseek-v4-flash', reasoningEffort: 'high' },
      routable: true,
      groups: [],
      failures: [],
    },
    ...overrides,
  }
}

const firstPrompt: WorkbenchMessage = { id: 'u-1', role: 'user', text: 'Start', taskId: 'turn:1', taskComplete: false, seq: 1 }
const insertedPrompt: WorkbenchMessage = { id: 'u-2', role: 'user', text: 'Also do this', taskId: 'turn:1', taskComplete: false, seq: 3 }

describe('live user message actions', () => {
  it('shows waiting for the task opener even though it has no steer action', () => {
    const state = snapshot([firstPrompt])
    expect(shouldShowUserMessageActions(firstPrompt, state)).toBe(false)
    expect(isWaitingForUserMessage(firstPrompt, state)).toBe(true)
  })

  it('offers actions for intermediate and queued prompts, not the task opener', () => {
    const latest = { id: 'u-3', role: 'user' as const, text: 'Follow up', taskComplete: false, seq: 4 }
    const state = snapshot([
      firstPrompt,
      { id: 'a-1', role: 'assistant', text: 'Working', taskId: 'turn:1', taskComplete: false, seq: 2 },
      insertedPrompt,
      latest,
    ])
    expect(shouldShowUserMessageActions(firstPrompt, state)).toBe(false)
    expect(shouldShowUserMessageActions(insertedPrompt, state)).toBe(true)
    expect(shouldShowUserMessageActions(latest, state)).toBe(true)
    expect(isWaitingForUserMessage(insertedPrompt, state)).toBe(false)
    expect(isWaitingForUserMessage(latest, state)).toBe(true)
  })

  it('stops the waiting indicator once output follows the latest prompt', () => {
    const latest = { id: 'u-3', role: 'user' as const, text: 'Follow up', taskComplete: false, seq: 4 }
    const state = snapshot([
      firstPrompt,
      insertedPrompt,
      latest,
      { id: 'a-2', role: 'assistant', text: 'Answer started', taskComplete: false, seq: 5 },
    ])
    expect(isWaitingForUserMessage(latest, state)).toBe(false)
    expect(shouldShowUserMessageActions(latest, state)).toBe(true)
  })

  it('keeps the latest prompt actionable during Harness turn projection lag', () => {
    const latest: WorkbenchMessage = { id: 'u-lag', role: 'user', text: 'Steer while the tool runs', taskId: 'turn:1', taskComplete: true, seq: 4 }
    const state = snapshot([
      { ...firstPrompt, taskComplete: true },
      { id: 'tool-1', role: 'tool', text: 'Previous step finished', taskId: 'turn:1', taskComplete: true, seq: 3 },
      latest,
    ])
    expect(isWaitingForUserMessage(latest, state)).toBe(true)
    expect(shouldShowUserMessageActions(latest, state)).toBe(true)
  })

  it('does not expose controls for settled, autonomous, or unavailable messages', () => {
    const settled: WorkbenchMessage = { id: 'u-done', role: 'user', text: 'Done', taskId: 'turn:0', taskComplete: true, seq: 1 }
    const autonomous: WorkbenchMessage = { id: 'u-agent', role: 'user', text: 'Agent-owned', inputKind: 'automation', taskComplete: false, seq: 2 }
    const state = snapshot([settled, autonomous])
    expect(shouldShowUserMessageActions(settled, state)).toBe(false)
    expect(shouldShowUserMessageActions(autonomous, state)).toBe(false)
    expect(isWaitingForUserMessage(settled, state)).toBe(false)
    const { modelCatalog: _modelCatalog, ...withoutCatalog } = snapshot([{ ...insertedPrompt, id: 'u-no-catalog' }])
    expect(shouldShowUserMessageActions({ ...insertedPrompt, id: 'u-no-catalog' }, withoutCatalog)).toBe(false)
  })
})

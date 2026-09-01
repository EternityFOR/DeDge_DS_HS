import { describe, expect, it } from 'vitest'
import { hasAgentActivity, hasActiveTurn, hasAutonomousActivity, modelControlsUnavailableReason, promptUnavailableReason, steerAvailable } from '../src/session/interaction-readiness.js'
import type { WorkbenchSnapshot } from '../src/session/types.js'

function snapshot(overrides: Partial<WorkbenchSnapshot> = {}): WorkbenchSnapshot {
  return {
    phase: 'connected',
    runtime: { phase: 'ready', version: '0.1.0-rc.6', url: 'http://127.0.0.1:3210' },
    hasApiKey: true,
    sessions: [{ id: 's-1', title: 'Session', running: false, blank: true }],
    activeSessionId: 's-1',
    messages: [],
    hasMoreHistory: false,
    historyLoading: false,
    approvals: [],
    questions: [],
    provider: 'deepseek-official',
    model: 'deepseek-v4',
    reasoningEffort: 'high',
    agentPreset: 'standard',
    modelCatalog: {
      current: { provider: 'deepseek-official', model: 'deepseek-v4', reasoningEffort: 'high' },
      groups: [],
      failures: [],
      routable: true,
    },
    presetCatalog: { presets: [], authorable: false, hasDocument: false },
    permissionMode: 'workspace-write',
    permissionChanging: false,
    contextWindowTokens: 1_000_000,
    pasteFileThreshold: 8_192,
    ...overrides,
  }
}

describe('workbench interaction readiness', () => {
  it('allows sending without an active session so one can be created lazily', () => {
    const { activeSessionId: _activeSessionId, ...withoutActive } = snapshot({ sessions: [] })
    expect(promptUnavailableReason(withoutActive)).toBeUndefined()
  })

  it('allows prompts and model controls only after the active session catalog is ready', () => {
    const ready = snapshot()
    expect(promptUnavailableReason(ready)).toBeUndefined()
    expect(modelControlsUnavailableReason(ready)).toBeUndefined()
  })

  it('blocks both controls while the runtime is connecting', () => {
    const connecting = snapshot({ phase: 'connecting', runtime: { phase: 'starting' } })
    expect(promptUnavailableReason(connecting)).toContain('connecting')
    expect(modelControlsUnavailableReason(connecting)).toContain('connects')
  })

  it('blocks delayed prompt submission until the model catalog arrives', () => {
    const { modelCatalog: _modelCatalog, ...loading } = snapshot()
    expect(promptUnavailableReason(loading)).toContain('model catalog')
    expect(modelControlsUnavailableReason(loading)).toContain('still loading')
  })

  it('allows steer prompts while a response is running but blocks model changes', () => {
    const running = snapshot({ sessions: [{ id: 's-1', title: 'Session', running: true, blank: false }] })
    expect(promptUnavailableReason(running)).toBeUndefined()
    expect(steerAvailable(running)).toBe(true)
    expect(modelControlsUnavailableReason(running)).toContain('Finish or cancel')
  })

  it('does not offer steering before the model catalog is ready', () => {
    const { modelCatalog: _modelCatalog, ...loading } = snapshot({ sessions: [{ id: 's-1', title: 'Session', running: true, blank: false }] })
    expect(steerAvailable(loading)).toBe(false)
  })

  it('offers steering only for a running session', () => {
    expect(steerAvailable(snapshot())).toBe(false)
  })

  it('keeps a stop path for an autonomous task between running projections', () => {
    const waiting = snapshot({ messages: [{ id: 'task-1', role: 'assistant', text: 'Waiting.', taskId: 'turn:1', taskComplete: false }] })
    expect(hasActiveTurn(waiting)).toBe(true)
    expect(promptUnavailableReason(waiting)).toContain('autonomous task')
    expect(modelControlsUnavailableReason(waiting)).toContain('agent task')
  })

  it('treats interrupted historical output as settled after a restart', () => {
    const stopped = snapshot({
      messages: [{ id: 'task-1', role: 'assistant', text: 'Stopped output.', taskId: 'turn:1', taskComplete: false, taskInterrupted: true }],
    })
    expect(hasActiveTurn(stopped)).toBe(false)
    expect(hasAutonomousActivity(stopped)).toBe(false)
    expect(hasAgentActivity(stopped)).toBe(false)
  })

  it('recognizes official queue and background-job frames while session status is idle', () => {
    const queue = snapshot({ queueItems: [{ id: 'agent-1', placement: 'queued', sourceKind: 'plugin' }] })
    expect(hasAutonomousActivity(queue)).toBe(true)
    expect(hasAgentActivity(queue)).toBe(true)
    expect(promptUnavailableReason(queue)).toContain('autonomous task')

    const job = snapshot({ jobs: [{ id: 'bash-1', kind: 'bash', label: 'running task', status: 'running' }] })
    expect(hasAutonomousActivity(job)).toBe(true)
    expect(hasAgentActivity(job)).toBe(true)

    const userQueue = snapshot({ queueItems: [{ id: 'user-1', placement: 'queued', sourceKind: 'user' }] })
    expect(hasAutonomousActivity(userQueue)).toBe(false)
  })

  it('allows an explicit steer while an autonomous job is attached to the running agent', () => {
    const runningWithJob = snapshot({
      sessions: [{ id: 's-1', title: 'Session', running: true, blank: false }],
      jobs: [{ id: 'sleep-1', kind: 'pwsh', label: 'scheduled wait', status: 'running' }],
    })
    expect(steerAvailable(runningWithJob)).toBe(true)
    expect(promptUnavailableReason(runningWithJob)).toContain('autonomous task')
    expect(promptUnavailableReason(runningWithJob, { allowSteer: true })).toBeUndefined()
  })

  it('does not expose stale autonomous controls while the shared runtime is offline', () => {
    const disconnected = snapshot({
      runtime: { phase: 'idle' },
      messages: [{ id: 'task-1', role: 'assistant', text: 'Last visible output', taskId: 'turn:1', taskComplete: false }],
      jobs: [{ id: 'job-1', kind: 'goal', label: 'Goal', status: 'running' }],
    })
    expect(hasAutonomousActivity(disconnected)).toBe(false)
    expect(hasAgentActivity(disconnected)).toBe(false)
  })

  it('keeps model controls available when the current model is not routable', () => {
    const unavailable = snapshot({ modelCatalog: { current: { provider: 'deepseek-official', model: 'missing' }, groups: [], failures: [], routable: false } })
    expect(promptUnavailableReason(unavailable)).toContain('available model')
    expect(modelControlsUnavailableReason(unavailable)).toBeUndefined()
  })
})

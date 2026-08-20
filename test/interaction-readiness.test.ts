import { describe, expect, it } from 'vitest'
import { modelControlsUnavailableReason, promptUnavailableReason, steerAvailable } from '../src/session/interaction-readiness.js'
import type { WorkbenchSnapshot } from '../src/session/types.js'

function snapshot(overrides: Partial<WorkbenchSnapshot> = {}): WorkbenchSnapshot {
  return {
    phase: 'connected',
    runtime: { phase: 'ready', version: '0.1.0-rc.6', url: 'http://127.0.0.1:3210' },
    hasApiKey: true,
    sessions: [{ id: 's-1', title: 'Session', running: false, blank: true }],
    activeSessionId: 's-1',
    messages: [],
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

  it('keeps model controls available when the current model is not routable', () => {
    const unavailable = snapshot({ modelCatalog: { current: { provider: 'deepseek-official', model: 'missing' }, groups: [], failures: [], routable: false } })
    expect(promptUnavailableReason(unavailable)).toContain('available model')
    expect(modelControlsUnavailableReason(unavailable)).toBeUndefined()
  })
})

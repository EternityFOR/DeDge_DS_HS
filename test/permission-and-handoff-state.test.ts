import { describe, expect, it } from 'vitest'
import { parsePermissionProjection } from '../src/gateway/protocol.js'
import { parsePendingHandoffState } from '../src/handoff/pending-handoff.js'
import { SessionStore } from '../src/session/session-store.js'

describe('permission projection', () => {
  it('uses the active session permission instead of the global default', () => {
    const store = new SessionStore({
      provider: 'deepseek-official',
      model: 'deepseek-v4-flash',
      reasoningEffort: 'high',
      agentPreset: 'standard',
      permissionMode: 'workspace-write',
      contextWindowTokens: 1_000_000,
    pasteFileThreshold: 8_192,
    })
    store.addSession({ sessionId: 'session-1', running: false, blank: true })
    store.setActive('session-1')
    const permissions = parsePermissionProjection({
      currentValue: 'danger-full-access',
      options: [
        { value: 'workspace-write', name: 'Workspace write' },
        { value: 'danger-full-access', name: 'Full access', description: 'No sandbox' },
      ],
    })
    expect(permissions).toBeDefined()
    store.setPermissions('session-1', permissions)

    expect(store.snapshot()).toMatchObject({
      permissionMode: 'danger-full-access',
      permissionChanging: false,
      permissionOptions: expect.arrayContaining([expect.objectContaining({ value: 'danger-full-access' })]),
    })
  })

  it('rejects malformed permission projections', () => {
    expect(parsePermissionProjection({ currentValue: 'workspace-write', options: [{ value: 'workspace-write' }] })).toBeUndefined()
    expect(parsePermissionProjection({ currentValue: 'workspace-write', options: [] })).toBeUndefined()
  })
})

describe('pending handoff state', () => {
  it('round-trips a session-bound unsent Codex handoff', () => {
    const value = {
      version: 1,
      sessionId: 'harness-session',
      draft: {
        sourcePlatform: 'codex',
        sourceTitle: 'Imported task',
        prompt: 'Continue from the attachment.',
        attachmentName: 'codex-handoff-imported-task.md',
        attachmentText: '# Isolated agent handoff\n',
      },
    }
    expect(parsePendingHandoffState(value)).toEqual(value)
  })

  it('rejects incomplete or unsupported persisted data', () => {
    expect(parsePendingHandoffState({ version: 1, sessionId: 'x', draft: { sourcePlatform: 'deepseek-harness' } })).toBeUndefined()
    expect(parsePendingHandoffState({ version: 2, sessionId: 'x', draft: {} })).toBeUndefined()
  })
})

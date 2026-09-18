import { describe, expect, it } from 'vitest'
import { SessionStore, type StoreConfiguration } from '../src/session/session-store.js'

const configuration: StoreConfiguration = {
  provider: 'deepseek-official',
  model: 'deepseek-v4-flash',
  reasoningEffort: 'high',
  agentPreset: 'standard',
  permissionMode: 'workspace-write',
  approvalPolicy: 'ask',
  contextWindowTokens: 1_000_000,
  pasteFileThreshold: 8_192,
}

describe('session tab order', () => {
  it('uses the persisted user order and keeps a one-click blank session first', () => {
    const store = new SessionStore(configuration)
    store.replaceSessions([
      { sessionId: 'a', title: 'A', updatedAt: 3 },
      { sessionId: 'b', title: 'B', updatedAt: 2 },
      { sessionId: 'new', title: 'New session', blank: true, updatedAt: 1 },
    ])
    store.setSessionOrder(['b', 'a'])
    expect(store.snapshot().sessions.map(session => session.id)).toEqual(['new', 'b', 'a'])
  })
})
import { describe, expect, it } from 'vitest'
import { filterWorkspaceSessions, sessionBelongsToWorkspace } from '../src/session/session-scope.js'

describe('workspace-scoped session lists', () => {
  it('matches a session to the exact normalized workspace identity', () => {
    expect(sessionBelongsToWorkspace({ cwd: 'D:\\Work\\App\\' }, 'd:/work/app')).toBe(true)
    expect(sessionBelongsToWorkspace({ cwd: 'd:\\work\\other' }, 'D:\\Work\\App')).toBe(false)
  })

  it('keeps cwd-less sessions visible so a new blank session is not hidden', () => {
    expect(sessionBelongsToWorkspace({}, 'D:\\Work\\App')).toBe(true)
  })

  it('filters a mixed gateway session list before it reaches the workbench', () => {
    const sessions = [
      { sessionId: 'a', cwd: 'D:\\Work\\App' },
      { sessionId: 'b', cwd: 'D:\\Work\\Other' },
      { sessionId: 'c' },
    ]
    expect(filterWorkspaceSessions(sessions, 'd:/work/app').map(item => item.sessionId)).toEqual(['a', 'c'])
  })
})
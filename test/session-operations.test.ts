import { describe, expect, it, vi } from 'vitest'
import { SessionOperationCoordinator } from '../src/session/session-operations.js'

describe('session operation coordination', () => {
  it('deduplicates concurrent work for one session and exposes start/finish state', async () => {
    const events: string[] = []
    const coordinator = new SessionOperationCoordinator({
      onStart: (id, operation) => events.push(`start:${id}:${operation}`),
      onFinish: (id, operation) => events.push(`finish:${id}:${operation}`),
    })
    let release: (() => void) | undefined
    const gate = new Promise<void>(resolve => { release = resolve })
    const action = vi.fn(async () => {
      await gate
      return 'moved'
    })

    const first = coordinator.run('session-1', 'deleting', action)
    const second = coordinator.run('session-1', 'deleting', action)

    expect(second).toBe(first)
    expect(action).not.toHaveBeenCalled()
    await Promise.resolve()
    expect(action).toHaveBeenCalledTimes(1)
    expect(() => coordinator.run('session-1', 'archiving', async () => undefined)).toThrow('deleting is already in progress')

    release?.()
    await expect(first).resolves.toBe('moved')
    expect(events).toEqual(['start:session-1:deleting', 'finish:session-1:deleting'])
    await expect(coordinator.run('session-1', 'deleting', async () => 'again')).resolves.toBe('again')
  })

  it('retains a successful cancellation until the runtime reports idle', async () => {
    const finished = vi.fn()
    const coordinator = new SessionOperationCoordinator({ onStart: vi.fn(), onFinish: finished })
    const first = coordinator.run('session-2', 'cancelling', async () => undefined, { retainOnSuccess: true })
    await first

    expect(coordinator.run('session-2', 'cancelling', async () => undefined)).toBe(first)
    expect(finished).not.toHaveBeenCalled()
    coordinator.finish('session-2', 'cancelling')
    expect(finished).toHaveBeenCalledWith('session-2', 'cancelling')
  })
})

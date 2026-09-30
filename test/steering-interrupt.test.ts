import type { Agent } from '@deepseek-ai/dsh-agent'
import { describe, expect, it } from 'vitest'
import { ForegroundSteeringInterrupt } from '../src/runtime/steering-interrupt.js'

type Message = Agent['inbox']['nextStep'][number]

function message(id: string, kind = 'user'): Message {
  return { id, source: { kind }, content: [{ type: 'text', text: id }] } as unknown as Message
}

function subject(id: string): { agent: Agent; queued: Message[]; steering: Message[] } {
  const queued: Message[] = []
  const steering: Message[] = []
  return {
    agent: { id, status: 'running', inbox: { nextTurn: queued, nextStep: steering } } as unknown as Agent,
    queued,
    steering,
  }
}

describe('foreground shell steering bridge', () => {
  it.each(['pwsh', 'bash', 'terminal_send'])('interrupts %s without cancelling the turn or consuming queued input', async name => {
    const bridge = new ForegroundSteeringInterrupt()
    const { agent, queued, steering } = subject('active')
    queued.push(message('later-1'), message('later-2'))
    const turn = new AbortController()
    const execution = { agent, name, signal: turn.signal }
    let delegated: AbortSignal | undefined
    const running = bridge.execute(execution, () => new Promise<string>(resolve => {
      delegated = execution.signal
      execution.signal.addEventListener('abort', () => resolve('interrupted'), { once: true })
    }))
    const prompt = message('steer-now')
    steering.push(prompt)
    bridge.inserted(agent, prompt)
    await expect(running).resolves.toBe('interrupted')
    expect(delegated?.aborted).toBe(true)
    expect(turn.signal.aborted).toBe(false)
    expect(execution.signal).toBe(turn.signal)
    expect(queued.map(item => item.id)).toEqual(['later-1', 'later-2'])
    expect(steering.map(item => item.id)).toEqual(['steer-now'])
  })

  it('does not interrupt for an ordinary queue message, a plugin injection, or another session', async () => {
    const bridge = new ForegroundSteeringInterrupt()
    const owner = subject('owner')
    const other = subject('other')
    const execution = { agent: owner.agent, name: 'pwsh', signal: new AbortController().signal }
    let finish: (() => void) | undefined
    const running = bridge.execute(execution, () => new Promise<void>(resolve => { finish = resolve }))
    const queued = message('queued')
    owner.queued.push(queued)
    bridge.inserted(owner.agent, queued)
    const plugin = message('plugin-context', 'plugin')
    owner.steering.push(plugin)
    bridge.inserted(owner.agent, plugin)
    const foreign = message('foreign-steer')
    other.steering.push(foreign)
    bridge.inserted(other.agent, foreign)
    expect(execution.signal.aborted).toBe(false)
    finish?.()
    await running
  })

  it.each(['str_replace_editor', 'job_run', 'schedule_create'])('does not wrap or cancel %s', async name => {
    const bridge = new ForegroundSteeringInterrupt()
    const { agent, steering } = subject('owner')
    const original = new AbortController().signal
    const execution = { agent, name, signal: original }
    await bridge.execute(execution, async () => {
      const prompt = message('steer')
      steering.push(prompt)
      bridge.inserted(agent, prompt)
      expect(execution.signal).toBe(original)
      expect(execution.signal.aborted).toBe(false)
    })
  })

  it('does not start another foreground command when user steering is already pending', async () => {
    const bridge = new ForegroundSteeringInterrupt()
    const { agent, steering } = subject('owner')
    steering.push(message('pending-steer'))
    const original = new AbortController().signal
    const execution = { agent, name: 'pwsh', signal: original }
    await bridge.execute(execution, async () => { expect(execution.signal.aborted).toBe(true) })
    expect(execution.signal).toBe(original)
  })

  it('propagates user Pause and restores the original signal after a wrapper failure', async () => {
    const bridge = new ForegroundSteeringInterrupt()
    const { agent } = subject('owner')
    const turn = new AbortController()
    const execution = { agent, name: 'pwsh', signal: turn.signal }
    await expect(bridge.execute(execution, async () => {
      turn.abort(new Error('Pause'))
      expect(execution.signal.aborted).toBe(true)
      throw new Error('tool failure')
    })).rejects.toThrow('tool failure')
    expect(execution.signal).toBe(turn.signal)
  })

  it('aborts live wrappers on disposal without aborting the owning turn', async () => {
    const bridge = new ForegroundSteeringInterrupt()
    const { agent } = subject('owner')
    const turn = new AbortController()
    const execution = { agent, name: 'pwsh', signal: turn.signal }
    const running = bridge.execute(execution, () => new Promise<void>(resolve => {
      execution.signal.addEventListener('abort', () => resolve(), { once: true })
    }))
    bridge.dispose()
    await running
    expect(turn.signal.aborted).toBe(false)
  })
})

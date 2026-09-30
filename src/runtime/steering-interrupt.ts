import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ToolDispatchExecution } from '@deepseek-ai/dsh-tools'

export const name = 'dedge-steering-interrupt'
export const inject = ['agents', 'tools']

// Interrupt only cooperative foreground shell operations. Never abort file
// mutations, background jobs, timers, or the owning Agent's turn signal.
const FOREGROUND_SHELL_TOOLS = new Set(['bash', 'pwsh', 'terminal_open', 'terminal_send', 'terminal_read'])

type SteeringMessage = Agent['inbox']['nextStep'][number]
type ShellExecution = Pick<ToolDispatchExecution, 'agent' | 'name' | 'signal'>

/** Around-dispatch bridge using the public Harness tools/execute contract. */
export class ForegroundSteeringInterrupt {
  private readonly active = new Map<Agent, Set<AbortController>>()

  async execute<T>(execution: ShellExecution, next: () => Promise<T>): Promise<T> {
    const agent = execution.agent
    if (agent === undefined || !FOREGROUND_SHELL_TOOLS.has(execution.name)) return next()
    const original = execution.signal
    const interrupt = new AbortController()
    const controllers = this.active.get(agent) ?? new Set<AbortController>()
    this.active.set(agent, controllers)
    controllers.add(interrupt)
    execution.signal = AbortSignal.any([original, interrupt.signal])
    try {
      // A steer may have arrived while this call awaited approval or while
      // another tool in the same step ran. Do not start another long command.
      if (agent.inbox.nextStep.some(message => message.source.kind === 'user')) {
        interrupt.abort(new Error('Foreground command interrupted by user steering input.'))
      }
      return await next()
    } finally {
      execution.signal = original
      controllers.delete(interrupt)
      if (controllers.size === 0) this.active.delete(agent)
    }
  }

  inserted(agent: Agent, message: SteeringMessage): void {
    if (agent.status !== 'running' || message.source.kind !== 'user') return
    // Inbox notifications do not include placement. Consult the committed
    // projection so normal next-turn queue input cannot interrupt a command.
    if (!agent.inbox.nextStep.some(pending => pending.id === message.id)) return
    for (const interrupt of this.active.get(agent) ?? []) {
      interrupt.abort(new Error('Foreground command interrupted by user steering input.'))
    }
  }

  dispose(): void {
    for (const controllers of this.active.values()) {
      for (const interrupt of controllers) interrupt.abort(new Error('Steering bridge was disposed.'))
    }
    this.active.clear()
  }
}

export function apply(ctx: Context): void {
  const bridge = new ForegroundSteeringInterrupt()
  ctx.on('tools/execute', (execution, next) => bridge.execute(execution, next))
  ctx.on('agent/inbox/inserted', ({ agent, message }) => bridge.inserted(agent, message))
  ctx.effect(() => () => bridge.dispose())
}

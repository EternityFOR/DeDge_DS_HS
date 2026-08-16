import type { SessionOperation } from './types.js'

interface ActiveSessionOperation {
  readonly operation: SessionOperation
  readonly task: Promise<unknown>
}

export interface SessionOperationHooks {
  readonly onStart: (sessionId: string, operation: SessionOperation) => void
  readonly onFinish: (sessionId: string, operation: SessionOperation) => void
}

export class SessionOperationCoordinator {
  private readonly active = new Map<string, ActiveSessionOperation>()

  constructor(private readonly hooks: SessionOperationHooks) {}

  run<T>(
    sessionId: string,
    operation: SessionOperation,
    action: () => Promise<T>,
    options: { readonly retainOnSuccess?: boolean } = {},
  ): Promise<T> {
    const current = this.active.get(sessionId)
    if (current !== undefined) {
      if (current.operation === operation) return current.task as Promise<T>
      throw new Error(`Session operation ${current.operation} is already in progress.`)
    }

    const actionTask = Promise.resolve().then(action)
    let trackedTask: Promise<T>
    trackedTask = actionTask.then(
      value => {
        if (options.retainOnSuccess !== true) this.finishTask(sessionId, operation, trackedTask)
        return value
      },
      error => {
        this.finishTask(sessionId, operation, trackedTask)
        throw error
      },
    )
    this.active.set(sessionId, { operation, task: trackedTask })
    this.hooks.onStart(sessionId, operation)
    return trackedTask
  }

  finish(sessionId: string, operation?: SessionOperation): void {
    const current = this.active.get(sessionId)
    if (current === undefined || (operation !== undefined && current.operation !== operation)) return
    this.active.delete(sessionId)
    this.hooks.onFinish(sessionId, current.operation)
  }

  clear(operation?: SessionOperation): void {
    for (const [sessionId, current] of [...this.active]) {
      if (operation === undefined || current.operation === operation) this.finish(sessionId, current.operation)
    }
  }

  private finishTask(sessionId: string, operation: SessionOperation, task: Promise<unknown>): void {
    const current = this.active.get(sessionId)
    if (current?.operation !== operation || current.task !== task) return
    this.active.delete(sessionId)
    this.hooks.onFinish(sessionId, operation)
  }
}

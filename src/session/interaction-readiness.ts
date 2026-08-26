import type { WorkbenchQueueItem, WorkbenchSnapshot } from './types.js'

export function promptUnavailableReason(snapshot: WorkbenchSnapshot): string | undefined {
  if (snapshot.phase !== 'connected' || snapshot.runtime.phase !== 'ready') {
    return 'Wait for the Harness runtime to finish connecting before sending.'
  }
  const active = snapshot.sessions.find(session => session.id === snapshot.activeSessionId)
  // Sending without an active session creates one with the configured defaults.
  if (active === undefined) return undefined
  if (active.operation !== undefined) return 'Wait for the current session operation to finish before sending.'
  if (hasAutonomousActivity(snapshot)) return 'The agent is continuing an autonomous task. Stop it or wait for the task to finish before sending.'
  if (snapshot.permissionChanging) return 'Wait for the file permission change to finish before sending.'
  if (snapshot.modelCatalog === undefined) return 'Wait for the model catalog to finish loading before sending.'
  if (snapshot.modelCatalog.routable === false) return 'Select an available model before sending.'
  return undefined
}

/** A running session accepts a steer prompt that the model handles immediately. */
export function steerAvailable(snapshot: WorkbenchSnapshot): boolean {
  const active = snapshot.sessions.find(session => session.id === snapshot.activeSessionId)
  return active?.running === true
    && active.operation === undefined
    && !snapshot.permissionChanging
    && snapshot.modelCatalog !== undefined
    && snapshot.modelCatalog.routable !== false
}

/** True while the projected conversation still contains an unfinished Harness turn. */
export function hasActiveTurn(snapshot: WorkbenchSnapshot): boolean {
  return snapshot.messages.some(message => message.status === 'streaming' || message.taskComplete === false)
}

/** Queue items owned by Harness plugins/agents rather than the user composer. */
export function autonomousQueueItems(snapshot: WorkbenchSnapshot): readonly WorkbenchQueueItem[] {
  return snapshot.queueItems?.filter(item => item.placement === 'context' || (item.sourceKind !== undefined && item.sourceKind !== 'user')) ?? []
}

/** True when Harness has work that can continue after the visible turn is idle. */
export function hasAutonomousActivity(snapshot: WorkbenchSnapshot): boolean {
  if (hasActiveTurn(snapshot)) {
    const active = snapshot.sessions.find(session => session.id === snapshot.activeSessionId)
    if (active?.running !== true) return true
  }
  if (snapshot.jobs?.some(job => job.status === 'running' || job.status === 'stopping')) return true
  return autonomousQueueItems(snapshot).length > 0
}

/** True for either an ordinary response or an autonomous/background task. */
export function hasAgentActivity(snapshot: WorkbenchSnapshot): boolean {
  const active = snapshot.sessions.find(session => session.id === snapshot.activeSessionId)
  return active?.running === true || hasActiveTurn(snapshot) || hasAutonomousActivity(snapshot)
}

export function modelControlsUnavailableReason(snapshot: WorkbenchSnapshot): string | undefined {
  if (snapshot.phase !== 'connected' || snapshot.runtime.phase !== 'ready') return 'Models are available after the Harness runtime connects.'
  if (snapshot.modelCatalog === undefined) return 'The model catalog is still loading.'
  const active = snapshot.sessions.find(session => session.id === snapshot.activeSessionId)
  if (active === undefined) return 'Models are available after an active Harness session is ready.'
  if (active?.running === true || hasActiveTurn(snapshot) || hasAutonomousActivity(snapshot)) return 'Finish or cancel the current agent task before changing the model.'
  if (active?.operation !== undefined) return 'Wait for the current session operation before changing the model.'
  if (snapshot.permissionChanging) return 'Wait for the file permission change before changing the model.'
  return undefined
}

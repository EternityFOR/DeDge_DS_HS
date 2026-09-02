import { steerAvailable } from '../session/interaction-readiness.js'
import type { WorkbenchMessage, WorkbenchSnapshot } from '../session/types.js'

/** Whether a user message can be edited or steered into the active task. */
export function shouldShowUserMessageActions(message: WorkbenchMessage, snapshot: WorkbenchSnapshot): boolean {
  if (!isEligibleUserMessage(message, snapshot)) return false
  const activeTaskIds = new Set(snapshot.messages
    .filter(item => item.taskId !== undefined && item.taskInterrupted !== true && item.taskComplete !== true)
    .map(item => item.taskId as string))
  const latest = latestUser(snapshot)
  // During the gap between a steer/follow-up receipt and the next projected
  // turn event, Harness can temporarily mark the latest task complete. Keep
  // that task actionable while the session is authoritative running.
  if (activeTaskIds.size === 0 && latest?.taskId !== undefined) activeTaskIds.add(latest.taskId)
  if (message.taskId !== undefined) {
    if (!activeTaskIds.has(message.taskId)) return false
    // The first prompt owns the active turn. Follow-up/injected prompts are
    // the ones the user may still edit or steer, matching Codex's behavior.
    const firstPrompt = snapshot.messages
      .filter(item => item.role === 'user' && item.inputKind !== 'automation' && item.taskId === message.taskId && item.taskInterrupted !== true)
      .sort((left, right) => (left.seq ?? Number.MAX_SAFE_INTEGER) - (right.seq ?? Number.MAX_SAFE_INTEGER))[0]
    return firstPrompt?.id !== message.id
  }
  return latestUser(snapshot)?.id === message.id
}

/** Whether one user message is waiting for the active Harness turn to answer. */
export function isWaitingForUserMessage(message: WorkbenchMessage, snapshot: WorkbenchSnapshot): boolean {
  if (!isRunningUserMessage(message, snapshot)) return false
  if (latestUser(snapshot)?.id !== message.id) return false
  const sequence = message.seq
  return sequence === undefined || !snapshot.messages.some(item => item.seq !== undefined && item.seq > sequence
    && (item.role === 'assistant' || item.role === 'reasoning' || item.role === 'tool'))
}

function isEligibleUserMessage(message: WorkbenchMessage, snapshot: WorkbenchSnapshot): boolean {
  if (message.role !== 'user' || message.inputKind === 'automation' || message.text.trim() === '' || message.taskInterrupted === true) return false
  if (!isRunningUserMessage(message, snapshot)) return false
  return steerAvailable(snapshot)
}

function isRunningUserMessage(message: WorkbenchMessage, snapshot: WorkbenchSnapshot): boolean {
  if (message.role !== 'user' || message.inputKind === 'automation' || message.text.trim() === '' || message.taskInterrupted === true) return false
  const active = snapshot.sessions.find(session => session.id === snapshot.activeSessionId)
  return active?.running === true
    && active.operation === undefined
}

function latestUser(snapshot: WorkbenchSnapshot): WorkbenchMessage | undefined {
  return snapshot.messages.filter(message => message.role === 'user' && message.taskInterrupted !== true).at(-1)
}

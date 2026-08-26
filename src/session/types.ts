import type { RuntimeState } from '../runtime/types.js'
import type { ContextPressureProjection, ModelCatalog, PermissionProjection, PresetCatalog } from '../gateway/protocol.js'

export type WorkbenchPhase = 'idle' | 'connecting' | 'connected' | 'error'
export type SessionOperation = 'archiving' | 'deleting' | 'cancelling' | 'compacting'

export interface WorkbenchMessageAttachment {
  readonly kind: 'selection' | 'file' | 'diagnostics' | 'handoff' | 'vision'
  readonly label: string
  readonly uri?: string
  readonly detail?: string
  readonly model?: string
}

export type WorkbenchSendProgress =
  | { readonly type: 'vision-start'; readonly label: string; readonly model: string }
  | { readonly type: 'vision-complete'; readonly label: string; readonly model: string; readonly text: string }

export interface WorkbenchMessage {
  readonly id: string
  readonly role: 'user' | 'assistant' | 'reasoning' | 'tool' | 'system'
  readonly text: string
  readonly textLength?: number
  readonly attachments?: readonly WorkbenchMessageAttachment[]
  readonly title?: string
  readonly status?: 'streaming' | 'complete' | 'error'
  readonly seq?: number
  readonly time?: number
  readonly taskId?: string
  readonly taskComplete?: boolean
  /** The user stopped this task before Harness produced a normal completion. */
  readonly taskInterrupted?: boolean
}

/** A pending inbox item projected from Harness's transient session/queue frame. */
export interface WorkbenchQueueItem {
  readonly id: string
  readonly placement: 'queued' | 'steering' | 'context' | string
  /** Harness message source kind. User messages are user-controlled; other kinds are agent-owned. */
  readonly sourceKind?: string
  /** Text projection used by the queue dock and the paused-session resume path. */
  readonly text?: string
  /** Display-safe flattened preview of non-text or mixed queue content. */
  readonly preview?: string
  /** True when the queue message contains blocks the inline editor cannot preserve. */
  readonly hasNonText?: boolean
}

export type WorkbenchJobStatus = 'running' | 'stopping' | 'completed' | 'killed' | 'failed' | string

/** A background job projected from Harness's transient session/jobs frame. */
export interface WorkbenchJob {
  readonly id: string
  readonly kind: string
  readonly label: string
  readonly status: WorkbenchJobStatus
}

export interface WorkbenchSession {
  readonly id: string
  readonly title: string
  readonly running: boolean
  readonly blank: boolean
  readonly updatedAt?: number
  readonly cwd?: string
  readonly agentPreset?: string
  readonly operation?: SessionOperation
}

export interface PendingApproval {
  readonly id: string
  readonly rpcId: string
  readonly sessionId: string
  readonly toolName: string
  readonly reason?: string
}

export interface PendingQuestion {
  readonly id: string
  readonly rpcId: string
  readonly sessionId: string
  readonly question: string
  readonly header?: string
  readonly detail?: string
  readonly options: readonly { readonly label: string; readonly description?: string }[]
  readonly multiSelect: boolean
}

export interface QuestionAnswer {
  readonly id: string
  readonly selected: readonly string[]
  readonly custom?: string
}

export interface WorkbenchSnapshot {
  readonly phase: WorkbenchPhase
  readonly runtime: RuntimeState
  readonly hasApiKey: boolean
  readonly sessions: readonly WorkbenchSession[]
  readonly activeSessionId?: string
  readonly messages: readonly WorkbenchMessage[]
  /** Pending transient inbox items for the active session, when Harness exposes them. */
  readonly queueItems?: readonly WorkbenchQueueItem[]
  /** Background jobs visible to the active agent, when Harness exposes them. */
  readonly jobs?: readonly WorkbenchJob[]
  readonly hasMoreHistory: boolean
  readonly historyExpanded?: boolean
  readonly historyPageCount?: number
  readonly historyCanHideAll?: boolean
  readonly historyLoading: boolean
  readonly approvals: readonly PendingApproval[]
  readonly questions: readonly PendingQuestion[]
  readonly provider: string
  readonly model: string
  readonly reasoningEffort: string
  readonly agentPreset: string
  readonly modelCatalog?: ModelCatalog
  readonly presetCatalog?: PresetCatalog
  readonly permissionMode: string
  readonly approvalPolicy?: string
  readonly permissionOptions?: PermissionProjection['options']
  readonly permissionChanging: boolean
  readonly contextWindowTokens: number
  readonly pasteFileThreshold: number
  readonly scheduleEnabled?: boolean
  readonly contextPressure?: ContextPressureProjection
  readonly error?: string
}

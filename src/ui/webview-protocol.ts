import type { ContextAttachment } from '../context/context-collector.js'
import type { QuestionAnswer, WorkbenchSnapshot } from '../session/types.js'

export type HostToWebviewMessage =
  | { readonly type: 'state'; readonly state: WorkbenchSnapshot; readonly attachments: readonly ContextAttachment[] }
  | { readonly type: 'setDraft'; readonly text: string }
  | { readonly type: 'notice'; readonly level: 'info' | 'warning' | 'error'; readonly message: string }

export type WebviewToHostMessage =
  | { readonly type: 'ready' }
  | { readonly type: 'send'; readonly text: string }
  | { readonly type: 'newSession' }
  | { readonly type: 'selectSession'; readonly sessionId: string }
  | { readonly type: 'manageSession'; readonly sessionId: string }
  | { readonly type: 'cancel' }
  | { readonly type: 'compact' }
  | { readonly type: 'configureContextWindow' }
  | { readonly type: 'handoff' }
  | { readonly type: 'start' }
  | { readonly type: 'restart' }
  | { readonly type: 'stop' }
  | { readonly type: 'setApiKey' }
  | { readonly type: 'attachSelection' }
  | { readonly type: 'attachDiagnostics' }
  | { readonly type: 'attachFile' }
  | { readonly type: 'attachUris'; readonly uris: readonly string[] }
  | { readonly type: 'attachTextFiles'; readonly files: readonly { readonly name: string; readonly text: string }[] }
  | { readonly type: 'removeAttachment'; readonly id: string }
  | { readonly type: 'approve'; readonly approvalId: string; readonly outcome: 'allowed-once' | 'rejected' }
  | { readonly type: 'answerQuestions'; readonly rpcId: string; readonly answers: readonly QuestionAnswer[] }
  | { readonly type: 'selectModel'; readonly provider: string; readonly model: string; readonly reasoningEffort?: string }
  | { readonly type: 'selectPreset'; readonly preset: string }
  | { readonly type: 'selectPermission'; readonly permission: string }
  | { readonly type: 'showLogs' }
  | { readonly type: 'reviewChanges' }
  | { readonly type: 'diagnose' }

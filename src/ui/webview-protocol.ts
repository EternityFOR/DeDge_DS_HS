import type { ContextAttachment } from '../context/context-collector.js'
import type { SkillSummary } from '../skills/skill-catalog.js'
import type { QuestionAnswer, WorkbenchSendProgress, WorkbenchSnapshot } from '../session/types.js'

/** Legacy internal prompt inspection types retained for protocol compatibility; no UI entry is exposed. */
export interface PromptInspectionLayer { readonly id: string; readonly label: string; readonly source: string; readonly detail: string; readonly text: string; readonly bytes: number; readonly enabled: boolean }
export interface PromptInspection { readonly scope: string; readonly limitation: string; readonly layers: readonly PromptInspectionLayer[] }

export interface WorkbenchSettings {
  readonly baseUrl: string
  readonly hasApiKey: boolean
  readonly visionBaseUrl: string
  readonly visionModel: string
  readonly visionReasoningEffort: string
  readonly visionModels: readonly string[]
  readonly mainModelVisionCapable: boolean
  readonly auxiliaryVisionEnabled: boolean
  readonly compactionProvider: string
  readonly compactionModel: string
  readonly hasVisionApiKey: boolean
  readonly pasteFileThreshold: number
  readonly contextWindowTokens: number
  readonly scheduleEnabled: boolean
  readonly codexHome: string
  readonly claudeHome: string
  readonly handoffLaunchMode: 'clipboard' | 'cli'
  readonly skillDirectories: readonly string[]
}


export type HostToWebviewMessage =
  | { readonly type: 'state'; readonly state: WorkbenchSnapshot; readonly attachments: readonly ContextAttachment[] }
  | { readonly type: 'sendStarted'; readonly text: string; readonly attachments: readonly { readonly label: string }[]; readonly mode?: 'queue' | 'steer' }
  | { readonly type: 'sendProgress'; readonly progress: WorkbenchSendProgress }
  | { readonly type: 'sendSettled'; readonly accepted: boolean; readonly text: string }
  | { readonly type: 'queueActionSettled'; readonly itemId: string; readonly accepted: boolean }
  | { readonly type: 'setDraft'; readonly text: string }
  | { readonly type: 'notice'; readonly level: 'info' | 'warning' | 'error'; readonly message: string }
  | { readonly type: 'visionAttention' }
  | { readonly type: 'promptInspection'; readonly inspection: PromptInspection }
  | { readonly type: 'skills'; readonly skills: readonly SkillSummary[] }
  | { readonly type: 'settings'; readonly settings: WorkbenchSettings; readonly open?: boolean; readonly section?: 'connection' | 'vision' | 'context' | 'handoff' | 'skills' }

export type WebviewToHostMessage =
  | { readonly type: 'ready' }
  | { readonly type: 'send'; readonly text: string; readonly mode?: 'queue' | 'steer' }
  | { readonly type: 'steerQueueItem'; readonly itemId: string }
  | { readonly type: 'removeQueueItem'; readonly itemId: string }
  | { readonly type: 'editQueueItem'; readonly itemId: string; readonly text: string }
  | { readonly type: 'newSession' }
  | { readonly type: 'selectSession'; readonly sessionId: string }
  | { readonly type: 'loadOlderHistory' }
  | { readonly type: 'loadAllHistory' }
  | { readonly type: 'hideOlderHistory' }
  | { readonly type: 'hideAllOlderHistory' }
  | { readonly type: 'manageSession'; readonly sessionId: string }
  | { readonly type: 'cancel' }
  | { readonly type: 'compact' }
  | { readonly type: 'configureContextWindow' }
  | { readonly type: 'handoff' }
  | { readonly type: 'start' }
  | { readonly type: 'restart' }
  | { readonly type: 'stop' }
  | { readonly type: 'setApiKey' }
  | { readonly type: 'openSettings' }
  | { readonly type: 'openVisionSettings' }
  | { readonly type: 'saveSettings'; readonly settings: WorkbenchSettings & { readonly apiKey?: string; readonly visionApiKey?: string } }
  | { readonly type: 'attachFile' }
  | { readonly type: 'attachExternalFile' }
  | { readonly type: 'attachUris'; readonly uris: readonly string[] }
  | { readonly type: 'attachTextFiles'; readonly files: readonly { readonly name: string; readonly text: string }[] }
  | { readonly type: 'attachImageFiles'; readonly files: readonly { readonly name: string; readonly dataUrl: string }[] }
  | { readonly type: 'listSkills' }
  | { readonly type: 'removeAttachment'; readonly id: string }
  | { readonly type: 'openAttachment'; readonly id?: string; readonly uri?: string }
  | { readonly type: 'approve'; readonly approvalId: string; readonly outcome: 'allowed-once' | 'rejected' }
  | { readonly type: 'answerQuestions'; readonly rpcId: string; readonly answers: readonly QuestionAnswer[] }
  | { readonly type: 'selectModel'; readonly provider: string; readonly model: string; readonly reasoningEffort?: string }
  | { readonly type: 'refreshModelCatalog' }
  | { readonly type: 'selectPreset'; readonly preset: string }
  | { readonly type: 'selectPermission'; readonly permission: string }
  | { readonly type: 'setVisionEnabled'; readonly enabled: boolean }
  | { readonly type: 'setScheduleEnabled'; readonly enabled: boolean }
  | { readonly type: 'selectCompactionModel'; readonly provider: string; readonly model: string }
  | { readonly type: 'showLogs' }
  | { readonly type: 'reviewChanges' }
  | { readonly type: 'diagnose' }

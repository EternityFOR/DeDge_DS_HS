import type { StagedHandoff } from './types.js'

export interface PendingHandoffState {
  readonly version: 1
  readonly sessionId: string
  readonly draft: StagedHandoff
}

export function parsePendingHandoffState(value: unknown): PendingHandoffState | undefined {
  if (!isRecord(value) || value.version !== 1 || typeof value.sessionId !== 'string' || !isRecord(value.draft)) return undefined
  const draft = value.draft
  if ((draft.sourcePlatform !== 'codex' && draft.sourcePlatform !== 'claude')
    || typeof draft.sourceTitle !== 'string'
    || typeof draft.prompt !== 'string'
    || typeof draft.attachmentName !== 'string'
    || typeof draft.attachmentText !== 'string') return undefined
  return {
    version: 1,
    sessionId: value.sessionId,
    draft: {
      sourcePlatform: draft.sourcePlatform,
      sourceTitle: draft.sourceTitle,
      prompt: draft.prompt,
      attachmentName: draft.attachmentName,
      attachmentText: draft.attachmentText,
    },
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

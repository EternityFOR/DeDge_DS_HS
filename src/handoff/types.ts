export type AgentPlatform = 'deepseek-harness' | 'codex' | 'claude'
export type ExternalAgentPlatform = Exclude<AgentPlatform, 'deepseek-harness'>

export interface HandoffTurn {
  readonly role: 'user' | 'assistant'
  readonly text: string
  readonly timestamp?: string
}

export interface ExternalSessionDescriptor {
  readonly platform: ExternalAgentPlatform
  readonly source: 'active'
  readonly id: string
  readonly title: string
  readonly filePath: string
  readonly updatedAt: number
  readonly cwd?: string
}

export interface HandoffSource {
  readonly platform: AgentPlatform
  readonly sessionId: string
  readonly title: string
  readonly turns: readonly HandoffTurn[]
  readonly cwd?: string
  readonly updatedAt?: number
}

export interface HandoffPackage {
  readonly version: 1
  readonly id: string
  readonly createdAt: string
  readonly source: HandoffSource
  readonly workspaceFolders: readonly string[]
}

export interface StoredHandoff {
  readonly value: HandoffPackage
  readonly directory: string
  readonly jsonPath: string
  readonly markdownPath: string
}

export interface StagedHandoff {
  readonly sourcePlatform: ExternalAgentPlatform
  readonly sourceTitle: string
  readonly prompt: string
  readonly attachmentName: string
  readonly attachmentText: string
}

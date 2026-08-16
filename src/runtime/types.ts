export type RuntimePhase = 'idle' | 'resolving' | 'starting' | 'ready' | 'stopping' | 'error'

export interface RuntimeState {
  readonly phase: RuntimePhase
  readonly url?: string
  readonly version?: string
  readonly error?: string
  readonly pid?: number
}

export interface RuntimeLaunch {
  readonly command: string
  readonly args: readonly string[]
  readonly environment: NodeJS.ProcessEnv
  readonly version: string
  readonly source: 'bundled' | 'external'
  readonly diagnostics: readonly string[]
}


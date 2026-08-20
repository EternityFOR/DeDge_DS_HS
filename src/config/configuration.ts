import * as vscode from 'vscode'

export type RuntimeMode = 'bundled' | 'external'
export type PermissionMode = 'read-only' | 'workspace-write' | 'danger-full-access'
export type ReasoningEffort = string

export const OFFICIAL_DEEPSEEK_BASE_URL = 'https://api.deepseek.com/'
export const DEFAULT_CONTEXT_WINDOW_TOKENS = 1_000_000

export interface HarnessConfiguration {
  readonly runtimeMode: RuntimeMode
  readonly runtimeCommand: string
  readonly runtimeNodePath: string
  readonly startTimeoutMs: number
  readonly provider: string
  readonly model: string
  readonly reasoningEffort: ReasoningEffort
  readonly agentPreset: string
  readonly permissionMode: PermissionMode
  readonly baseUrl: string
  readonly autoStart: boolean
  readonly contextMaxBytes: number
  readonly contextWindowTokens: number
  readonly codexHome: string
  readonly claudeHome: string
  readonly codexCommand: string
  readonly claudeCommand: string
  readonly handoffMaxBytes: number
  readonly handoffLaunchMode: 'clipboard' | 'cli'
  readonly skillDirectories: readonly string[]
  readonly visionBaseUrl: string
  readonly visionModel: string
  readonly visionMaxBytes: number
}

const PREFIX = 'dedgeDeepSeekHarness'

export class ConfigurationService implements vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<HarnessConfiguration>()
  private readonly subscription: vscode.Disposable

  readonly onDidChange = this.changed.event

  constructor() {
    this.subscription = vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration(PREFIX)) this.changed.fire(this.get())
    })
  }

  get(): HarnessConfiguration {
    const config = vscode.workspace.getConfiguration(PREFIX)
    const baseUrl = configuredBaseUrl(config.get<string>('baseUrl', OFFICIAL_DEEPSEEK_BASE_URL))
    return {
      runtimeMode: oneOf(config.get<string>('runtime.mode'), ['bundled', 'external'], 'bundled'),
      runtimeCommand: config.get<string>('runtime.command', '').trim(),
      runtimeNodePath: config.get<string>('runtime.nodePath', '').trim(),
      startTimeoutMs: bounded(config.get<number>('runtime.startTimeoutMs'), 5_000, 300_000, 90_000),
      provider: nonEmpty(config.get<string>('provider'), 'deepseek-official'),
      model: nonEmpty(config.get<string>('model'), 'deepseek-v4-flash'),
      reasoningEffort: nonEmpty(config.get<string>('reasoningEffort'), 'high'),
      agentPreset: nonEmpty(config.get<string>('agentPreset'), 'standard'),
      permissionMode: oneOf(
        config.get<string>('permissionMode'),
        ['read-only', 'workspace-write', 'danger-full-access'],
        'workspace-write',
      ),
      baseUrl,
      autoStart: config.get<boolean>('autoStart', true),
      contextMaxBytes: bounded(config.get<number>('context.maxBytes'), 1_024, 131_072, 32_768),
      contextWindowTokens: bounded(config.get<number>('context.windowTokens'), 16_384, 16_000_000, DEFAULT_CONTEXT_WINDOW_TOKENS),
      codexHome: nonEmpty(config.get<string>('handoff.codexHome'), '${userHome}/.codex'),
      claudeHome: nonEmpty(config.get<string>('handoff.claudeHome'), '${userHome}/.claude'),
      codexCommand: config.get<string>('handoff.codexCommand', '').trim(),
      claudeCommand: config.get<string>('handoff.claudeCommand', '').trim(),
      handoffMaxBytes: bounded(config.get<number>('handoff.maxBytes'), 8_192, 262_144, 65_536),
      handoffLaunchMode: oneOf(config.get<string>('handoff.launchMode'), ['clipboard', 'cli'], 'clipboard'),
      skillDirectories: stringList(config.get<string[]>('skills.directories'), ['${userHome}/.codex/skills']),
      visionBaseUrl: config.get<string>('vision.baseUrl', '').trim(),
      visionModel: nonEmpty(config.get<string>('vision.model'), 'qwen-vl-plus'),
      visionMaxBytes: bounded(config.get<number>('vision.maxBytes'), 65_536, 8_388_608, 4_194_304),
    }
  }

  update<K extends 'provider' | 'model' | 'reasoningEffort' | 'agentPreset' | 'permissionMode' | 'baseUrl'>(
    key: K,
    value: HarnessConfiguration[K],
  ): Thenable<void> {
    return vscode.workspace.getConfiguration(PREFIX).update(key, value, vscode.ConfigurationTarget.Global)
  }

  updateContextWindowTokens(value: number): Thenable<void> {
    return vscode.workspace.getConfiguration(PREFIX).update('context.windowTokens', value, vscode.ConfigurationTarget.Global)
  }

  dispose(): void {
    this.subscription.dispose()
    this.changed.dispose()
  }
}

export function normalizeBaseUrl(value: string): string {
  const normalized = value.trim()
  if (normalized === '') throw new Error('The API base URL cannot be empty.')
  let url: URL
  try {
    url = new URL(normalized)
  } catch {
    throw new Error('Enter a valid absolute API base URL.')
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('The API base URL must use http or https.')
  }
  if (url.username !== '' || url.password !== '') throw new Error('The API base URL must not contain credentials.')
  return url.toString()
}

export function parseTokenCount(value: string): number {
  const match = /^\s*(\d+(?:\.\d+)?)\s*([kKmM]?)\s*$/u.exec(value)
  if (match === null) throw new Error('Enter a token count such as 256K, 1M, or 1000000.')
  const amount = Number(match[1])
  const suffix = match[2]?.toLowerCase()
  const multiplier = suffix === 'm' ? 1_000_000 : suffix === 'k' ? 1_000 : 1
  const tokens = amount * multiplier
  if (!Number.isSafeInteger(tokens) || tokens < 16_384 || tokens > 16_000_000) {
    throw new Error('Context window must be an integer from 16,384 to 16,000,000 tokens.')
  }
  return tokens
}

function configuredBaseUrl(value: string | undefined): string {
  try {
    return normalizeBaseUrl(value ?? OFFICIAL_DEEPSEEK_BASE_URL)
  } catch {
    return OFFICIAL_DEEPSEEK_BASE_URL
  }
}

function stringList(value: string[] | undefined, fallback: readonly string[]): readonly string[] {
  const items = (Array.isArray(value) ? value : fallback).map(item => item.trim()).filter(item => item !== '')
  return items.length > 0 ? items : fallback
}

function nonEmpty(value: string | undefined, fallback: string): string {
  const normalized = value?.trim()
  return normalized === undefined || normalized === '' ? fallback : normalized
}

function bounded(value: number | undefined, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
    ? Math.trunc(value)
    : fallback
}

function oneOf<const T extends string>(value: string | undefined, options: readonly T[], fallback: T): T {
  return options.includes(value as T) ? value as T : fallback
}

import { describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { EXPECTED_DSH_VERSION, parseNodeVersion, supportsHarnessNode, supportsHarnessVersion } from '../src/runtime/bundled-runtime.js'
import { copyMissingTree, normalizeProviderBaseUrl, recoverMissingAttachments } from '../src/runtime/runtime-manager.js'
import { describeWindowsExitCode } from '../src/runtime/windows-compat.js'
import { renderRuntimeOverlay } from '../src/runtime/overlay.js'
import type { HarnessConfiguration } from '../src/config/configuration.js'

describe('bundled Node compatibility', () => {
  it('parses a trimmed Node version while preserving its raw version', () => {
    expect(parseNodeVersion('  v22.19.0\r\n')).toEqual({
      major: 22,
      minor: 19,
      patch: 0,
      raw: 'v22.19.0',
    })
  })

  it('rejects versions without a semantic version prefix', () => {
    expect(() => parseNodeVersion('22')).toThrow('Cannot parse Node version')
    expect(() => parseNodeVersion('')).toThrow('<empty>')
  })

  it('accepts the pinned minimum and Node 24+, but not older releases', () => {
    expect(supportsHarnessNode({ major: 22, minor: 18 })).toBe(false)
    expect(supportsHarnessNode({ major: 22, minor: 19 })).toBe(true)
    expect(supportsHarnessNode({ major: 24, minor: 0 })).toBe(true)
    expect(supportsHarnessNode({ major: 25, minor: 1 })).toBe(true)
    expect(supportsHarnessNode({ major: 23, minor: 11 })).toBe(false)
  })
})

describe('Harness runtime compatibility', () => {
  it('pins the bundled runtime to the current upstream release', () => {
    expect(EXPECTED_DSH_VERSION).toBe('0.1.2-alpha.3')
  })

  it('accepts RC revisions on the same protocol base', () => {
    expect(supportsHarnessVersion('0.1.0-rc.6', '0.1.0-rc.7')).toBe(true)
    expect(supportsHarnessVersion('0.1.0-rc.7', '0.1.0-rc.6')).toBe(true)
  })

  it('rejects different protocol bases and malformed versions', () => {
    expect(supportsHarnessVersion('0.1.0-rc.7', '0.2.0-rc.1')).toBe(false)
    expect(supportsHarnessVersion('0.1.0-rc.7', 'unknown')).toBe(false)
  })

  it('removes only trailing provider slashes for alpha.3 URL composition', () => {
    expect(normalizeProviderBaseUrl('https://api.deepseek.com/')).toBe('https://api.deepseek.com')
    expect(normalizeProviderBaseUrl('https://gateway.example/v1///')).toBe('https://gateway.example/v1')
    expect(normalizeProviderBaseUrl('https://gateway.example/v1')).toBe('https://gateway.example/v1')
  })

  it('restores missing attachment objects without replacing current files', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'dedge-attachment-migration-'))
    try {
      const source = path.join(root, 'old', 'attachments')
      const target = path.join(root, 'new', 'attachments')
      await mkdir(path.join(source, 'v1', 'objects', 'aa'), { recursive: true })
      await mkdir(path.join(target, 'v1', 'objects', 'aa'), { recursive: true })
      await writeFile(path.join(source, 'v1', 'objects', 'aa', 'new-object'), 'old-data')
      await writeFile(path.join(source, 'v1', 'objects', 'aa', 'existing'), 'old-copy')
      await writeFile(path.join(target, 'v1', 'objects', 'aa', 'existing'), 'current-data')
      await expect(copyMissingTree(source, target)).resolves.toBe(1)
      await expect(readFile(path.join(target, 'v1', 'objects', 'aa', 'new-object'), 'utf8')).resolves.toBe('old-data')
      await expect(readFile(path.join(target, 'v1', 'objects', 'aa', 'existing'), 'utf8')).resolves.toBe('current-data')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('searches every prior Harness home when an intermediate migration omitted attachments', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'dedge-attachment-history-'))
    try {
      const homes = path.join(root, 'homes')
      const target = path.join(homes, '0.1.2-alpha.3')
      const older = path.join(homes, '0.1.1-rc.1', 'attachments', 'v1', 'objects', 'aa')
      const middle = path.join(homes, '0.1.1-rc.2', 'attachments', 'v1', 'objects', 'bb')
      await mkdir(older, { recursive: true })
      await mkdir(middle, { recursive: true })
      await writeFile(path.join(older, 'from-older'), 'older')
      await writeFile(path.join(middle, 'from-middle'), 'middle')
      await expect(recoverMissingAttachments(homes, ['0.1.1-rc.1', '0.1.1-rc.2'], target)).resolves.toBe(2)
      await expect(readFile(path.join(target, 'attachments', 'v1', 'objects', 'aa', 'from-older'), 'utf8')).resolves.toBe('older')
      await expect(readFile(path.join(target, 'attachments', 'v1', 'objects', 'bb', 'from-middle'), 'utf8')).resolves.toBe('middle')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})

describe('Windows process diagnostics', () => {
  it('maps both unsigned and signed Windows startup codes', () => {
    expect(describeWindowsExitCode(0xc0000142)).toContain('0xC0000142')
    expect(describeWindowsExitCode(0xc0000142 | 0)).toContain('0xC0000142')
    expect(describeWindowsExitCode(0xe0434352)).toContain('0xE0434352')
    expect(describeWindowsExitCode(0xe0434352 | 0)).toContain('0xE0434352')
  })

  it('leaves ordinary exits and a signal-only exit without a special diagnosis', () => {
    expect(describeWindowsExitCode(0)).toBeUndefined()
    expect(describeWindowsExitCode(1)).toBeUndefined()
    expect(describeWindowsExitCode(null)).toBeUndefined()
  })
})

describe('runtime overlay rendering', () => {
  it('quotes user-controlled YAML scalar values as JSON strings', () => {
    const configuration: HarnessConfiguration = {
      runtimeMode: 'bundled',
      runtimeCommand: '',
      runtimeNodePath: '',
      startTimeoutMs: 90_000,
      provider: 'deepseek: "official"\n  injected: true',
      model: 'model\\path',
      reasoningEffort: 'high',
      agentPreset: 'preset #1',
      permissionMode: 'workspace-write',
      baseUrl: 'https://api.deepseek.com/',
      autoStart: true,
      scheduleEnabled: false,
      contextMaxBytes: 32_768,
      contextWindowTokens: 1_000_000,
      codexHome: '${userHome}/.codex',
      claudeHome: '${userHome}/.claude',
      codexCommand: '',
      claudeCommand: '',
      handoffMaxBytes: 65_536,
      handoffLaunchMode: 'clipboard',
      skillDirectories: ['${userHome}/.codex/skills'],
      visionBaseUrl: '',
      visionModel: 'qwen-vl-plus',
      visionReasoningEffort: '',
      visionMaxBytes: 4_194_304,
      pasteFileThreshold: 8_192,
    }

    const overlay = renderRuntimeOverlay(configuration)
    expect(overlay).toContain('provider: "deepseek: \\\"official\\\"\\n  injected: true"')
    expect(overlay).toContain('model: "model\\\\path"')
    expect(overlay).toContain('default: "preset #1"')
    expect(overlay).toContain('defaultContextWindow: 1000000')
    expect(overlay).toContain('contextWindow: 1000000')
    expect(overlay).not.toContain('injected: true\n')
  })

  it('advertises both official DeepSeek models while retaining a custom selected model', () => {
    const configuration = {
      runtimeMode: 'bundled', runtimeCommand: '', runtimeNodePath: '', startTimeoutMs: 90_000,
      provider: 'deepseek-official', model: 'private-reasoner', reasoningEffort: 'high', agentPreset: 'standard',
      permissionMode: 'workspace-write', approvalPolicy: 'ask', baseUrl: 'https://api.deepseek.com/', autoStart: true,
      scheduleEnabled: false,
      contextMaxBytes: 32_768, contextWindowTokens: 1_000_000, pasteFileThreshold: 4_096,
      codexHome: '${userHome}/.codex', claudeHome: '${userHome}/.claude', codexCommand: '', claudeCommand: '',
      handoffMaxBytes: 65_536, handoffLaunchMode: 'clipboard', skillDirectories: ['${userHome}/.codex/skills'],
      visionBaseUrl: '', visionModel: '', visionReasoningEffort: '', visionMaxBytes: 4_194_304,
    } satisfies HarnessConfiguration
    const overlay = renderRuntimeOverlay(configuration)
    expect(overlay).toContain('id: "deepseek-v4-flash"')
    expect(overlay).toContain('id: "deepseek-v4-pro"')
    expect(overlay).toContain('id: "deepseek-v4-flash-vision-exp"')
    expect(overlay).toContain('id: "private-reasoner"')
    expect(overlay).toContain('apiKeyEnv: "DEEPSEEK_API_KEY"')
    expect(overlay).toContain('baseURL: "https://api.deepseek.com"')
  })

  it('mounts the generic pi-ai route for non-DeepSeek providers', () => {
    const configuration = {
      runtimeMode: 'bundled', runtimeCommand: '', runtimeNodePath: '', startTimeoutMs: 90_000,
      provider: 'openai', model: 'gpt-5-mini', reasoningEffort: 'high', agentPreset: 'standard',
      permissionMode: 'workspace-write', approvalPolicy: 'ask', baseUrl: 'https://gateway.example/v1/', autoStart: true,
      scheduleEnabled: false,
      contextMaxBytes: 32_768, contextWindowTokens: 1_000_000, pasteFileThreshold: 4_096,
      codexHome: '${userHome}/.codex', claudeHome: '${userHome}/.claude', codexCommand: '', claudeCommand: '',
      handoffMaxBytes: 65_536, handoffLaunchMode: 'clipboard', skillDirectories: ['${userHome}/.codex/skills'],
      visionBaseUrl: '', visionModel: '', visionReasoningEffort: '', visionMaxBytes: 4_194_304,
    } satisfies HarnessConfiguration
    const overlay = renderRuntimeOverlay(configuration)
    expect(overlay).toContain('id: llm-pi-ai')
    expect(overlay).toContain('"openai":')
    expect(overlay).toContain('api: "openai-completions"')
    expect(overlay).toContain('baseURL: "https://gateway.example/v1/"')
    expect(overlay).not.toContain('id: llm-deepseek')
    expect(overlay.match(/id: llm-pi-ai/gu)?.length).toBe(1)
  })

  it('inserts the official schedule plugin only when explicitly enabled', () => {
    const base = {
      runtimeMode: 'bundled', runtimeCommand: '', runtimeNodePath: '', startTimeoutMs: 90_000,
      provider: 'deepseek-official', model: 'deepseek-v4-flash', reasoningEffort: 'high', agentPreset: 'standard',
      permissionMode: 'workspace-write', approvalPolicy: 'ask', baseUrl: 'https://api.deepseek.com/', autoStart: true,
      scheduleEnabled: false,
      contextMaxBytes: 32_768, contextWindowTokens: 1_000_000, pasteFileThreshold: 4_096,
      codexHome: '${userHome}/.codex', claudeHome: '${userHome}/.claude', codexCommand: '', claudeCommand: '',
      handoffMaxBytes: 65_536, handoffLaunchMode: 'clipboard', skillDirectories: ['${userHome}/.codex/skills'],
      visionBaseUrl: '', visionModel: '', visionReasoningEffort: '', visionMaxBytes: 4_194_304,
    } satisfies HarnessConfiguration
    expect(renderRuntimeOverlay(base)).not.toContain('@deepseek-ai/dsh-schedule')
    expect(renderRuntimeOverlay({ ...base, scheduleEnabled: true })).toContain("name: '@deepseek-ai/dsh-schedule'")
  })
})

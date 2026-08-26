import { describe, expect, it } from 'vitest'
import type { HarnessConfiguration } from '../src/config/configuration.js'
import { resolveVisionRoute } from '../src/vision/routing.js'

function configuration(overrides: Partial<HarnessConfiguration> = {}): HarnessConfiguration {
  return {
    runtimeMode: 'bundled', runtimeCommand: '', runtimeNodePath: '', startTimeoutMs: 90_000,
    provider: 'deepseek-official', model: 'deepseek-v4-flash', reasoningEffort: 'high', agentPreset: 'standard',
    permissionMode: 'workspace-write', baseUrl: 'https://api.deepseek.com/', autoStart: true, scheduleEnabled: false,
    contextMaxBytes: 32_768, contextWindowTokens: 1_000_000, pasteFileThreshold: 4_096,
    codexHome: '~/.codex', claudeHome: '~/.claude', codexCommand: '', claudeCommand: '', handoffMaxBytes: 65_536,
    handoffLaunchMode: 'clipboard', skillDirectories: [], visionBaseUrl: 'https://vision.example/v1/', visionModel: 'gpt-vision',
    visionReasoningEffort: 'low', visionMaxBytes: 4_194_304, visionMode: 'auto', ...overrides,
  }
}

describe('Vision routing', () => {
  it('uses the configured auxiliary Vision route independently of the main model', () => {
    expect(resolveVisionRoute(configuration(), 'main-key', 'vision-key')).toMatchObject({ source: 'dedicated', model: 'gpt-vision', apiKey: 'vision-key' })
  })

  it('does not silently reuse the main API key for auxiliary vision', () => {
    expect(() => resolveVisionRoute(configuration({ model: 'deepseek-v4-flash-vision-exp' }), 'main-key', undefined)).toThrow('auxiliary Vision API key')
  })

  it('requires an auxiliary endpoint and model', () => {
    expect(() => resolveVisionRoute(configuration({ visionBaseUrl: '', visionModel: '' }), 'main-key', 'vision-key')).toThrow('auxiliary Vision URL')
  })
})

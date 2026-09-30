import { describe, expect, it } from 'vitest'
import { normalizeProviderBaseUrl, usesDeepSeekMessagesEndpoint } from '../src/runtime/provider-endpoint.js'

describe('DeepSeek Messages and custom gateway compatibility', () => {
  it('adapts only the exact official host or an explicitly declared Anthropic namespace', () => {
    expect(usesDeepSeekMessagesEndpoint('https://api.deepseek.com/')).toBe(true)
    expect(usesDeepSeekMessagesEndpoint('https://gateway.example/anthropic/v1')).toBe(true)
    expect(usesDeepSeekMessagesEndpoint('https://gateway.example/v1')).toBe(false)
    expect(usesDeepSeekMessagesEndpoint('https://api.deepseek.com.example/v1')).toBe(false)
    expect(normalizeProviderBaseUrl('https://api.deepseek.com/anthropic/')).toBe('https://api.deepseek.com/anthropic')
    expect(normalizeProviderBaseUrl('https://gateway.example/v1///')).toBe('https://gateway.example/v1')
  })
})

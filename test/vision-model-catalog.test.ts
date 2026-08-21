import { describe, expect, it } from 'vitest'
import { auxiliaryVisionEnabledForModel, DEEPSEEK_VISION_EXP_MODEL, isVisionCapableModel, mergedVisionModelIds, recommendedVisionModels, visionModelIds } from '../src/vision/model-catalog.js'

describe('Vision model catalog', () => {
  it('keeps models beyond the old 100-entry cutoff and removes duplicates', () => {
    const data = Array.from({ length: 140 }, (_, index) => ({ id: `model-${String(index)}` }))
    data.push({ id: 'model-139' })
    expect(visionModelIds({ data })).toHaveLength(140)
    expect(visionModelIds({ data })).toContain('model-139')
  })

  it('keeps multimodal image-preview models while hiding known generators and review-only routes', () => {
    expect(recommendedVisionModels([
      'gemini-3-pro-image-preview',
      'gpt-5.4',
      'gpt-image-1',
      'imagen-4',
      'code-review-latest',
    ])).toEqual(['gemini-3-pro-image-preview', 'gpt-5.4'])
  })

  it('always offers the official experimental DeepSeek vision model on the official endpoint', () => {
    expect(mergedVisionModelIds('https://api.deepseek.com/', [], '')).toContain(DEEPSEEK_VISION_EXP_MODEL)
    expect(mergedVisionModelIds('https://gateway.example/v1/', ['custom-vl'], 'selected-vl'))
      .toEqual(['custom-vl', 'selected-vl'])
  })

  it('recognizes common multimodal model families but keeps auxiliary vision off by default', () => {
    for (const model of ['deepseek-v4-flash-vision-exp', 'gpt-5.6-sol', 'claude-sonnet-4.5', 'gemini-3-pro', 'qwen3-vl']) {
      expect(isVisionCapableModel(model), model).toBe(true)
      expect(auxiliaryVisionEnabledForModel(model), model).toBe(false)
    }
    expect(isVisionCapableModel('deepseek-v4-flash')).toBe(false)
    expect(auxiliaryVisionEnabledForModel('deepseek-v4-flash', { 'deepseek-v4-flash': true })).toBe(true)
  })
})

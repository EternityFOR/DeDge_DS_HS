import { describe, expect, it } from 'vitest'
import { fallbackModelCatalog, recoveryModels, withRecoveryModels } from '../src/session/model-recovery.js'

describe('model recovery catalog', () => {
  it('adds stable DeepSeek routes to a partial catalog without removing provider failures', () => {
    const catalog = withRecoveryModels({
      current: { provider: 'deepseek-official', model: 'expired-preview' },
      routable: false,
      groups: [{ id: 'deepseek-official', name: 'DeepSeek', models: [] }],
      failures: [{ id: 'deepseek-official', name: 'DeepSeek', message: 'unsupported model' }],
    }, { provider: 'deepseek-official' })
    expect(catalog.groups[0]?.models.map(model => model.id)).toContain('deepseek-v4-flash')
    expect(catalog.failures[0]?.message).toBe('unsupported model')
  })

  it('constructs a usable fallback catalog when the model RPC fails', () => {
    const catalog = fallbackModelCatalog({ provider: 'deepseek-official', model: 'expired-preview', reasoningEffort: 'high' }, 'catalog unavailable')
    expect(catalog.routable).toBe(false)
    expect(catalog.current.model).toBe('expired-preview')
    expect(catalog.groups[0]?.models).toEqual(expect.arrayContaining([...recoveryModels()]))
    expect(catalog.failures[0]?.message).toBe('catalog unavailable')
  })
})

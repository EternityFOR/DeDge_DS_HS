import type { HarnessConfiguration } from '../config/configuration.js'
import type { ModelCatalog, ModelCatalogModel } from '../gateway/protocol.js'

const DEEPSEEK_PROVIDER = 'deepseek-official'

const STABLE_DEEPSEEK_MODELS: readonly ModelCatalogModel[] = [
  { id: 'deepseek-flash', name: 'DeepSeek-V41-Flash' },
  { id: 'deepseek-v4-flash', name: 'DeepSeek-V4-Flash' },
  { id: 'deepseek-v4-pro', name: 'DeepSeek-V4-Pro' },
  { id: 'deepseek-v4-flash-vision-exp', name: 'DeepSeek-V4-Flash-Vision-Exp' },
]

/**
 * Keep the model picker usable when an old session points at a route the
 * upstream adapter no longer advertises. Harness may still return a partial
 * catalog, or the catalog RPC itself may fail while checking that route; in
 * both cases the stable DeepSeek choices remain valid recovery actions.
 */
export function withRecoveryModels(catalog: ModelCatalog, configuration: Pick<HarnessConfiguration, 'provider'>): ModelCatalog {
  if (configuration.provider !== DEEPSEEK_PROVIDER) return catalog
  const fallback = recoveryModels()
  const existing = catalog.groups.find(group => group.id === configuration.provider)
  if (existing === undefined) {
    return {
      ...catalog,
      groups: [...catalog.groups, { id: configuration.provider, name: 'DeepSeek', models: fallback }],
    }
  }
  const seen = new Set(existing.models.map(model => model.id))
  const additions = fallback.filter(model => !seen.has(model.id))
  if (additions.length === 0) return catalog
  return {
    ...catalog,
    groups: catalog.groups.map(group => group.id === configuration.provider
      ? { ...group, models: [...group.models, ...additions] }
      : group),
  }
}

export function fallbackModelCatalog(
  configuration: Pick<HarnessConfiguration, 'provider' | 'model' | 'reasoningEffort'>,
  failure: string,
): ModelCatalog {
  const models = configuration.provider === DEEPSEEK_PROVIDER
    ? recoveryModels()
    : [{ id: configuration.model, name: configuration.model }]
  return {
    current: { provider: configuration.provider, model: configuration.model, reasoningEffort: configuration.reasoningEffort },
    routable: false,
    groups: [{ id: configuration.provider, name: configuration.provider, models }],
    failures: [{ id: configuration.provider, name: configuration.provider, message: failure }],
  }
}

export function recoveryModels(): readonly ModelCatalogModel[] {
  return [...STABLE_DEEPSEEK_MODELS]
}

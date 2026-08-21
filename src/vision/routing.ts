import type { HarnessConfiguration } from '../config/configuration.js'

export interface VisionRoute {
  readonly source: 'dedicated'
  readonly baseUrl: string
  readonly model: string
  readonly reasoningEffort: string
  readonly apiKey: string
}

export function resolveVisionRoute(configuration: HarnessConfiguration, _mainApiKey: string | undefined, dedicatedApiKey: string | undefined): VisionRoute {
  const route = { source: 'dedicated' as const, baseUrl: configuration.visionBaseUrl, model: configuration.visionModel, reasoningEffort: configuration.visionReasoningEffort, apiKey: dedicatedApiKey ?? '' }
  if (route.apiKey.trim() === '') {
    throw new Error('No auxiliary Vision API key is stored. Configure one or turn off auxiliary vision and use an image-capable main model.')
  }
  if (route.baseUrl.trim() === '' || route.model.trim() === '') {
    throw new Error('Configure the auxiliary Vision URL and model, or turn off auxiliary vision and use an image-capable main model.')
  }
  return route
}

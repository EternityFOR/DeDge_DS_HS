import { errorMessage } from '../platform/logger.js'

export interface VisionConfiguration {
  readonly baseUrl: string
  readonly model: string
  readonly reasoningEffort?: string
  readonly apiKey: string
  readonly maxBytes: number
}

export interface ImagePayload {
  readonly fileName: string
  readonly mimeType: string
  readonly dataBase64: string
}

const DESCRIPTION_PROMPT = [
  'Describe this image in detail so a text-only model can reason about it.',
  'Include visible text verbatim, code, UI layout, tables, numbers, and any actions shown.',
].join(' ')

export async function describeImage(config: VisionConfiguration, image: ImagePayload, signal?: AbortSignal): Promise<string> {
  if (config.baseUrl.trim() === '') throw new Error('No vision endpoint is configured; set dedgeDeepSeekHarness.vision.baseUrl to attach images.')
  if (config.model.trim() === '') throw new Error('No vision model is configured; set dedgeDeepSeekHarness.vision.model.')
  if (config.apiKey.trim() === '') throw new Error('No vision API key is stored; run "DeepSeek Harness: Configure Vision API Key".')
  const endpoint = new URL('chat/completions', config.baseUrl.endsWith('/') ? config.baseUrl : config.baseUrl + '/')
  let response: Response
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      signal: signal ?? AbortSignal.timeout(120_000),
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${config.apiKey.trim()}`,
      },
      body: JSON.stringify({
        model: config.model.trim(),
        ...(config.reasoningEffort?.trim() === undefined || config.reasoningEffort.trim() === '' ? {} : { reasoning_effort: config.reasoningEffort.trim() }),
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: DESCRIPTION_PROMPT },
              { type: 'image_url', image_url: { url: `data:${image.mimeType};base64,${image.dataBase64}` } },
            ],
          },
        ],
        max_tokens: 1_024,
      }),
    })
  } catch (error) {
    throw new Error(`Vision request transport failed: ${errorMessage(error)}`)
  }
  if (!response.ok) {
    const detail = (await response.text().catch(() => '')).slice(0, 300)
    const hint = response.status === 401 || response.status === 403 || response.status === 502
      ? ' Check the Vision URL, key, model access, and whether the upstream allows image requests.'
      : ''
    throw new Error(`Vision endpoint returned HTTP ${response.status}.${hint}${detail === '' ? '' : ` Details: ${detail}`}`)
  }
  const payload: unknown = await response.json().catch(() => undefined)
  const choice = firstChoice(payload)
  if (choice === undefined) throw new Error('Vision endpoint returned a malformed completion response.')
  return choice
}

export function imageExtensionMimeType(fileName: string): string | undefined {
  const extension = fileName.split('.').pop()?.toLowerCase()
  if (extension === 'png') return 'image/png'
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg'
  if (extension === 'gif') return 'image/gif'
  if (extension === 'webp') return 'image/webp'
  if (extension === 'bmp') return 'image/bmp'
  return undefined
}

export function mimeTypeForDataUrl(dataUrl: string): string | undefined {
  const match = /^data:([a-zA-Z0-9.+-]+\/[a-zA-Z0-9.+-]+);base64,/u.exec(dataUrl)
  return match?.[1]
}

export function stripDataUrlPrefix(dataUrl: string): string | undefined {
  const match = /^data:[a-zA-Z0-9.+-]+\/[a-zA-Z0-9.+-]+;base64,([A-Za-z0-9+/=]+)$/u.exec(dataUrl)
  return match?.[1]
}

function firstChoice(payload: unknown): string | undefined {
  if (typeof payload !== 'object' || payload === null) return undefined
  const record = payload as { readonly choices?: unknown }
  if (!Array.isArray(record.choices) || record.choices.length === 0) return undefined
  const first = record.choices[0]
  if (typeof first !== 'object' || first === null) return undefined
  const message = (first as { readonly message?: unknown }).message
  if (typeof message !== 'object' || message === null) return undefined
  const content = (message as { readonly content?: unknown }).content
  if (typeof content === 'string') return content
  return undefined
}

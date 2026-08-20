import { errorMessage } from '../platform/logger.js'

export interface VisionConfiguration {
  readonly baseUrl: string
  readonly model: string
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
      ...(signal === undefined ? {} : { signal }),
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${config.apiKey.trim()}`,
      },
      body: JSON.stringify({
        model: config.model.trim(),
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
    throw new Error(`Vision endpoint returned HTTP ${response.status}${detail === '' ? '' : `: ${detail}`}`)
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

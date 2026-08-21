const MAX_VISION_MODELS = 1_000
export const DEEPSEEK_VISION_EXP_MODEL = 'deepseek-v4-flash-vision-exp'

export function isVisionCapableModel(model: string): boolean {
  const id = model.toLowerCase()
  return id === DEEPSEEK_VISION_EXP_MODEL
    || /(?:vision|multimodal|(?:^|[-_.])vl(?:$|[-_.]))/u.test(id)
    || /^(?:gpt-(?:4o|4\.1|5(?:[.-]|$))|o[134](?:[.-]|$))/u.test(id)
    || /^(?:claude-(?:3|sonnet-4|opus-4)|gemini-(?:1\.5|2|3)|pixtral|llama-[\w.-]*vision|glm-4v|qwen[\w.-]*-vl|kimi[\w.-]*-vl)/u.test(id)
}

export function auxiliaryVisionEnabledForModel(model: string, overrides: Readonly<Record<string, boolean>> = {}): boolean {
  return overrides[model] ?? false
}

export function visionModelIds(payload: unknown): string[] {
  if (!isRecord(payload) || !Array.isArray(payload.data)) return []
  const models: string[] = []
  const seen = new Set<string>()
  for (const item of payload.data) {
    if (!isRecord(item) || typeof item.id !== 'string') continue
    const id = item.id.trim()
    if (id === '' || id.length > 256 || seen.has(id)) continue
    seen.add(id)
    models.push(id)
    if (models.length >= MAX_VISION_MODELS) break
  }
  return models
}

export function recommendedVisionModels(models: readonly string[]): string[] {
  const excluded = /(?:^|[-_.])(gpt[-_.]?image|imagen|dall-?e|flux|sdxl|stable-?diffusion|seedream|sora|code-?review|auto-?review)(?:$|[-_.0-9])/iu
  return [...new Set(models)].filter(model => !excluded.test(model)).sort((left, right) => left.localeCompare(right, undefined, { numeric: true }))
}

export function mergedVisionModelIds(baseUrl: string, discovered: readonly string[], selected = ''): string[] {
  const builtIn = isOfficialDeepSeekUrl(baseUrl) ? [DEEPSEEK_VISION_EXP_MODEL] : []
  return [...new Set([...builtIn, ...discovered, ...(selected.trim() === '' ? [] : [selected.trim()])])]
}

function isOfficialDeepSeekUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.hostname.toLowerCase() === 'api.deepseek.com' && !url.pathname.toLowerCase().includes('anthropic')
  } catch {
    return false
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

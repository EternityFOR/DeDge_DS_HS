import { createHash } from 'node:crypto'
import type * as vscode from 'vscode'

const API_KEY_SECRET = 'dedgeDeepSeekHarness.deepseekApiKey'
const API_KEYS_SECRET = 'dedgeDeepSeekHarness.apiKeys.v1'
const VISION_API_KEY_SECRET = 'dedgeDeepSeekHarness.visionApiKey'
const OFFICIAL_ENDPOINT = 'https://api.deepseek.com/'

export class CredentialStore {
  constructor(private readonly secrets: vscode.SecretStorage) {}

  async getApiKey(baseUrl?: string): Promise<string | undefined> {
    if (baseUrl === undefined) return this.secrets.get(API_KEY_SECRET)
    const slots = await this.readApiKeySlots()
    const scoped = slots[endpointSlot(baseUrl)]
    if (typeof scoped === 'string' && scoped !== '') return scoped
    // Migrate the pre-0.1.47 single-key storage without sending it to a new vendor.
    if (normalizeEndpoint(baseUrl) === OFFICIAL_ENDPOINT) return this.secrets.get(API_KEY_SECRET)
    return undefined
  }

  async setApiKey(value: string, baseUrl?: string): Promise<void> {
    if (baseUrl === undefined) {
      await this.secrets.store(API_KEY_SECRET, value)
      return
    }
    const slots = await this.readApiKeySlots()
    slots[endpointSlot(baseUrl)] = value
    await this.secrets.store(API_KEYS_SECRET, JSON.stringify(slots))
    if (normalizeEndpoint(baseUrl) === OFFICIAL_ENDPOINT) await this.secrets.store(API_KEY_SECRET, value)
  }

  async clearApiKey(baseUrl?: string): Promise<void> {
    if (baseUrl === undefined) {
      await this.secrets.delete(API_KEY_SECRET)
      return
    }
    const slots = await this.readApiKeySlots()
    delete slots[endpointSlot(baseUrl)]
    await this.secrets.store(API_KEYS_SECRET, JSON.stringify(slots))
    if (normalizeEndpoint(baseUrl) === OFFICIAL_ENDPOINT) await this.secrets.delete(API_KEY_SECRET)
  }

  getVisionApiKey(): Thenable<string | undefined> {
    return this.secrets.get(VISION_API_KEY_SECRET)
  }

  setVisionApiKey(value: string): Thenable<void> {
    return this.secrets.store(VISION_API_KEY_SECRET, value)
  }

  clearVisionApiKey(): Thenable<void> {
    return this.secrets.delete(VISION_API_KEY_SECRET)
  }

  private async readApiKeySlots(): Promise<Record<string, string>> {
    const raw = await this.secrets.get(API_KEYS_SECRET)
    if (raw === undefined || raw.trim() === '') return {}
    try {
      const parsed: unknown = JSON.parse(raw)
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {}
      return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[0] === 'string' && typeof entry[1] === 'string' && entry[1] !== ''))
    } catch {
      return {}
    }
  }
}

function normalizeEndpoint(value: string): string {
  try {
    const url = new URL(value.trim())
    url.username = ''
    url.password = ''
    url.hash = ''
    return url.toString()
  } catch {
    return value.trim()
  }
}

function endpointSlot(value: string): string {
  return createHash('sha256').update(normalizeEndpoint(value)).digest('hex')
}

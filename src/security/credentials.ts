import type * as vscode from 'vscode'

const API_KEY_SECRET = 'dedgeDeepSeekHarness.deepseekApiKey'
const VISION_API_KEY_SECRET = 'dedgeDeepSeekHarness.visionApiKey'

export class CredentialStore {
  constructor(private readonly secrets: vscode.SecretStorage) {}

  getApiKey(): Thenable<string | undefined> {
    return this.secrets.get(API_KEY_SECRET)
  }

  setApiKey(value: string): Thenable<void> {
    return this.secrets.store(API_KEY_SECRET, value)
  }

  clearApiKey(): Thenable<void> {
    return this.secrets.delete(API_KEY_SECRET)
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
}


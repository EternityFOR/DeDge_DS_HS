import type * as vscode from 'vscode'

const SECRET_PATTERNS = [
  /\bsk-[a-zA-Z0-9_-]{12,}\b/gu,
  /((?:api[-_ ]?key|authorization|token|secret)\s*[:=]\s*)\S+/giu,
] as const

export class Logger implements vscode.Disposable {
  constructor(private readonly channel: vscode.LogOutputChannel) {}

  info(message: string): void {
    this.channel.info(redact(message))
  }

  warn(message: string): void {
    this.channel.warn(redact(message))
  }

  error(message: string, cause?: unknown): void {
    const suffix = cause === undefined ? '' : `: ${errorMessage(cause)}`
    this.channel.error(redact(`${message}${suffix}`))
  }

  raw(message: string): void {
    const normalized = redact(message).replaceAll('\r\n', '\n')
    for (const line of normalized.split('\n')) {
      if (line !== '') this.channel.appendLine(line)
    }
  }

  show(): void {
    this.channel.show(true)
  }

  dispose(): void {
    this.channel.dispose()
  }
}

export function redact(value: string): string {
  let result = value
  for (const pattern of SECRET_PATTERNS) {
    result = result.replace(pattern, (_match, prefix: string | undefined) => prefix === undefined ? '<redacted>' : `${prefix}<redacted>`)
  }
  try {
    const parsed = new URL(result)
    parsed.username = ''
    parsed.password = ''
    parsed.search = ''
    parsed.hash = ''
    return parsed.toString()
  } catch {
    return result
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}


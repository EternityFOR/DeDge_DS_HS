/** Native DeepSeek 0.2 uses Messages; older custom gateways keep Chat Completions. */
export function usesDeepSeekMessagesEndpoint(value: string): boolean {
  try {
    const endpoint = new URL(value)
    return endpoint.hostname.toLowerCase() === 'api.deepseek.com'
      || /\/anthropic(?:\/v1)?\/?$/iu.test(endpoint.pathname)
  } catch {
    return false
  }
}

/** Preserve configured URLs/key slots while adapting the official root on launch. */
export function normalizeProviderBaseUrl(value: string): string {
  const trimmed = value.replace(/\/+$/u, '')
  try {
    const endpoint = new URL(trimmed)
    if (endpoint.hostname.toLowerCase() === 'api.deepseek.com'
      && (endpoint.pathname === '/' || endpoint.pathname === '/v1')) {
      endpoint.pathname = '/anthropic'
      return endpoint.toString().replace(/\/+$/u, '')
    }
  } catch {
    // Configuration validation handles malformed input before launch.
  }
  return trimmed
}

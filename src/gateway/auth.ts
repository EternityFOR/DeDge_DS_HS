import { requestLoopbackGateway } from './local-http.js'

/**
 * Exchange the alpha.2 process launch token for the browser-session cookie
 * required by the local Gateway. Older Harness runtimes did not print a
 * token, so an unqualified URL remains a supported no-cookie transport for
 * explicitly compatible external runtimes.
 */
export async function bootstrapGatewayCookie(baseUrl: string): Promise<string | undefined> {
  const endpoint = new URL(baseUrl)
  const token = endpoint.searchParams.get('token')
  if (token === null || token === '') return undefined

  endpoint.pathname = '/'
  endpoint.search = ''
  endpoint.hash = ''
  endpoint.searchParams.set('token', token)
  const response = await requestLoopbackGateway(endpoint, {
    method: 'GET',
    headers: { accept: 'text/html' },
    timeoutMs: 10_000,
  })
  if (response.statusCode !== 303) throw new Error(`Harness gateway authentication bootstrap returned HTTP ${response.statusCode}.`)

  const raw = response.headers['set-cookie']?.[0]
  const cookie = raw?.split(';', 1)[0]?.trim()
  if (cookie === undefined || cookie === '' || !cookie.includes('=')) {
    throw new Error('Harness gateway authentication bootstrap did not return a session cookie.')
  }
  return cookie
}

export function withGatewayCookie(headers: Record<string, string>, cookie: string | undefined): Record<string, string> {
  return cookie === undefined ? headers : { ...headers, cookie }
}

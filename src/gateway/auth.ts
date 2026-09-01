/**
 * Exchange the alpha.3 process launch token for the browser-session cookie
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
  const response = await fetch(endpoint, {
    method: 'GET',
    redirect: 'manual',
    headers: { accept: 'text/html' },
  })
  if (response.status !== 303) throw new Error(`Harness gateway authentication bootstrap returned HTTP ${response.status}.`)

  const headers = response.headers as Headers & { readonly getSetCookie?: () => string[] }
  const raw = headers.getSetCookie?.()[0] ?? headers.get('set-cookie')
  const cookie = raw?.split(';', 1)[0]?.trim()
  if (cookie === undefined || cookie === '' || !cookie.includes('=')) {
    throw new Error('Harness gateway authentication bootstrap did not return a session cookie.')
  }
  return cookie
}

export function withGatewayCookie(headers: Record<string, string>, cookie: string | undefined): Record<string, string> {
  return cookie === undefined ? headers : { ...headers, cookie }
}

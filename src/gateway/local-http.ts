import * as http from 'node:http'

export interface LocalGatewayResponse {
  readonly statusCode: number
  readonly headers: http.IncomingHttpHeaders
  readonly body: string
}

export interface LocalGatewayRequestOptions {
  readonly method: 'GET' | 'POST'
  readonly headers?: Readonly<Record<string, string>>
  readonly body?: string
  readonly signal?: AbortSignal
  readonly timeoutMs?: number
  readonly maxResponseBytes?: number
}

const MAX_RESPONSE_BYTES = 16 * 1024 * 1024

// A dedicated agent bypasses Node's environment-configured global proxy for local authenticated RPC.
export const directLoopbackAgent = new http.Agent({ keepAlive: false })

export function assertLoopbackGatewayUrl(value: string | URL): URL {
  let endpoint: URL
  try {
    endpoint = new URL(value.toString())
  } catch {
    throw new Error('Harness Gateway URL is invalid.')
  }
  if (endpoint.protocol !== 'http:' || endpoint.hostname !== '127.0.0.1' || endpoint.port === ''
    || endpoint.username !== '' || endpoint.password !== '' || endpoint.hash !== '') {
    throw new Error('Harness Gateway must use a numeric 127.0.0.1 HTTP URL without URL credentials.')
  }
  return endpoint
}

/** Make a direct loopback-only request; Node proxy settings cannot redirect its auth cookie. */
export function requestLoopbackGateway(
  value: string | URL,
  options: LocalGatewayRequestOptions,
): Promise<LocalGatewayResponse> {
  const endpoint = assertLoopbackGatewayUrl(value)
  const maxResponseBytes = options.maxResponseBytes ?? MAX_RESPONSE_BYTES
  const timeoutMs = options.timeoutMs ?? 30_000

  return new Promise((resolve, reject) => {
    let settled = false
    let responseBytes = 0
    let request: http.ClientRequest | undefined
    const chunks: Buffer[] = []
    const cleanup = (): void => options.signal?.removeEventListener('abort', onAbort)
    const fail = (error: Error): void => {
      if (settled) return
      settled = true
      cleanup()
      request?.destroy()
      reject(error)
    }
    const onAbort = (): void => fail(new Error('Harness loopback request was aborted.'))
    if (options.signal?.aborted === true) {
      reject(new Error('Harness loopback request was aborted.'))
      return
    }

    request = http.request(endpoint, {
      method: options.method,
      agent: directLoopbackAgent,
      headers: options.headers,
    }, response => {
      response.on('data', (chunk: Buffer | string) => {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
        responseBytes += buffer.byteLength
        if (responseBytes > maxResponseBytes) {
          response.destroy()
          fail(new Error('Harness Gateway response exceeded the configured limit.'))
          return
        }
        chunks.push(buffer)
      })
      response.on('end', () => {
        if (settled) return
        settled = true
        cleanup()
        resolve({
          statusCode: response.statusCode ?? 0,
          headers: response.headers,
          body: Buffer.concat(chunks).toString('utf8'),
        })
      })
      response.on('error', fail)
    })
    request.on('error', fail)
    request.setTimeout(timeoutMs, () => fail(new Error('Harness loopback request timed out.')))
    options.signal?.addEventListener('abort', onAbort, { once: true })
    if (options.body === undefined) request.end()
    else request.end(options.body)
  })
}

import { once } from 'node:events'
import * as http from 'node:http'
import { describe, expect, it } from 'vitest'
import { GatewayClient } from '../src/gateway/gateway-client.js'
import { bootstrapGatewayCookie, withGatewayCookie } from '../src/gateway/auth.js'
import { assertLoopbackGatewayUrl, directLoopbackAgent } from '../src/gateway/local-http.js'
import {
  parseContextPressureProjection,
  expandHistoryRecords,
  parseModelCatalog,
  parseHostFrame,
  parseMuxFrame,
  parsePresetCatalog,
  parseScheduleProjection,
  parseSessionAttachment,
  parseServerRequest,
  parseServerResponse,
} from '../src/gateway/protocol.js'

async function withLoopbackServer(
  handler: (request: http.IncomingMessage, response: http.ServerResponse) => void | Promise<void>,
  action: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const server = http.createServer((request, response) => {
    void Promise.resolve(handler(request, response)).catch(() => {
      response.statusCode = 500
      response.end()
    })
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('Test server did not bind a TCP port.')
  try {
    await action(`http://127.0.0.1:${String(address.port)}/`)
  } finally {
    server.close()
    await once(server, 'close')
  }
}

async function readJsonBody(request: http.IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(Buffer.from(chunk))
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>
}

function writeJson(response: http.ServerResponse, value: unknown): void {
  response.writeHead(200, { 'content-type': 'application/json' })
  response.end(JSON.stringify(value))
}

describe('Gateway JSON frame parsing', () => {
  it('exchanges an alpha.3 launch token for a cookie without retaining query credentials in API headers', async () => {
    let requestedPath = ''
    let requestCookie: string | undefined
    await withLoopbackServer((request, response) => {
      requestedPath = request.url ?? ''
      requestCookie = request.headers.cookie
      response.writeHead(303, { 'set-cookie': 'dsh-auth-test=opaque; Path=/; HttpOnly' })
      response.end()
    }, async baseUrl => {
      const cookie = await bootstrapGatewayCookie(`${baseUrl}?token=launch-token`)
      expect(requestedPath).toBe('/?token=launch-token')
      expect(requestCookie).toBeUndefined()
      expect(cookie).toBe('dsh-auth-test=opaque')
      expect(withGatewayCookie({ 'content-type': 'application/json' }, cookie)).toEqual({ 'content-type': 'application/json', cookie: 'dsh-auth-test=opaque' })
    })
  })

  it('rejects non-loopback Gateway URLs and uses an explicit direct HTTP agent', () => {
    expect(() => assertLoopbackGatewayUrl('http://example.com:3210')).toThrow('127.0.0.1')
    const urlWithCredentials = new URL('http://127.0.0.1:3210')
    urlWithCredentials.username = 'test-user'
    urlWithCredentials.password = 'test-pass'
    expect(() => assertLoopbackGatewayUrl(urlWithCredentials)).toThrow('URL')
    expect(directLoopbackAgent).not.toBe(http.globalAgent)
    expect((directLoopbackAgent as unknown as { readonly options: { readonly proxyEnv?: unknown } }).options.proxyEnv).toBeUndefined()
  })

  it('parses an authenticated durable session image attachment', () => {
    expect(parseSessionAttachment({
      attachment: { attachmentId: 'att-1', mediaType: 'image/png', bytes: 3, width: 2, height: 2, name: 'reminder.png' },
      data: 'YWJj',
    })).toEqual({
      attachment: { attachmentId: 'att-1', mediaType: 'image/png', bytes: 3, width: 2, height: 2, name: 'reminder.png' },
      data: 'YWJj',
    })
    expect(() => parseSessionAttachment({ attachment: { attachmentId: 'att-1', mediaType: 'image/svg+xml', bytes: 3, width: 2, height: 2 }, data: 'YWJj' })).toThrow('Malformed Harness session attachment metadata')
  })

  it('parses successful and failed RPC envelopes', () => {
    expect(parseServerResponse({
      type: 'server-response',
      rpcId: 'rpc-1',
      result: { ok: true, value: { accepted: true } },
    })).toEqual({
      type: 'server-response',
      rpcId: 'rpc-1',
      result: { ok: true, value: { accepted: true } },
    })

    expect(parseServerResponse({
      type: 'server-response',
      rpcId: 'rpc-2',
      result: { ok: false, error: { code: 'BAD_REQUEST', message: 'invalid', details: { field: 'text' } } },
    })).toEqual({
      type: 'server-response',
      rpcId: 'rpc-2',
      result: { ok: false, error: { code: 'BAD_REQUEST', message: 'invalid', details: { field: 'text' } } },
    })
  })

  it('requires the native cancel acknowledgement', async () => {
    await withLoopbackServer(async (incoming, response) => {
      const request = await readJsonBody(incoming)
      writeJson(response, {
          type: 'server-response',
          rpcId: request.rpcId,
          result: { ok: true, value: { accepted: false } },
        })
    }, async baseUrl => {
      const client = new GatewayClient(baseUrl, {} as never)
      await expect(client.cancel('session-1')).rejects.toThrow('did not acknowledge')
    })
  })

  it('sends native queue edit, steer, and remove mutations', async () => {
    const payloads: unknown[] = []
    await withLoopbackServer(async (incoming, response) => {
      const body = await readJsonBody(incoming)
      payloads.push(body.payload)
      writeJson(response, {
          type: 'server-response',
          rpcId: body.rpcId,
          result: { ok: true, value: { accepted: true } },
        })
    }, async baseUrl => {
      const client = new GatewayClient(baseUrl, {} as never)
      await client.updateQueueItem('session-1', 'message-1', { kind: 'edit', content: [{ type: 'text', text: 'Revised prompt' }] })
      await client.updateQueueItem('session-1', 'message-1', { kind: 'steer' })
      await client.removeQueueItem('session-1', 'message-1')
      expect(payloads).toEqual([
        { args: { request: { sessionId: 'session-1', itemId: 'message-1', action: { kind: 'edit', content: [{ type: 'text', text: 'Revised prompt' }] } } } },
        { args: { request: { sessionId: 'session-1', itemId: 'message-1', action: { kind: 'steer' } } } },
        { args: { request: { sessionId: 'session-1', itemId: 'message-1', action: { kind: 'remove' } } } },
      ])
    })
  })

  it('uses the persistent projected title from session.list before history is opened', async () => {
    await withLoopbackServer(async (incoming, response) => {
      const request = await readJsonBody(incoming)
      writeJson(response, {
          type: 'server-response',
          rpcId: request.rpcId,
          result: { ok: true, value: { items: [{ sessionId: 'session-1', updatedAt: 1, running: false, blank: false, projections: { asOfSeq: 8, values: { title: 'Vision capability test', agentPreset: 'minimal' } } }] } },
        })
    }, async baseUrl => {
      const client = new GatewayClient(baseUrl, {} as never)
      await expect(client.listSessions()).resolves.toMatchObject({ items: [{ sessionId: 'session-1', title: 'Vision capability test', agentPreset: 'minimal' }] })
    })
  })

  it('uses the generated commands/execute route and parses its command result', async () => {
      let requestedUrl = ''
      let requestedBody: unknown
    await withLoopbackServer(async (incoming, response) => {
      requestedUrl = `http://${incoming.headers.host}${incoming.url}`
      requestedBody = await readJsonBody(incoming)
      const rpcId = (requestedBody as { rpcId: string }).rpcId
      writeJson(response, {
          type: 'server-response',
          rpcId,
          result: { ok: true, value: { commandId: 'cmd-1', result: { kind: 'success', text: 'Compacted 12 history items.' } } },
        })
    }, async baseUrl => {
      const client = new GatewayClient(baseUrl, {} as never)
      await expect(client.executeCommand('session-1', '/compact')).resolves.toEqual({ result: { kind: 'success', text: 'Compacted 12 history items.' } })
      expect(requestedUrl).toBe(`${baseUrl.slice(0, -1)}/api/commands/execute`)
      expect(requestedBody).toMatchObject({ method: 'commands/execute', payload: { args: { agentId: 'session-1', line: '/compact', submittedAttachments: [] } } })
    })
  })

  it('parses server requests and preserves arbitrary payloads', () => {
    expect(parseServerRequest({ type: 'server-request', rpcId: 'evt-1', payload: { type: 'host/session-status', running: true } }))
      .toEqual({ type: 'server-request', rpcId: 'evt-1', payload: { type: 'host/session-status', running: true } })
  })

  it('normalizes the legacy session status event into a projection frame', () => {
    expect(parseMuxFrame({ type: 'session/status', sessionId: 's-1', running: false, seq: 12 }))
      .toEqual({ type: 'session/projection', sessionId: 's-1', key: 'status', value: { running: false }, seq: 12 })
  })

  it('accepts bounded context-pressure projections and rejects malformed counts', () => {
    expect(parseContextPressureProjection({ pressureTokens: 210_000, projectedTokens: 212_000, contextWindow: 353_000 }))
      .toEqual({ pressureTokens: 210_000, projectedTokens: 212_000, contextWindow: 353_000 })
    expect(parseContextPressureProjection({ projectedTokens: -1, contextWindow: 353_000 })).toBeUndefined()
    expect(parseContextPressureProjection({ projectedTokens: 10, contextWindow: 0 })).toBeUndefined()
  })

  it('cleans question options but preserves their exact labels', () => {
    expect(parseMuxFrame({
      type: 'question/requested',
      sessionId: 's-1',
      questions: [
        {
          id: 'q-1',
          question: 'Choose',
          options: [
            { label: ' A ', description: 'first' },
            { label: 'B', description: 7 },
            { label: '   ' },
            { label: 9 },
          ],
          multiSelect: true,
        },
        { id: 7, question: 'discard me' },
      ],
    })).toEqual({
      type: 'question/requested',
      sessionId: 's-1',
      questions: [{ id: 'q-1', question: 'Choose', options: [{ label: ' A ', description: 'first' }, { label: 'B' }], multiSelect: true }],
    })
  })

  it('keeps valid approval and strict session event frames', () => {

    expect(parseMuxFrame({
      type: 'approval/requested',
      sessionId: 's-1',
      approvalId: 'a-1',
      toolName: 'filesystem.write',
      reason: 'needs approval',
    })).toMatchObject({ type: 'approval/requested', sessionId: 's-1', approvalId: 'a-1', toolName: 'filesystem.write', reason: 'needs approval' })

    expect(parseMuxFrame({
      type: 'session/event',
      sessionId: 's-1',
      event: { type: 'turn/start', seq: 0, time: 100.5, data: null },
    })).toMatchObject({ type: 'session/event', sessionId: 's-1', event: { type: 'turn/start', seq: 0, time: 100.5, data: null } })
  })

  it('rejects malformed session events and empty question batches', () => {
    for (const event of [
      { type: 'turn/start', time: 1, data: {} },
      { type: 'turn/start', seq: -1, time: 1, data: {} },
      { type: 'turn/start', seq: 1.5, time: 1, data: {} },
      { type: 'turn/start', seq: Number.MAX_SAFE_INTEGER + 1, time: 1, data: {} },
      { type: 'turn/start', seq: 1, time: Number.POSITIVE_INFINITY, data: {} },
      { type: 'turn/start', seq: 1, time: 1 },
    ]) {
      expect(() => parseMuxFrame({ type: 'session/event', sessionId: 's-1', event })).toThrow('Malformed Harness session event')
    }
    expect(() => parseMuxFrame({ type: 'question/requested', sessionId: 's-1', questions: [] })).toThrow('Unsupported Harness mux frame')
    expect(() => parseMuxFrame({ type: 'question/requested', sessionId: 's-1', questions: [{ id: 1 }] })).toThrow('Unsupported Harness mux frame')
  })

  it('accepts successful RPC responses without a value payload', () => {
    expect(parseServerResponse({ type: 'server-response', rpcId: 'ack-1', result: { ok: true } })).toEqual({
      type: 'server-response',
      rpcId: 'ack-1',
      result: { ok: true, value: undefined },
    })
  })

  it('parses model and agent preset catalogs', () => {
    expect(parseModelCatalog({
      current: { provider: 'deepseek-official', model: 'deepseek-v4', reasoningEffort: 'max' },
      routable: true,
      groups: [{
        id: 'deepseek-official',
        name: 'DeepSeek',
        models: [{
          id: 'deepseek-v4',
          name: 'DeepSeek V4',
          description: 'General coding model',
          reasoning: {
            efforts: [{ id: 'high', name: 'High' }, { id: 'max', name: 'Maximum', description: 'More deliberation' }],
            defaultEffort: 'high',
          },
        }],
      }],
      failures: [],
    })).toMatchObject({ current: { model: 'deepseek-v4', reasoningEffort: 'max' }, routable: true })

    expect(parseModelCatalog({
      default: { provider: 'deepseek-official', model: 'deepseek-v4' },
      routableProviders: ['deepseek-official'],
      groups: [{ id: 'deepseek-official', name: 'DeepSeek', models: [{ id: 'deepseek-v4', name: 'DeepSeek V4' }] }],
      failures: [],
    })).toMatchObject({ current: { model: 'deepseek-v4' }, routable: true })

    expect(parsePresetCatalog({
      presets: [
        { id: 'standard', trust: 'system', isDefault: true, name: 'Standard' },
        { id: 'cordis', trust: 'system', isDefault: false, broken: 'missing plugin' },
      ],
      authorable: true,
      hasDocument: true,
    }).presets.map(preset => preset.id)).toEqual(['standard', 'cordis'])
    expect(parsePresetCatalog({ presets: [{ id: 'standard', trust: 'system', isDefault: true }], authorable: false })).toMatchObject({ hasDocument: false })
  })

  it('parses the official active schedule projection and rejects malformed records', () => {
    expect(parseScheduleProjection([
      { id: 'schedule-1', kind: 'at', prompt: 'Check the market', scheduledAt: '2099-09-04T13:24:00.000Z' },
      { id: 'schedule-2', kind: 'every', prompt: 'Refresh quotes', scheduledAt: '2099-09-04T13:30:00.000Z', everySeconds: 3_600 },
    ])).toEqual([
      { id: 'schedule-1', kind: 'at', prompt: 'Check the market', scheduledAt: '2099-09-04T13:24:00.000Z' },
      { id: 'schedule-2', kind: 'every', prompt: 'Refresh quotes', scheduledAt: '2099-09-04T13:30:00.000Z', everySeconds: 3_600 },
    ])
    expect(parseScheduleProjection([{ id: 'schedule-1', kind: 'every', prompt: 'Too frequent', scheduledAt: '2099-09-04T13:24:00.000Z', everySeconds: 60 }])).toBeUndefined()
    expect(parseScheduleProjection([{ id: 'schedule-1', kind: 'at', prompt: '', scheduledAt: '2099-09-04T13:24:00.000Z' }])).toBeUndefined()
  })

  it('parses host lifecycle frames and rejects malformed envelopes', () => {
    expect(parseHostFrame({ type: 'host/session-added', sessionId: 's-1', cwd: 'C:\\work', agentPreset: 'standard' }))
      .toEqual({ type: 'host/session-added', sessionId: 's-1', cwd: 'C:\\work', agentPreset: 'standard' })
    expect(parseHostFrame({ type: 'host/session-status', sessionId: 's-1', running: true }))
      .toEqual({ type: 'host/session-status', sessionId: 's-1', running: true })
    expect(parseHostFrame({ type: 'host/archived-sessions-changed', archivedSessionIds: ['s-1', 's-2'] }))
      .toEqual({ type: 'host/archived-sessions-changed', archivedSessionIds: ['s-1', 's-2'] })
    expect(() => parseMuxFrame({ type: 'not-a-frame' })).toThrow('Unsupported Harness mux frame')
    expect(() => parseServerResponse({ type: 'server-response', rpcId: 'x', result: { ok: 'yes' } })).toThrow('Malformed Harness RPC result')
  })

  it('expands alpha.3 packed assistant chunk rows before projection', () => {
    expect(expandHistoryRecords([{
      type: 'chunks',
      event: {
        type: 'chunkrow/text-chunks',
        seq: 4,
        time: 100,
        data: { turn: 2, step: 1, index: 0, dt: [3], texts: ['a', 'b'] },
      },
    }])).toEqual([
      { event: { type: 'assistant/chunk', seq: 4, time: 100, data: { turn: 2, step: 1, chunk: { type: 'text-delta', index: 0, text: 'a' } } } },
      { event: { type: 'assistant/chunk', seq: 5, time: 103, data: { turn: 2, step: 1, chunk: { type: 'text-delta', index: 0, text: 'b' } } } },
    ])
  })
})

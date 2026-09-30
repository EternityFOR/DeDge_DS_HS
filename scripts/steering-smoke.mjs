import { once } from 'node:events'
import * as http from 'node:http'
import { readFile, access } from 'node:fs/promises'
import * as path from 'node:path'

/** Synthetic loopback provider. It spends no tokens and uses no real credential. */
export async function startMockModelServer() {
  const issued = new Set()
  const observed = []
  const paths = []
  const server = http.createServer((request, response) => {
    void handle(request, response).catch(error => {
      response.writeHead(500, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error: { message: String(error) } }))
    })
  })
  async function handle(request, response) {
    paths.push(request.url)
    if (request.url?.endsWith('/files')) {
      response.writeHead(404, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error: { type: 'not_found_error', message: 'Synthetic provider uses inline images.' } }))
      return
    }
    const chunks = []
    for await (const chunk of request) chunks.push(Buffer.from(chunk))
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (request.url?.endsWith('/chat/completions')) {
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      const common = { id: 'smoke-compat', object: 'chat.completion.chunk', created: 1, model: body.model }
      response.write(`data: ${JSON.stringify({ ...common, choices: [{ index: 0, delta: { role: 'assistant', content: 'SMOKE_COMPAT_ACK' }, finish_reason: null }] })}\n\n`)
      response.end(`data: ${JSON.stringify({ ...common, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 20, completion_tokens: 5, total_tokens: 25 } })}\n\ndata: [DONE]\n\n`)
      return
    }
    if (!request.url?.endsWith('/messages')) throw new Error(`Unexpected synthetic endpoint: ${request.url}`)
    const text = (body.messages ?? []).filter(message => message.role === 'user').flatMap(message =>
      typeof message.content === 'string' ? [message.content] : (message.content ?? []).filter(block => block.type === 'text').map(block => block.text ?? ''),
    ).join('\n')
    const markers = text.match(/SMOKE_(?:SLEEP_QUEUE|SLEEP_DIRECT|PROMOTION_STEER_11|DIRECT_STEER|BACKLOG_\d+|SCHEDULE_[AB])/gu) ?? []
    const latest = markers.at(-1)
    const canUseTools = Array.isArray(body.tools) && body.tools.length > 0
    if (canUseTools && latest !== undefined) observed.push({ marker: latest, at: Date.now() })
    if (canUseTools && latest?.startsWith('SMOKE_BACKLOG_')) {
      // Keep the next ordinary queued turn open, making queue retention visible
      // until the test cancels that synthetic model request.
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      response.write(': waiting for test cancellation\n\n')
      return
    }
    if (canUseTools && (latest === 'SMOKE_SLEEP_QUEUE' || latest === 'SMOKE_SLEEP_DIRECT') && !issued.has(latest)) {
      issued.add(latest)
      const suffix = latest === 'SMOKE_SLEEP_QUEUE' ? 'queue' : 'direct'
      const command = process.platform === 'win32'
        ? `Set-Content -LiteralPath 'steer-ready-${suffix}.txt' -Value 'ready'; Start-Sleep -Seconds 30; Set-Content -LiteralPath 'steer-late-${suffix}.txt' -Value 'late'`
        : `printf ready > 'steer-ready-${suffix}.txt'; sleep 30; printf late > 'steer-late-${suffix}.txt'`
      sendMessages(response, body.model, { type: 'tool_use', id: `smoke-sleep-${suffix}`, name: process.platform === 'win32' ? 'pwsh' : 'bash', input: { command, description: 'Synthetic foreground sleep used to verify user steering cancellation.' } })
      return
    }
    if (canUseTools && latest?.startsWith('SMOKE_SCHEDULE_') && !issued.has(latest)) {
      issued.add(latest)
      sendMessages(response, body.model, { type: 'tool_use', id: `smoke-${latest}`, name: 'schedule_create', input: { title: latest, prompt: 'Synthetic reminder', after_seconds: 3600 } })
      return
    }
    sendMessages(response, body.model, { type: 'text', text: latest?.includes('STEER') ? `SMOKE_STEER_ACK ${latest}` : 'Synthetic runtime smoke response.' })
  }
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('Synthetic provider did not bind TCP.')
  const origin = `http://127.0.0.1:${address.port}`
  return {
    origin,
    baseUrl: `${origin}/anthropic`,
    observed,
    paths,
    async close() {
      server.closeAllConnections()
      await new Promise(resolve => server.close(resolve))
    },
  }
}

function sendMessages(response, model, block) {
  response.writeHead(200, { 'content-type': 'text/event-stream' })
  const event = (type, data) => response.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`)
  event('message_start', { message: { id: 'smoke-message', type: 'message', role: 'assistant', model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 20, output_tokens: 0 } } })
  event('content_block_start', { index: 0, content_block: block.type === 'tool_use' ? { ...block, input: {} } : { type: 'text', text: '' } })
  event('content_block_delta', { index: 0, delta: block.type === 'tool_use' ? { type: 'input_json_delta', partial_json: JSON.stringify(block.input) } : { type: 'text_delta', text: block.text } })
  event('content_block_stop', { index: 0 })
  event('message_delta', { delta: { stop_reason: block.type === 'tool_use' ? 'tool_use' : 'end_turn', stop_sequence: null }, usage: { output_tokens: 10 } })
  event('message_stop', {})
  response.end()
}

export async function verifyForegroundSteering(client, frames, workspace, mock) {
  const latencies = []
  for (const kind of ['queue', 'direct']) {
    const observedStart = mock.observed.length
    const session = await client.createSession(workspace, 'standard')
    await client.selectModel(session.sessionId, 'deepseek-official', 'deepseek-v4-flash', 'off')
    await client.history(session.sessionId, 100)
    await client.prompt(session.sessionId, kind === 'queue' ? 'SMOKE_SLEEP_QUEUE' : 'SMOKE_SLEEP_DIRECT')
    try {
      await waitUntil(async () => {
        try { return (await readFile(path.join(workspace, `steer-ready-${kind}.txt`), 'utf8')).trim() === 'ready' } catch { return false }
      }, 15_000, `${kind} foreground command did not enter its real sleep`)
    } catch (error) {
      const history = await client.history(session.sessionId, 40)
      const facts = history.events.filter(row => ['tool/call', 'tool/result', 'assistant/message', 'turn/end', 'agent/error'].includes(row.event.type)).slice(-6).map(row => ({ type: row.event.type, data: row.event.data }))
      throw new Error(`${error.message}; synthetic provider paths=${JSON.stringify(mock.paths)}, requests=${JSON.stringify(mock.observed)}, history=${JSON.stringify(facts).slice(-4000)}`)
    }
    const backlog = []
    let steerItem
    if (kind === 'queue') {
      for (let index = 1; index <= 10; index++) {
        const text = `SMOKE_BACKLOG_${index}`
        backlog.push(text)
        await client.prompt(session.sessionId, text)
      }
      await client.prompt(session.sessionId, 'SMOKE_PROMOTION_STEER_11')
      steerItem = await waitUntil(async () => {
        const queue = frames.filter(frame => frame.type === 'session/queue' && frame.sessionId === session.sessionId).at(-1)?.items ?? []
        return queue.find(item => JSON.stringify(item).includes('SMOKE_PROMOTION_STEER_11'))
      }, 5_000, 'The eleventh queued message did not appear in the authoritative Inbox')
    }
    const marker = kind === 'queue' ? 'SMOKE_PROMOTION_STEER_11' : 'SMOKE_DIRECT_STEER'
    const start = Date.now()
    if (steerItem !== undefined) await client.updateQueueItem(session.sessionId, steerItem.id, { kind: 'steer' })
    else await client.prompt(session.sessionId, marker, 'steer')
    const request = await waitUntil(async () => mock.observed.find(row => row.marker === marker && row.at >= start), 10_000, `${kind} steering remained blocked behind the 30-second sleep`)
    latencies.push(`${kind}=${request.at - start}ms`)
    if (kind === 'queue') {
      // Exercise the claimed-first/pending-rest boundary deliberately rather
      // than depending on whether a fast runner reaches the next turn first.
      await waitUntil(async () => mock.observed.slice(observedStart).some(row => row.marker === 'SMOKE_BACKLOG_1'), 5_000, 'The ordinary backlog did not resume after the steered step')
    }
    try {
      await access(path.join(workspace, `steer-late-${kind}.txt`))
      throw new Error(`${kind} steering did not interrupt the actual foreground sleep`)
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
    await client.cancel(session.sessionId)
    const history = await client.history(session.sessionId, 100)
    const delivered = history.events.filter(row => row.event.type === 'user/message').map(row => JSON.stringify(row.event.data))
    const queue = frames.filter(frame => frame.type === 'session/queue' && frame.sessionId === session.sessionId).at(-1)?.items ?? []
    for (const text of backlog) {
      const copies = delivered.filter(value => value.includes(`\"text\":\"${text}\"`)).length
        + queue.filter(item => JSON.stringify(item).includes(`\"text\":\"${text}\"`)).length
      if (copies !== 1) throw new Error(`Steering lost or duplicated ${text}: ${copies} occurrences`)
    }
    const scenarioRequests = mock.observed.slice(observedStart)
    const firstBacklog = scenarioRequests.findIndex(row => row.marker === 'SMOKE_BACKLOG_1')
    if (kind === 'queue' && firstBacklog >= 0 && scenarioRequests.findIndex(row => row.marker === marker) > firstBacklog) {
      throw new Error('Queue promotion delivered older queued input before the steered message')
    }
  }
  return latencies.join(', ')
}

export async function verifyHostSchedules(client, workspace) {
  const sessions = []
  for (const suffix of ['A', 'B']) {
    const session = await client.createSession(workspace, 'standard')
    sessions.push(session.sessionId)
    await client.prompt(session.sessionId, `SMOKE_SCHEDULE_${suffix}`)
    await waitUntil(async () => (await client.listSchedules(session.sessionId)).length === 1, 10_000, 'Host reminder was not created')
  }
  const reminder = (await client.listSchedules(sessions[0]))[0]
  await client.deleteSchedule(sessions[0], reminder.id)
  if ((await client.listSchedules(sessions[0])).length !== 0 || (await client.listSchedules(sessions[1])).length !== 1) throw new Error('Schedule deletion was not scoped to its original Session')
  const other = (await client.listSchedules(sessions[1]))[0]
  await client.deleteSchedule(sessions[1], other.id)
}

export async function waitUntil(read, timeoutMs, message) {
  const end = Date.now() + timeoutMs
  while (Date.now() < end) {
    const value = await read()
    if (value) return value
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error(message)
}

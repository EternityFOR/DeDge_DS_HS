import assert from 'node:assert/strict'
import * as path from 'node:path'
import { pathToFileURL } from 'node:url'

/** Actual shipped adapter, synthetic HTTP only. No real endpoint/key is used. */
export async function verifyResponseAdapter(modules) {
  await verifyRetryPolicies(modules)
  const { DeepSeekAdapter, resolveAdapterOptions } = await import(pathToFileURL(path.join(modules, '@deepseek-ai/dsh-llm-deepseek/lib/index.js')).href)
  const fetchBefore = globalThis.fetch
  let fixture
  let calls = 0
  globalThis.fetch = async (url) => {
    assert.equal(String(url), 'http://127.0.0.1:1/anthropic/v1/messages')
    calls++
    const bytes = new TextEncoder().encode(fixture.wire)
    return new Response(new ReadableStream({ start(controller) {
      const size = fixture.fragmented ? 7 : bytes.length
      for (let i = 0; i < bytes.length; i += size) controller.enqueue(bytes.slice(i, i + size))
      controller.close()
    } }), { headers: { 'content-type': 'text/event-stream' } })
  }
  const options = resolveAdapterOptions({ baseURL: 'http://127.0.0.1:1/anthropic', thinking: 'enabled', reasoningEffort: 'max', models: [{ id: 'deepseek-flash' }] })
  const adapter = new DeepSeekAdapter({ options: () => options, resolveAuth: async () => ({ headers: { 'x-api-key': 'synthetic-not-a-secret' } }), resolveUserId: () => 'synthetic', prepareExtensions: async () => ({ fields: {}, accept: async () => {} }) })
  const thinking = { type: 'thinking', thinking: 'Synthetic reasoning. Not a final answer.' }
  const text = { type: 'text', text: '中文 answer 🙂' }
  const tool = { type: 'tool_use', id: 'test-call', name: 'read', input: {} }
  const cases = [
    { name: 'text', blocks: [text], finish: 'stop' },
    { name: 'reasoning/text', blocks: [thinking, text], finish: 'stop' },
    { name: 'fragmented UTF-8', blocks: [thinking, text], finish: 'stop', fragmented: true },
    { name: 'reasoning only', blocks: [thinking], error: 'EMPTY_RESPONSE' },
    { name: 'blank text', blocks: [{ type: 'text', text: ' \n\t' }], error: 'EMPTY_RESPONSE' },
    { name: 'reasoning/blank text', blocks: [thinking, { type: 'text', text: ' ' }], error: 'EMPTY_RESPONSE' },
    { name: 'empty', blocks: [], error: 'EMPTY_RESPONSE' },
    { name: 'stop sequence', blocks: [thinking], stop: 'stop_sequence', error: 'EMPTY_RESPONSE' },
    { name: 'tool use', blocks: [thinking, tool], stop: 'tool_use', finish: 'tool-calls' },
    { name: 'token limit', blocks: [thinking], stop: 'max_tokens', finish: 'max-tokens' },
    { name: 'missing terminal', blocks: [thinking], omitStop: true, error: 'STREAM_CLOSED' },
  ]
  try {
    for (const test of cases) {
      const events = [{ type: 'message_start', message: { usage: { input_tokens: 20, output_tokens: 0 } } }]
      for (const [index, block] of test.blocks.entries()) {
        events.push({ type: 'content_block_start', index, content_block: block }, { type: 'content_block_stop', index })
      }
      events.push({ type: 'message_delta', delta: { stop_reason: test.stop ?? 'end_turn' }, usage: { output_tokens: 10 } })
      if (!test.omitStop) events.push({ type: 'message_stop' })
      fixture = { ...test, wire: events.map(event => 'event: ' + event.type + '\ndata: ' + JSON.stringify(event) + '\n\n').join('') }
      const chunks = []
      let failure
      try {
        for await (const chunk of adapter.stream({ provider: 'deepseek-official', model: 'deepseek-flash', reasoningEffort: 'max', messages: [{ role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'Synthetic test' }] }], tools: [] })) chunks.push(chunk)
      } catch (error) { failure = error }
      assert.equal(failure?.code, test.error, test.name)
      if (test.error) assert.equal(chunks.some(chunk => chunk.type === 'finish'), false, test.name)
      else assert.equal(chunks.find(chunk => chunk.type === 'finish')?.reason.kind, test.finish, test.name)
      if (test.error === 'EMPTY_RESPONSE') assert.equal(chunks.find(chunk => chunk.type === 'usage')?.usage.totalTokens, 30, 'Failed attempt usage must survive')
      if (test.blocks.includes(thinking)) assert.equal(chunks.find(chunk => chunk.type === 'reasoning-delta')?.text, thinking.thinking)
      if (test.blocks.includes(text)) assert.equal(chunks.find(chunk => chunk.type === 'text-delta')?.text, text.text)
    }
    assert.equal(calls, cases.length, 'Adapter itself must never replay a request')
  } finally { globalThis.fetch = fetchBefore }
  console.log('Response adapter smoke passed: ' + cases.length + ' actual-adapter protocol cases, retained usage, no network or internal resend.')
}

async function verifyRetryPolicies(modules) {
  const { apply } = await import(pathToFileURL(path.join(modules, '@deepseek-ai/dsh-llm-retry/lib/index.js')).href)
  for (const scenario of ['normal', 'always', 'disabled', 'excluded', 'server']) {
    let definition, recover
    let state = {}
    const events = []
    const ctx = {
      sessionProjections: { register(value) { definition = value }, stateOf() { return state } },
      on(name, handler) { assert.equal(name, 'agent/request-error'); recover = handler; return () => {} },
      effect() {}, logger: { warn() {} },
    }
    apply(ctx, {}, { random: () => 0.5 })
    const session = { append(type, data) { events.push({ type, data }); state = definition.apply(state, { type, data }) } }
    const signal = new AbortController().signal
    const policy = { mode: scenario === 'always' ? 'always' : 'normal', maxRetries: scenario === 'disabled' ? 0 : 5, retryableCodes: scenario === 'excluded' ? ['SERVER'] : ['EMPTY_RESPONSE', 'SERVER'], initialDelayMs: 1, maxDelayMs: 1, jitterRatio: 0 }
    const payload = { agent: { session }, turn: 1, step: 1, provider: 'test', retryPolicy: policy, signal, failure: { code: scenario === 'server' ? 'SERVER' : 'EMPTY_RESPONSE', message: 'Synthetic failure' } }
    const results = []
    for (let i = 0; i < 7; i++) results.push(await recover(payload, async () => undefined))
    const expected = scenario === 'disabled' || scenario === 'excluded' ? 0 : scenario === 'server' ? 5 : 1
    assert.equal(results.filter(value => value?.kind === 'retry').length, expected, scenario)
    assert.equal(events.filter(value => value.type === 'llm/retry').length, expected, scenario)
    if (expected) {
      state = definition.apply(state, { type: 'step/start' })
      assert.equal((await recover(payload, async () => undefined))?.kind, 'retry', 'New step gets its own recovery budget')
    }
  }
  console.log('Retry policy smoke passed: normal/always bounded, explicit zero/exclusions respected, other errors unchanged, per-step reset.')
}

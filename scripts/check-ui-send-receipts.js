// Run the synthetic Webview preview, snapshot it with playwright-cli, then
// pass this file's UTF-8 contents to playwright-cli run-code. No real sessions,
// API credentials, remote models, VS Code restarts, or extension install.
async page => {
  const emit = async message => {
    await page.evaluate(value => window.postMessage(value, '*'), message)
    await page.waitForTimeout(80)
  }
  const base = await page.evaluate(() => window.__previewState)
  const state = (messages, running) => ({ ...base, hasMoreHistory: false, messages, sessions: base.sessions.map(s => ({ ...s, running: s.id === base.activeSessionId && running })) })
  const check = async (name, pending, spinning) => {
    const actual = await page.evaluate(() => ({ pending: document.querySelectorAll('.pending-send').length, spinning: !!document.querySelector('.response-waiting:not(.hidden)') }))
    if (actual.pending !== pending || actual.spinning !== spinning) throw new Error(`${name}: ${JSON.stringify(actual)}`)
  }
  for (const [kind, label] of [['image', 'Image: image.png'], ['file', 'pasted-text.txt'], ['selection', 'main.c(111-220)']]) {
    await emit({ type: 'state', state: state([], false), attachments: [] })
    const id = `request-${kind}`
    await emit({ type: 'sendStarted', text: '', mode: 'queue', attachments: [{ label }], requestId: id })
    await check(`${kind}: submitting`, 1, false)
    await emit({ type: 'sendSettled', text: '', accepted: true, requestId: id })
    await emit({ type: 'state', state: state([], true), attachments: [] })
    await check(`${kind}: accepted pending admission`, 1, true)
    const user = { id: `user-${kind}`, requestId: id, role: 'user', text: '', seq: 100, attachments: [{ kind, label }], taskId: `turn-${kind}`, taskComplete: false }
    await emit({ type: 'state', state: state([user], true), attachments: [] })
    await check(`${kind}: durable user input, no duplicate`, 0, true)
    if (!await page.locator('[data-message-id="'+user.id+'"]').getByText('Waiting', { exact: true }).count()) throw new Error(`${kind}: no real waiting badge`)
    const reasoning = { id: `r-${kind}`, role: 'reasoning', text: 'Inspecting the attachment', seq: 101, taskId: `turn-${kind}`, taskComplete: false }
    await emit({ type: 'state', state: state([user, reasoning], true), attachments: [] })
    if (await page.locator('[data-message-id="'+user.id+'"]').getByText('Waiting', { exact: true }).count()) throw new Error(`${kind}: user badge survived model output`)
    const answer = { id: `a-${kind}`, role: 'assistant', text: 'Attachment processed.', seq: 102, taskId: `turn-${kind}`, taskComplete: true }
    await emit({ type: 'state', state: state([{ ...user, taskComplete: true }, { ...reasoning, taskComplete: true }, answer], false), attachments: [] })
    await check(`${kind}: completed`, 0, false)
    await emit({ type: 'sendStarted', text: '', mode: 'queue', attachments: [{ label }], requestId: id })
    await emit({ type: 'sendSettled', text: '', accepted: true, requestId: id })
    await check(`${kind}: late duplicate host receipt`, 0, false)
  }
  await page.screenshot({ path: 'output/playwright/attachment-receipt-complete.png' })
  return { passed: ['image-only', 'paste-only', 'selection-only', 'durable acknowledgement', 'model output', 'completion', 'late duplicate receipt'] }
}

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const source = await readFile(join(root, 'src', 'ui', 'chat-view.ts'), 'utf8')
const template = /return `(<!doctype html>[\s\S]*?<\/html>)`/u.exec(source)?.[1]
if (template === undefined) throw new Error('Could not locate the Webview HTML template.')

const state = {
  phase: 'connected',
  runtime: { phase: 'ready', version: '0.1.0-rc.7' },
  hasApiKey: true,
  sessions: [
    { id: 'one', title: 'DeDge_DS_HS', running: false, blank: false },
    { id: 'two', title: 'Windows compatibility audit', running: true, blank: false },
    { id: 'three', title: 'Codex handoff isolation', running: false, blank: false },
    { id: 'four', title: 'Long renamed session title that must truncate', running: false, blank: false },
    { id: 'five', title: 'API endpoint', running: false, blank: false },
  ],
  activeSessionId: 'one',
  messages: [
    {
      id: 'u1',
      role: 'user',
      text: 'Continue the unfinished task after checking the workspace.',
      attachments: [{ kind: 'handoff', label: 'Codex handoff - DeDge_DS_HS' }],
      status: 'complete',
      taskId: 'turn:1',
      taskComplete: true,
    },
    { id: 'r1', role: 'reasoning', text: 'Inspecting the relevant implementation and official runtime behavior.', status: 'complete', taskId: 'turn:1', taskComplete: true },
    { id: 't1', role: 'tool', title: 'read_file', text: 'Intermediate tool output.', status: 'complete', taskId: 'turn:1', taskComplete: true },
    { id: 'u2', role: 'user', text: 'Also keep the inserted message inside this task.', status: 'complete', taskId: 'turn:1', taskComplete: true },
    { id: 'a1', role: 'assistant', text: 'The preview keeps the first prompt and final summary visible while folding all intermediate work.', status: 'complete', taskId: 'turn:1', taskComplete: true },
  ],
  hasMoreHistory: true,
  historyLoading: false,
  approvals: [],
  questions: [],
  provider: 'deepseek-official',
  model: 'deepseek-v4-flash',
  reasoningEffort: 'high',
  agentPreset: 'standard',
  permissionMode: 'workspace-write',
  contextWindowTokens: 1_000_000,
  contextPressure: { pressureTokens: 611_000, projectedTokens: 624_000, contextWindow: 1_000_000 },
  modelCatalog: {
    current: { provider: 'deepseek-official', model: 'deepseek-v4-flash', reasoningEffort: 'high' },
    routable: true,
    failures: [],
    groups: [{
      id: 'deepseek-official',
      name: 'DeepSeek official',
      models: [
        {
          id: 'deepseek-v4-flash',
          name: 'DeepSeek-V4-Flash with a deliberately long model label',
          description: 'Fast coding model exposed by the selected endpoint.',
          reasoning: {
            defaultEffort: 'high',
            efforts: [
              { id: 'medium', name: 'Medium', description: 'Balanced reasoning depth.' },
              { id: 'high', name: 'High', description: 'More deliberate reasoning.' },
              { id: 'max', name: 'Maximum', description: 'Maximum supported reasoning depth.' },
            ],
          },
        },
        { id: 'deepseek-v4-pro', name: 'DeepSeek-V4-Pro', description: 'Higher quality route.' },
      ],
    }],
  },
  presetCatalog: {
    authorable: false,
    hasDocument: false,
    presets: [
      { id: 'standard', trust: 'system', isDefault: true, name: 'Standard', description: 'Full coding agent.' },
      { id: 'code', trust: 'system', isDefault: false, name: 'Code', description: 'Compact code-oriented presentation.' },
    ],
  },
}

const bootstrap = `<script nonce="preview">
window.acquireVsCodeApi = () => ({
  postMessage: message => { window.__lastWebviewMessage = message },
  setState: value => { window.__webviewState = value },
  getState: () => window.__webviewState,
})
</script>`
const payload = `<script nonce="preview">window.postMessage(${JSON.stringify({ type: 'state', state, attachments: [] })}, '*')</script>`
const html = template
  .replaceAll('${webview.cspSource}', "'self'")
  .replaceAll('${nonce}', 'preview')
  .replace('${script}', '../../dist/webview.js')
  .replace('<title>DeepSeek Harness</title>', '<title>DeepSeek Harness</title>\n  <link rel="icon" href="data:,">')
  .replace('<script nonce="preview" src="../../dist/webview.js"></script>', `${bootstrap}\n<script nonce="preview" src="../../dist/webview.js"></script>\n${payload}`)

const output = join(root, '.tmp', 'ui-preview', 'index.html')
await mkdir(dirname(output), { recursive: true })
await writeFile(output, html, 'utf8')
console.log(output)

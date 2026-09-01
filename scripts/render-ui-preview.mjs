import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const source = await readFile(join(root, 'src', 'ui', 'chat-view.ts'), 'utf8')
const template = /return `(<!doctype html>[\s\S]*?<\/html>)`/u.exec(source)?.[1]
if (template === undefined) throw new Error('Could not locate the Webview HTML template.')

const state = {
  phase: 'connected',
  runtime: { phase: 'ready', version: '0.1.1-rc.1' },
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
    { id: 'r1', role: 'reasoning', text: 'A deliberately early reasoning event used to verify that the user prompt still renders first.', status: 'complete', taskId: 'turn:1', taskComplete: true },
    {
      id: 'u1',
      role: 'user',
      text: 'Continue the unfinished task after checking the workspace.',
      attachments: [
        { kind: 'handoff', label: 'Codex handoff - DeDge_DS_HS' },
        { kind: 'vision', label: 'Vision: screenshot.png', model: 'gpt-vision', detail: 'The screenshot shows a compact VS Code sidebar with a message composer and session controls.' },
      ],
      status: 'complete',
      taskId: 'turn:1',
      taskComplete: true,
    },
    { id: 't1', role: 'tool', title: 'read_file', text: 'Intermediate tool output.', status: 'complete', taskId: 'turn:1', taskComplete: true },
    { id: 'u2', role: 'user', text: 'Also keep the inserted message inside this task.', status: 'complete', taskId: 'turn:1', taskComplete: true },
    { id: 'a-stage', role: 'assistant', text: 'I found the relevant implementation. Checking the remaining details now.', status: 'complete', taskId: 'turn:1', taskComplete: true },
    { id: 't2', role: 'tool', title: 'run_code', text: 'Tool output that belongs to the preceding assistant segment.', status: 'complete', taskId: 'turn:1', taskComplete: true },
    { id: 'r2', role: 'reasoning', text: 'Reasoning that should collapse with the preceding assistant segment.', status: 'complete', taskId: 'turn:1', taskComplete: true },
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
        { id: 'deepseek-v4-flash-vision-exp', name: 'DeepSeek-V4-Flash-Vision-Exp', description: 'Experimental official image-input route.' },
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
const previewSettings = {
  baseUrl: 'https://api.deepseek.com/', hasApiKey: true,
  visionBaseUrl: 'https://api.deepseek.com/', visionModel: 'deepseek-v4-flash-vision-exp', visionReasoningEffort: '', mainModelVisionCapable: false, auxiliaryVisionEnabled: false, visionModels: ['deepseek-v4-flash-vision-exp'], hasVisionApiKey: true,
  compactionProvider: '', compactionModel: '',
  pasteFileThreshold: 4096, contextWindowTokens: 1000000,
  scheduleEnabled: true,
  codexHome: '\${userHome}/.codex', claudeHome: '\${userHome}/.claude', handoffLaunchMode: 'clipboard',
  skillDirectories: ['\${userHome}/.codex/skills'],
}
window.acquireVsCodeApi = () => ({
  postMessage: message => {
    window.__lastWebviewMessage = message
    if (message.type === 'openSettings' || message.type === 'openVisionSettings') {
      window.postMessage({ type: 'settings', settings: previewSettings, ...(message.type === 'openVisionSettings' ? { section: 'vision' } : {}) }, '*')
    }
    if (message.type === 'inspectPrompt') window.postMessage({ type: 'promptInspection', inspection: {
      scope: 'Preview preflight prompt layers',
      limitation: 'Preview only. The live Harness may add provider system instructions, tool schemas, and compaction state after session.prompt.',
      layers: [
        { id: 'profile', label: 'Harness profile', source: 'Runtime configuration', detail: 'standard preset | workspace-write', text: 'Agent preset: standard\\nPermission: workspace-write\\nProvider/model: deepseek-official/deepseek-v4-flash', bytes: 96, enabled: true },
        { id: 'user', label: 'User message', source: 'Composer', detail: 'Exact current draft', text: 'Continue the task with the attached context.', bytes: 45, enabled: true },
      ],
    } }, '*')
    if (message.type === 'compact' && window.__previewState !== undefined) {
      window.__previewState = {
        ...window.__previewState,
        sessions: window.__previewState.sessions.map(session => session.id === window.__previewState.activeSessionId
          ? { ...session, operation: 'compacting' }
          : session),
      }
      window.postMessage({ type: 'state', state: window.__previewState, attachments: [] }, '*')
      window.setTimeout(() => {
        window.__previewState = {
          ...window.__previewState,
          sessions: window.__previewState.sessions.map(session => session.id === window.__previewState.activeSessionId
            ? { ...session, operation: undefined }
            : session),
        }
        window.postMessage({ type: 'state', state: window.__previewState, attachments: [] }, '*')
        window.postMessage({ type: 'notice', level: 'info', message: 'Compacted 926 history items (~521683 tokens).' }, '*')
      }, 10_000)
    }
    if (message.type === 'send' && window.__previewState !== undefined) {
      window.postMessage({ type: 'sendStarted', text: message.text, attachments: [] }, '*')
      window.setTimeout(() => {
        window.postMessage({ type: 'state', state: window.__previewState, attachments: [] }, '*')
      }, 50)
    }
    if ((message.type === 'loadOlderHistory' || message.type === 'loadAllHistory') && window.__previewState !== undefined) {
      window.postMessage({ type: 'state', state: { ...window.__previewState, historyLoading: true }, attachments: [] }, '*')
      window.setTimeout(() => {
        window.__previewState = {
          ...window.__previewState,
          hasMoreHistory: false,
          historyExpanded: true,
          historyPageCount: 1,
          historyLoading: false,
          messages: [
            { id: 'old-u', role: 'user', text: 'This is the earlier task and must stay above the current task.', status: 'complete', taskId: 'turn:0', taskComplete: true },
            { id: 'old-r', role: 'reasoning', text: 'Earlier reasoning.', status: 'complete', taskId: 'turn:0', taskComplete: true },
            { id: 'old-a', role: 'assistant', text: 'Earlier task completed.', status: 'complete', taskId: 'turn:0', taskComplete: true },
            ...window.__previewState.messages,
          ],
        }
        window.postMessage({ type: 'state', state: window.__previewState, attachments: [] }, '*')
      }, 450)
    }
    if ((message.type === 'hideOlderHistory' || message.type === 'hideAllOlderHistory') && window.__previewState !== undefined) {
      window.__previewState = {
        ...window.__previewState,
        hasMoreHistory: true,
        historyExpanded: false,
        historyPageCount: 0,
        messages: window.__previewState.messages.filter(item => !String(item.id).startsWith('old-')),
      }
      window.postMessage({ type: 'state', state: window.__previewState, attachments: [] }, '*')
    }
  },
  setState: value => { window.__webviewState = value },
  getState: () => window.__webviewState,
})
</script>`
const payload = `<script nonce="preview">window.__previewState = ${JSON.stringify(state)}; window.postMessage({ type: 'state', state: window.__previewState, attachments: [] }, '*'); window.postMessage({ type: 'settings', settings: previewSettings, open: false }, '*')</script>`
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

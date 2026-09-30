import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const source = await readFile(join(root, 'src', 'ui', 'chat-view.ts'), 'utf8')
const template = /return `(<!doctype html>[\s\S]*?<\/html>)`/u.exec(source)?.[1]
if (template === undefined) throw new Error('Could not locate the Webview HTML template.')

const state = {
  phase: 'connected',
  runtime: { phase: 'ready', version: '0.2.0-rc.2' },
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
  model: 'deepseek-flash',
  reasoningEffort: 'high',
  agentPreset: 'standard',
  permissionMode: 'workspace-write',
  contextWindowTokens: 1_000_000,
  contextPressure: { pressureTokens: 611_000, projectedTokens: 624_000, contextWindow: 1_000_000 },
  modelCatalog: {
    current: { provider: 'deepseek-official', model: 'deepseek-flash', reasoningEffort: 'high' },
    routable: true,
    failures: [],
    groups: [{
      id: 'deepseek-official',
      name: 'DeepSeek official',
      models: [
        {
          id: 'deepseek-flash',
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

if (process.argv.includes('--steering')) {
  state.sessions[0].running = true
  state.messages = [
    { id: 'steer-u1', role: 'user', text: 'Please prepare a design document and wait for feedback.', status: 'complete', taskId: 'turn:steering', taskComplete: false },
    { id: 'steer-r1', role: 'reasoning', text: 'Reviewing the design requirements.', status: 'complete', taskId: 'turn:steering', taskComplete: false },
    { id: 'steer-t1', role: 'tool', title: 'pwsh', text: '{"command":"Start-Sleep -Seconds 30","description":"Synthetic foreground wait"}', status: 'streaming', taskId: 'turn:steering', taskComplete: false },
  ]
  state.queueItems = [
    ...Array.from({ length: 11 }, (_, index) => ({ id: `queued-${index + 1}`, placement: 'queued', sourceKind: 'user', text: `Queued design section ${index + 1}: this is a deliberately long synthetic prompt that should truncate without hiding its action buttons.` })),
    { id: 'steering-pending', placement: 'steering', sourceKind: 'user', text: 'Please interrupt the foreground wait and continue with this feedback.' },
  ]
}

if (process.argv.includes('--scheduled')) {
  state.sessions[0].running = false
  state.messages = [
    { id: 'schedule-u', role: 'user', text: 'Remind me to continue the design later.', status: 'complete', taskId: 'turn:scheduled', taskComplete: true },
    { id: 'schedule-a', role: 'assistant', text: 'Two synthetic Host reminders are armed.', status: 'complete', taskId: 'turn:scheduled', taskComplete: true },
  ]
  state.queueItems = []
  state.schedules = [
    { id: 'schedule-nearest', title: 'Continue the design', kind: 'after', prompt: 'Synthetic reminder', afterSeconds: 90, scheduledAt: new Date(Date.now() + 90_000).toISOString() },
    { id: 'schedule-later', title: 'Review the result', kind: 'after', prompt: 'Synthetic reminder', afterSeconds: 3600, scheduledAt: new Date(Date.now() + 3_600_000).toISOString() },
  ]
}

const bootstrap = `<script nonce="preview">
window.__previewMessages = []
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
    window.__previewMessages.push(message)
    if (['steerQueueItem', 'removeQueueItem', 'editQueueItem'].includes(message.type) && window.__previewState !== undefined) {
      window.setTimeout(() => {
        window.__previewState = { ...window.__previewState, queueItems: window.__previewState.queueItems.flatMap(item =>
          item.id !== message.itemId ? [item] : message.type === 'removeQueueItem' ? []
            : [{ ...item, ...(message.type === 'steerQueueItem' ? { placement: 'steering' } : { text: message.text }) }]) }
        window.postMessage({ type: 'state', state: window.__previewState, attachments: [] }, '*')
        window.postMessage({ type: 'queueActionSettled', itemId: message.itemId, accepted: true }, '*')
      }, 120)
    }
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
// VS Code normally injects these variables. Synthetic browser previews must
// supply them too, or missing fonts/colors falsely resemble a broken UI.
const themeStyle = `<style nonce="preview">:root {
  color-scheme: dark !important;
  --vscode-font-family: "Segoe UI", sans-serif; --vscode-font-size: 13px;
  --vscode-editor-font-family: Consolas, monospace; --vscode-editor-font-size: 12px;
  --vscode-editor-background: #1e1e1e; --vscode-sideBar-background: #181818; --vscode-foreground: #cccccc;
  --vscode-icon-foreground: #cccccc; --vscode-toolbar-hoverBackground: #ffffff1a;
  --vscode-editor-inactiveSelectionBackground: #264f78; --vscode-charts-yellow: #cca700;
  --vscode-descriptionForeground: #9d9d9d; --vscode-panel-border: #3c3c3c;
  --vscode-input-background: #252526; --vscode-input-foreground: #cccccc; --vscode-input-border: #3c3c3c;
  --vscode-focusBorder: #007fd4; --vscode-button-background: #0e639c; --vscode-button-foreground: #ffffff;
  --vscode-button-hoverBackground: #1177bb; --vscode-editorWidget-background: #252526;
  --vscode-list-hoverBackground: #2a2d2e; --vscode-list-activeSelectionBackground: #094771;
  --vscode-charts-orange: #d18616; --vscode-charts-blue: #75beff; --vscode-charts-green: #89d185;
  --vscode-progressBar-background: #0e70c0; --vscode-errorForeground: #f48771;
  --vscode-textLink-foreground: #3794ff; --vscode-textCodeBlock-background: #2a2a2a;
  --vscode-scrollbarSlider-background: #79797966; --vscode-scrollbarSlider-hoverBackground: #646464b3;
  --vscode-badge-background: #4d4d4d; --vscode-badge-foreground: #ffffff;
}</style>`
const html = template
  .replaceAll('\\u258d', '\u258d')
  .replaceAll('${webview.cspSource}', "'self'")
  .replaceAll('${nonce}', 'preview')
  .replace('${script}', '../../dist/webview.js')
  .replace('<title>DeepSeek Harness</title>', `<title>DeepSeek Harness</title>\n  <link rel="icon" href="data:,">\n${themeStyle}`)
  .replace('<script nonce="preview" src="../../dist/webview.js"></script>', `${bootstrap}\n<script nonce="preview" src="../../dist/webview.js"></script>\n${payload}`)

const output = join(root, '.tmp', 'ui-preview', 'index.html')
await mkdir(dirname(output), { recursive: true })
await writeFile(output, html, 'utf8')
console.log(output)

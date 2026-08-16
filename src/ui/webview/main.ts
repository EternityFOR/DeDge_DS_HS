import DOMPurify from 'dompurify'
import {
  ArrowLeftRight,
  Check,
  ChevronDown,
  createIcons,
  Diff,
  Ellipsis,
  KeyRound,
  LoaderCircle,
  Paperclip,
  Plus,
  Settings2,
  Send,
  ShieldCheck,
  Shrink,
  Square,
  TextQuote,
  TriangleAlert,
  X,
} from 'lucide'
import { marked } from 'marked'
import type { ContextAttachment } from '../../context/context-collector.js'
import type { WorkbenchMessage, WorkbenchSnapshot } from '../../session/types.js'
import type { HostToWebviewMessage, WebviewToHostMessage } from '../webview-protocol.js'

declare function acquireVsCodeApi(): { postMessage(message: WebviewToHostMessage): void; setState(value: unknown): void; getState(): unknown }

const vscode = acquireVsCodeApi()
const icons = { ArrowLeftRight, Check, ChevronDown, Diff, Ellipsis, KeyRound, LoaderCircle, Paperclip, Plus, Send, Settings2, ShieldCheck, Shrink, Square, TextQuote, TriangleAlert, X }
const contextCircumference = 2 * Math.PI * 5.5
let state: WorkbenchSnapshot | undefined
let attachments: readonly ContextAttachment[] = []
let sessionTabsSignature = ''
let noticeTimer: number | undefined

marked.setOptions({ gfm: true, breaks: false })

const elements = {
  sessionTabs: required('session-tabs'),
  conversation: required('conversation'),
  prompt: requiredTextArea('prompt'),
  composerBox: required('composer-box'),
  attachments: required('attachments'),
  notice: required('notice'),
  permissionLabel: required('permission-label'),
  permissionOptions: required('permission-options'),
  modelLabel: required('model-label'),
  modelOptions: required('model-options'),
  reasoningOptions: required('reasoning-options'),
  presetOptions: required('preset-options'),
  contextMeterAnchor: required('context-meter-anchor'),
  contextMeter: required('context-meter'),
  contextTooltip: required('context-tooltip'),
  contextFill: requiredSvgCircle('context-fill'),
  contextPercent: required('context-percent'),
  contextFigures: required('context-figures'),
  modelMenu: requiredButton('model-menu'),
  send: requiredButton('send'),
  cancel: requiredButton('cancel'),
  compact: requiredButton('compact'),
  configureContext: requiredButton('configure-context'),
  statusDot: required('status-dot'),
  statusText: required('status-text'),
}

const popovers = [
  popover('attach-menu', 'attach-popover'),
  popover('permission-menu', 'permission-popover'),
  popover('model-menu', 'model-popover'),
]

bindAction('attach-selection', { type: 'attachSelection' })
bindAction('attach-file', { type: 'attachFile' })
bindAction('attach-problems', { type: 'attachDiagnostics' })
bindAction('review', { type: 'reviewChanges' })
bindAction('handoff', { type: 'handoff' })
bindAction('set-key', { type: 'setApiKey' })
bindAction('compact', { type: 'compact' })
bindAction('configure-context', { type: 'configureContextWindow' })
bindAction('cancel', { type: 'cancel' })
requiredButton('send').addEventListener('click', send)

elements.prompt.addEventListener('keydown', event => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault()
    send()
  }
})
elements.prompt.addEventListener('input', resizePrompt)
elements.prompt.addEventListener('paste', event => { void handlePaste(event) })
elements.composerBox.addEventListener('dragover', event => {
  if (!hasAttachableData(event.dataTransfer)) return
  event.preventDefault()
  if (event.dataTransfer !== null) event.dataTransfer.dropEffect = 'copy'
  elements.composerBox.classList.add('drop-active')
})
elements.composerBox.addEventListener('dragleave', event => {
  const related = event.relatedTarget
  if (related instanceof Node && elements.composerBox.contains(related)) return
  elements.composerBox.classList.remove('drop-active')
})
elements.composerBox.addEventListener('drop', event => { void handleDrop(event) })
elements.contextMeterAnchor.addEventListener('pointerenter', positionContextTooltip)
elements.contextMeterAnchor.addEventListener('focusin', positionContextTooltip)

document.addEventListener('click', event => {
  const target = event.target
  if (target instanceof Node && popovers.some(item => item.anchor.contains(target))) return
  closePopovers()
})
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') closePopovers()
})
window.addEventListener('resize', () => {
  for (const item of popovers) {
    if (!item.popover.classList.contains('hidden')) positionPopover(item)
  }
  if (!elements.contextMeterAnchor.classList.contains('hidden')) positionContextTooltip()
})

window.addEventListener('message', event => {
  const message = event.data as HostToWebviewMessage
  if (message.type === 'state') {
    state = message.state
    attachments = message.attachments
    render()
  } else if (message.type === 'setDraft') {
    elements.prompt.value = message.text
    resizePrompt()
    elements.prompt.focus()
  } else if (message.type === 'notice') showNotice(message.message)
})

createIcons({ icons })
resizePrompt()
post({ type: 'ready' })

function render(): void {
  if (state === undefined) return
  renderSessionTabs(state)
  renderControls(state)
  renderContextMeter(state)
  renderConversation(state)
  renderAttachments()
  renderStatus(state)
  vscode.setState({ activeSessionId: state.activeSessionId })
  createIcons({ icons })
}

function renderControls(snapshot: WorkbenchSnapshot): void {
  renderModelOptions(snapshot)
  renderReasoningOptions(snapshot)
  renderPresetOptions(snapshot)
  renderPermissionOptions(snapshot)
}

function renderSessionTabs(snapshot: WorkbenchSnapshot): void {
  const signature = JSON.stringify({
    activeSessionId: snapshot.activeSessionId,
    sessions: snapshot.sessions.map(session => [session.id, session.title, session.running, session.operation]),
  })
  if (signature === sessionTabsSignature) return
  sessionTabsSignature = signature
  const scrollLeft = elements.sessionTabs.scrollLeft
  const activeId = snapshot.activeSessionId
  const nodes = snapshot.sessions.map(session => {
    const wrapper = document.createElement('div')
    wrapper.className = 'session-tab-wrap'
    wrapper.setAttribute('role', 'presentation')
    const button = document.createElement('button')
    button.type = 'button'
    button.className = `session-tab${session.running ? ' running' : ''}${session.operation === undefined ? '' : ' operation'}`
    button.disabled = session.operation !== undefined
    button.setAttribute('role', 'tab')
    button.setAttribute('aria-selected', String(session.id === activeId))
    button.title = session.operation === 'deleting'
      ? `${session.title} - deletion in progress`
      : session.operation === 'archiving'
        ? `${session.title} - archive in progress`
        : session.operation === 'cancelling'
          ? `${session.title} - stopping response`
          : `${session.title}${session.running ? ' - response in progress' : ''}`
    const label = document.createElement('span')
    label.className = 'session-tab-label'
    label.textContent = session.title
    button.append(label)
    button.addEventListener('click', () => {
      if (!button.disabled && session.id !== state?.activeSessionId) post({ type: 'selectSession', sessionId: session.id })
    })
    const manage = document.createElement('button')
    manage.type = 'button'
    manage.className = 'session-tab-manage'
    manage.disabled = session.running || session.operation !== undefined
    manage.title = session.operation === 'deleting'
      ? 'Deletion in progress'
      : session.operation === 'archiving'
        ? 'Archive in progress'
        : session.operation === 'cancelling'
          ? 'Stop in progress'
          : session.running ? 'Finish or cancel the response before managing this session' : `Archive or delete ${session.title}`
    manage.setAttribute('aria-label', manage.title)
    const icon = document.createElement('i')
    icon.dataset.lucide = session.operation === undefined ? 'ellipsis' : 'loader-circle'
    if (session.operation !== undefined) icon.className = 'session-operation-icon'
    manage.append(icon)
    manage.addEventListener('click', event => {
      event.stopPropagation()
      post({ type: 'manageSession', sessionId: session.id })
    })
    wrapper.append(button, manage)
    return wrapper
  })
  elements.sessionTabs.replaceChildren(...nodes)
  elements.sessionTabs.scrollLeft = scrollLeft
}

function renderModelOptions(snapshot: WorkbenchSnapshot): void {
  const nodes: Node[] = []
  let currentName = snapshot.model
  let currentFound = false
  for (const group of snapshot.modelCatalog?.groups ?? []) {
    const heading = document.createElement('div')
    heading.className = 'menu-heading'
    heading.textContent = group.name || group.id
    nodes.push(heading)
    for (const model of group.models) {
      const selected = group.id === snapshot.provider && model.id === snapshot.model
      if (selected) {
        currentFound = true
        currentName = model.name || model.id
      }
      nodes.push(menuOption({
        label: model.name || model.id,
        ...(model.description === undefined ? {} : { description: model.description }),
        selected,
        handler: () => {
          post({ type: 'selectModel', provider: group.id, model: model.id })
          closePopovers()
        },
      }))
    }
  }
  if (!currentFound) {
    nodes.unshift(menuOption({
      label: snapshot.model,
      description: snapshot.provider,
      selected: true,
      handler: () => undefined,
    }))
  }
  elements.modelOptions.replaceChildren(...nodes)
  elements.modelLabel.textContent = currentName
  elements.modelMenu.disabled = false
}

function renderReasoningOptions(snapshot: WorkbenchSnapshot): void {
  const model = snapshot.modelCatalog?.groups
    .find(group => group.id === snapshot.provider)?.models
    .find(candidate => candidate.id === snapshot.model)
  const efforts = model?.reasoning?.efforts ?? []
  if (efforts.length === 0) {
    elements.reasoningOptions.replaceChildren(menuOption({ label: 'Default', selected: true, disabled: true, handler: () => undefined }))
    return
  }
  const selected = efforts.some(effort => effort.id === snapshot.reasoningEffort)
    ? snapshot.reasoningEffort
    : model?.reasoning?.defaultEffort ?? efforts[0]?.id
  elements.reasoningOptions.replaceChildren(...efforts.map(effort => menuOption({
    label: effort.name || effort.id,
    ...(effort.description === undefined ? {} : { description: effort.description }),
    selected: effort.id === selected,
    handler: () => {
      post({ type: 'selectModel', provider: snapshot.provider, model: snapshot.model, reasoningEffort: effort.id })
      closePopovers()
    },
  })))
}

function renderPresetOptions(snapshot: WorkbenchSnapshot): void {
  const active = snapshot.sessions.find(session => session.id === snapshot.activeSessionId)
  const locked = active?.blank !== true
  const presets = snapshot.presetCatalog?.presets?.filter(preset => preset.broken === undefined) ?? []
  const options = presets.map(preset => menuOption({
    label: preset.name ?? preset.id,
    ...(preset.description === undefined ? {} : { description: preset.description }),
    selected: preset.id === snapshot.agentPreset,
    disabled: locked,
    handler: () => {
      post({ type: 'selectPreset', preset: preset.id })
      closePopovers()
    },
  }))
  if (!presets.some(preset => preset.id === snapshot.agentPreset)) {
    options.unshift(menuOption({ label: snapshot.agentPreset, selected: true, disabled: locked, handler: () => undefined }))
  }
  elements.presetOptions.replaceChildren(...options)
}

function renderPermissionOptions(snapshot: WorkbenchSnapshot): void {
  const options = [
    { id: 'read-only', label: 'Read only', short: 'Read only', description: 'No model-driven file mutations' },
    { id: 'workspace-write', label: 'Workspace write', short: 'Workspace', description: 'Workspace and temporary-directory writes' },
    { id: 'danger-full-access', label: 'Full access', short: 'Full access', description: 'Unrestricted writes without approval prompts' },
  ] as const
  const current = options.find(option => option.id === snapshot.permissionMode) ?? options[1]
  elements.permissionLabel.textContent = current.short
  elements.permissionOptions.replaceChildren(...options.map(option => menuOption({
    label: option.label,
    description: option.description,
    selected: option.id === snapshot.permissionMode,
    handler: () => {
      post({ type: 'selectPermission', permission: option.id })
      closePopovers()
    },
  })))
}

function renderConversation(snapshot: WorkbenchSnapshot): void {
  const nodes: Node[] = []
  if (snapshot.messages.length === 0 && snapshot.approvals.length === 0 && snapshot.questions.length === 0) {
    const empty = document.createElement('div')
    empty.className = 'empty'
    empty.textContent = snapshot.sessions.find(session => session.id === snapshot.activeSessionId)?.title ?? `DeepSeek Harness: ${snapshot.phase}`
    nodes.push(empty)
  }
  for (const message of snapshot.messages) nodes.push(renderMessage(message))
  for (const approval of snapshot.approvals) {
    const pending = document.createElement('section')
    pending.className = 'pending'
    pending.innerHTML = '<div class="pending-title"></div><div class="pending-reason"></div><div class="actions"></div>'
    text(pending, '.pending-title', `Approval: ${approval.toolName}`)
    text(pending, '.pending-reason', approval.reason ?? 'This operation requests wider access.')
    pending.querySelector('.actions')?.append(
      commandButton('Allow once', true, () => post({ type: 'approve', approvalId: approval.id, outcome: 'allowed-once' })),
      commandButton('Reject', false, () => post({ type: 'approve', approvalId: approval.id, outcome: 'rejected' })),
    )
    nodes.push(pending)
  }
  for (const questions of groupQuestions(snapshot.questions)) nodes.push(renderQuestionBatch(questions))
  elements.conversation.replaceChildren(...nodes)
  if (snapshot.messages.some(message => message.status === 'streaming')) elements.conversation.scrollTop = elements.conversation.scrollHeight
}

function renderMessage(message: WorkbenchMessage): HTMLElement {
  if (message.role === 'reasoning' || message.role === 'tool') {
    const details = document.createElement('details')
    details.className = `message ${message.role}`
    details.open = message.status === 'streaming'
    const summary = document.createElement('summary')
    summary.textContent = message.role === 'reasoning' ? 'Reasoning' : message.title ?? 'Tool'
    const body = document.createElement('div')
    body.innerHTML = markdown(message.text)
    details.append(summary, body)
    return details
  }
  const article = document.createElement('article')
  article.className = `message ${message.role}`
  if (message.attachments !== undefined && message.attachments.length > 0) {
    const attachments = document.createElement('div')
    attachments.className = 'message-attachments'
    for (const attachment of message.attachments) {
      const item = document.createElement('span')
      item.className = 'message-attachment'
      item.title = `${attachment.label} - content hidden from the conversation view`
      const icon = document.createElement('i')
      icon.dataset.lucide = attachment.kind === 'handoff' ? 'arrow-left-right' : 'paperclip'
      const label = document.createElement('span')
      label.className = 'message-attachment-label'
      label.textContent = attachment.label
      item.append(icon, label)
      attachments.append(item)
    }
    article.append(attachments)
  }
  if (message.text !== '') {
    const body = document.createElement('div')
    body.className = 'message-copy'
    body.innerHTML = markdown(message.text)
    article.append(body)
  }
  return article
}

function renderQuestionBatch(questions: readonly WorkbenchSnapshot['questions'][number][]): HTMLElement {
  const form = document.createElement('form')
  form.className = 'pending question-batch'
  const heading = document.createElement('div')
  heading.className = 'pending-title'
  heading.textContent = questions.length === 1 ? 'Input required' : `${questions.length} questions`
  form.append(heading)

  const fields = questions.map((question, questionIndex) => {
    const field = document.createElement('fieldset')
    field.className = 'question-item'
    const legend = document.createElement('legend')
    legend.textContent = question.header ?? question.question
    field.append(legend)
    if (question.header !== undefined) {
      const prompt = document.createElement('div')
      prompt.className = 'question-prompt'
      prompt.textContent = question.question
      field.append(prompt)
    }
    if (question.detail !== undefined) {
      const detail = document.createElement('div')
      detail.className = 'question-detail'
      detail.textContent = question.detail
      field.append(detail)
    }

    const inputs: HTMLInputElement[] = []
    if (question.options.length > 0) {
      const choices = document.createElement('div')
      choices.className = 'question-options'
      for (const option of question.options) {
        const label = document.createElement('label')
        label.className = 'question-option'
        const input = document.createElement('input')
        input.type = question.multiSelect ? 'checkbox' : 'radio'
        input.name = `question-${questionIndex}`
        input.value = option.label
        inputs.push(input)
        const copy = document.createElement('span')
        const name = document.createElement('span')
        name.className = 'question-option-label'
        name.textContent = option.label
        copy.append(name)
        if (option.description !== undefined) {
          const description = document.createElement('span')
          description.className = 'question-option-description'
          description.textContent = option.description
          copy.append(description)
        }
        label.append(input, copy)
        choices.append(label)
      }
      field.append(choices)
    }

    const custom = document.createElement('input')
    custom.type = 'text'
    custom.className = 'question-custom'
    custom.placeholder = question.options.length === 0 ? 'Type your answer' : 'Custom answer (optional)'
    custom.setAttribute('aria-label', `${question.header ?? question.question}: custom answer`)
    if (!question.multiSelect) {
      for (const input of inputs) input.addEventListener('change', () => { if (input.checked) custom.value = '' })
      custom.addEventListener('input', () => {
        if (custom.value.trim() !== '') for (const input of inputs) input.checked = false
      })
    }
    field.append(custom)
    return { question, inputs, custom, field }
  })
  for (const field of fields) form.append(field.field)

  const actions = document.createElement('div')
  actions.className = 'actions question-actions'
  const submit = commandButton('Submit answers', true, () => undefined)
  submit.type = 'submit'
  actions.append(submit)
  form.append(actions)
  form.addEventListener('submit', event => {
    event.preventDefault()
    const answers = fields.map(field => {
      const selected = field.inputs.filter(input => input.checked).map(input => input.value)
      const custom = field.custom.value.trim()
      return { id: field.question.id, selected, ...(custom === '' ? {} : { custom }) }
    })
    const rpcId = questions[0]?.rpcId
    if (rpcId !== undefined) post({ type: 'answerQuestions', rpcId, answers })
  })
  return form
}

function groupQuestions(questions: WorkbenchSnapshot['questions']): WorkbenchSnapshot['questions'][] {
  const groups = new Map<string, WorkbenchSnapshot['questions'][number][]>()
  for (const question of questions) {
    const batch = groups.get(question.rpcId) ?? []
    batch.push(question)
    groups.set(question.rpcId, batch)
  }
  return [...groups.values()]
}

function renderAttachments(): void {
  elements.attachments.replaceChildren(...attachments.map(attachment => {
    const chip = document.createElement('div')
    chip.className = 'chip'
    const label = document.createElement('span')
    label.textContent = `${attachment.label}${attachment.truncated ? ' [truncated]' : ''}`
    const remove = document.createElement('button')
    remove.title = 'Remove attachment'
    remove.setAttribute('aria-label', 'Remove attachment')
    remove.innerHTML = '<i data-lucide="x"></i>'
    remove.addEventListener('click', () => post({ type: 'removeAttachment', id: attachment.id }))
    chip.append(label, remove)
    return chip
  }))
}

function renderStatus(snapshot: WorkbenchSnapshot): void {
  const active = snapshot.sessions.find(session => session.id === snapshot.activeSessionId)
  const running = active?.running === true
  const cancelling = active?.operation === 'cancelling'
  const modelUnavailable = snapshot.modelCatalog?.routable === false
  const compactionUnavailable = snapshot.agentPreset === 'minimal'
  elements.cancel.classList.toggle('hidden', !running)
  elements.cancel.disabled = cancelling
  elements.cancel.title = cancelling ? 'Stop request is being processed' : 'Stop'
  elements.cancel.setAttribute('aria-label', elements.cancel.title)
  elements.send.classList.toggle('hidden', running)
  elements.send.disabled = modelUnavailable
  const compactDisabled = snapshot.phase !== 'connected' || active === undefined || running || active.operation !== undefined || compactionUnavailable
  elements.compact.disabled = compactDisabled
  elements.compact.title = running
    ? 'Compact unavailable while a response is in progress'
    : compactionUnavailable
      ? 'Compact unavailable in the Minimal agent preset'
      : compactDisabled
        ? 'Compact context'
        : snapshot.agentPreset === 'standard' || snapshot.agentPreset === 'code' || snapshot.agentPreset === 'cordis'
          ? 'Compact context now; manual compaction does not wait for the 80% automatic threshold'
          : 'Compact context now; manual compaction runs whenever the selected preset supports it'
  elements.compact.setAttribute('aria-label', elements.compact.title)
  const capacity = snapshot.contextPressure?.contextWindow ?? snapshot.contextWindowTokens
  const trigger = Math.floor(capacity * 0.8)
  elements.configureContext.title = contextConfigurationTitle(snapshot.agentPreset, trigger)
  elements.configureContext.setAttribute('aria-label', elements.configureContext.title)
  const phase = snapshot.runtime.phase
  elements.statusDot.className = `status-dot ${phase === 'ready' ? 'ready' : phase === 'error' ? 'error' : phase === 'starting' || phase === 'resolving' ? 'busy' : ''}`
  elements.statusText.textContent = phase === 'ready'
    ? modelUnavailable
      ? 'Selected model is unavailable'
      : `${snapshot.runtime.version ?? 'Harness'}${snapshot.hasApiKey ? '' : ' - API key required'}`
    : phase === 'error' ? snapshot.runtime.error ?? snapshot.error ?? 'Runtime error' : phase
}

function renderContextMeter(snapshot: WorkbenchSnapshot): void {
  const pressure = snapshot.contextPressure
  const used = pressure?.projectedTokens ?? pressure?.pressureTokens
  const capacity = pressure?.contextWindow ?? snapshot.contextWindowTokens
  const available = used !== undefined && capacity > 0
  elements.contextMeterAnchor.classList.toggle('hidden', !available)
  if (!available) return
  const percent = Math.max(0, Math.round(used / capacity * 100))
  const ringPercent = Math.min(100, percent)
  elements.contextFill.style.strokeDasharray = `${String(contextCircumference * ringPercent / 100)} ${String(contextCircumference)}`
  elements.contextPercent.textContent = `${String(percent)}% full`
  elements.contextFigures.textContent = `${formatTokens(used)} / ${formatTokens(capacity)} tokens used`
  const trigger = Math.floor(capacity * 0.8)
  const triggerText = contextTriggerText(snapshot.agentPreset, trigger)
  const triggerElement = document.getElementById('context-trigger')
  if (triggerElement !== null) triggerElement.textContent = triggerText
  elements.contextMeter.setAttribute('aria-label', `Context window: ${String(percent)}% full, ${formatTokens(used)} of ${formatTokens(capacity)} tokens used. ${triggerText}.`)
}

function contextConfigurationTitle(preset: string, trigger: number): string {
  if (preset === 'minimal') return 'Configure context capacity; compaction is unavailable in the Minimal preset'
  if (preset === 'standard' || preset === 'code' || preset === 'cordis') {
    return `Configure context capacity; automatic compaction starts at ${formatTokens(trigger)}`
  }
  return 'Configure context capacity; automatic compaction is defined by the selected preset'
}

function contextTriggerText(preset: string, trigger: number): string {
  if (preset === 'minimal') return 'Compaction unavailable in Minimal preset'
  if (preset === 'standard' || preset === 'code' || preset === 'cordis') return `Auto compact at ${formatTokens(trigger)}`
  return 'Auto compaction is preset-defined'
}

function menuOption(options: {
  readonly label: string
  readonly description?: string
  readonly selected: boolean
  readonly disabled?: boolean
  readonly handler: () => void
}): HTMLButtonElement {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'menu-option'
  button.disabled = options.disabled === true
  button.setAttribute('role', 'menuitemradio')
  button.setAttribute('aria-checked', String(options.selected))
  const check = document.createElement('span')
  check.className = 'menu-check'
  if (options.selected) check.innerHTML = '<i data-lucide="check"></i>'
  const copy = document.createElement('span')
  copy.className = 'menu-option-copy'
  const label = document.createElement('span')
  label.className = 'menu-option-label'
  label.textContent = options.label
  copy.append(label)
  if (options.description !== undefined && options.description !== '') {
    const description = document.createElement('span')
    description.className = 'menu-option-description'
    description.textContent = options.description
    copy.append(description)
  }
  button.append(check, copy)
  button.addEventListener('click', options.handler)
  return button
}

function send(): void {
  if (state?.modelCatalog?.routable === false) return
  const value = elements.prompt.value
  if (value.trim() === '' && attachments.length === 0) return
  post({ type: 'send', text: value })
  elements.prompt.value = ''
  resizePrompt()
}

async function handlePaste(event: ClipboardEvent): Promise<void> {
  const data = event.clipboardData
  if (data === null) return
  if (data.files.length > 0) {
    event.preventDefault()
    await attachBrowserFiles(data.files)
    return
  }
  const uris = parseUriList(data.getData('text/uri-list'))
  if (uris.length > 0) {
    event.preventDefault()
    post({ type: 'attachUris', uris })
  }
}

async function handleDrop(event: DragEvent): Promise<void> {
  elements.composerBox.classList.remove('drop-active')
  const data = event.dataTransfer
  if (!hasAttachableData(data)) return
  event.preventDefault()
  if (data !== null && data.files.length > 0) {
    await attachBrowserFiles(data.files)
    return
  }
  const uris = parseUriList(data?.getData('text/uri-list') ?? '')
  if (uris.length > 0) post({ type: 'attachUris', uris })
}

async function attachBrowserFiles(files: FileList): Promise<void> {
  const payload: { readonly name: string; readonly text: string }[] = []
  for (const file of Array.from(files).slice(0, 10)) {
    payload.push({ name: file.name, text: await file.slice(0, 262_144).text() })
  }
  if (payload.length > 0) post({ type: 'attachTextFiles', files: payload })
}

function hasAttachableData(data: DataTransfer | null): boolean {
  if (data === null) return false
  return data.files.length > 0 || data.types.includes('text/uri-list')
}

function parseUriList(value: string): string[] {
  return value.split(/\r?\n/u)
    .map(line => line.trim())
    .filter(line => line !== '' && !line.startsWith('#') && (line.startsWith('file:') || line.startsWith('vscode-remote:')))
    .slice(0, 20)
}

function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${stripTrailingZero(value / 1_000_000)}M`
  if (value >= 1_000) return `${stripTrailingZero(value / 1_000)}K`
  return String(value)
}

function stripTrailingZero(value: number): string {
  return value >= 100 ? value.toFixed(0) : value >= 10 ? value.toFixed(1).replace(/\.0$/u, '') : value.toFixed(2).replace(/\.0+$/u, '').replace(/(\.\d)0$/u, '$1')
}

function resizePrompt(): void {
  elements.prompt.style.height = 'auto'
  elements.prompt.style.height = `${Math.min(240, Math.max(88, elements.prompt.scrollHeight))}px`
}

interface PopoverBinding {
  readonly button: HTMLButtonElement
  readonly popover: HTMLElement
  readonly anchor: HTMLElement
}

function popover(buttonId: string, popoverId: string): PopoverBinding {
  const button = requiredButton(buttonId)
  const popup = required(popoverId)
  const anchor = button.closest('.menu-anchor')
  if (!(anchor instanceof HTMLElement)) throw new Error(`Missing menu anchor: ${buttonId}`)
  button.addEventListener('click', event => {
    event.stopPropagation()
    const opening = popup.classList.contains('hidden')
    closePopovers()
    popup.classList.toggle('hidden', !opening)
    button.setAttribute('aria-expanded', String(opening))
    if (opening) window.requestAnimationFrame(() => {
      if (!popup.classList.contains('hidden')) positionPopover({ button, popover: popup, anchor })
    })
  })
  popup.addEventListener('click', event => event.stopPropagation())
  return { button, popover: popup, anchor }
}

function positionPopover(item: PopoverBinding): void {
  const margin = 6
  const gap = 6
  const viewportWidth = document.documentElement.clientWidth
  const viewportHeight = document.documentElement.clientHeight
  const maxViewportWidth = Math.max(40, viewportWidth - margin * 2)
  item.popover.style.maxWidth = `${String(maxViewportWidth)}px`
  item.popover.style.maxHeight = `${String(Math.max(40, viewportHeight - margin * 2))}px`

  const button = item.button.getBoundingClientRect()
  let popup = item.popover.getBoundingClientRect()
  const above = Math.max(0, button.top - gap - margin)
  const below = Math.max(0, viewportHeight - button.bottom - gap - margin)
  const placeAbove = above >= Math.min(popup.height, 160) || above > below
  const availableHeight = Math.max(40, placeAbove ? above : below)
  item.popover.style.maxHeight = `${String(availableHeight)}px`
  popup = item.popover.getBoundingClientRect()

  const preferredLeft = item.popover.classList.contains('align-right') ? button.right - popup.width : button.left
  const maxLeft = Math.max(margin, viewportWidth - popup.width - margin)
  const left = Math.min(Math.max(preferredLeft, margin), maxLeft)
  const preferredTop = placeAbove ? button.top - gap - popup.height : button.bottom + gap
  const maxTop = Math.max(margin, viewportHeight - popup.height - margin)
  const top = Math.min(Math.max(preferredTop, margin), maxTop)
  item.popover.style.left = `${String(Math.round(left))}px`
  item.popover.style.top = `${String(Math.round(top))}px`
}

function positionContextTooltip(): void {
  const margin = 6
  const gap = 6
  const viewportWidth = document.documentElement.clientWidth
  const viewportHeight = document.documentElement.clientHeight
  elements.contextTooltip.style.maxWidth = `${String(Math.max(40, viewportWidth - margin * 2))}px`
  const anchor = elements.contextMeterAnchor.getBoundingClientRect()
  const tooltip = elements.contextTooltip.getBoundingClientRect()
  const preferredLeft = anchor.left + (anchor.width - tooltip.width) / 2
  const maxLeft = Math.max(margin, viewportWidth - tooltip.width - margin)
  const left = Math.min(Math.max(preferredLeft, margin), maxLeft)
  const above = anchor.top - gap - tooltip.height
  const preferredTop = above >= margin ? above : anchor.bottom + gap
  const maxTop = Math.max(margin, viewportHeight - tooltip.height - margin)
  const top = Math.min(Math.max(preferredTop, margin), maxTop)
  elements.contextTooltip.style.left = `${String(Math.round(left))}px`
  elements.contextTooltip.style.top = `${String(Math.round(top))}px`
}

function closePopovers(): void {
  for (const item of popovers) {
    item.popover.classList.add('hidden')
    item.button.setAttribute('aria-expanded', 'false')
  }
}

function showNotice(message: string): void {
  if (noticeTimer !== undefined) window.clearTimeout(noticeTimer)
  elements.notice.textContent = message
  elements.notice.classList.remove('hidden')
  noticeTimer = window.setTimeout(() => {
    elements.notice.classList.add('hidden')
    noticeTimer = undefined
  }, 6_000)
}

function commandButton(label: string, primary: boolean, handler: () => void): HTMLButtonElement {
  const button = document.createElement('button')
  button.className = `command${primary ? ' primary' : ''}`
  button.textContent = label
  button.addEventListener('click', handler)
  return button
}

function markdown(value: string): string {
  return DOMPurify.sanitize(marked.parse(value, { async: false }) as string, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ['img', 'iframe', 'object', 'embed', 'style', 'script'],
    FORBID_ATTR: ['style', 'onerror', 'onclick'],
  })
}

function bindAction(id: string, message: WebviewToHostMessage): void {
  requiredButton(id).addEventListener('click', () => {
    closePopovers()
    post(message)
  })
}

function post(message: WebviewToHostMessage): void {
  vscode.postMessage(message)
}

function required(id: string): HTMLElement {
  const element = document.getElementById(id)
  if (element === null) throw new Error(`Missing element: ${id}`)
  return element
}

function requiredButton(id: string): HTMLButtonElement {
  const element = required(id)
  if (!(element instanceof HTMLButtonElement)) throw new Error(`Expected button: ${id}`)
  return element
}

function requiredTextArea(id: string): HTMLTextAreaElement {
  const element = required(id)
  if (!(element instanceof HTMLTextAreaElement)) throw new Error(`Expected textarea: ${id}`)
  return element
}

function requiredSvgCircle(id: string): SVGCircleElement {
  const element = document.getElementById(id)
  if (!(element instanceof SVGCircleElement)) throw new Error(`Expected SVG circle: ${id}`)
  return element
}

function text(root: Element, selector: string, value: string): void {
  const element = root.querySelector(selector)
  if (element !== null) element.textContent = value
}

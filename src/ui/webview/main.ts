import DOMPurify from 'dompurify'
import {
  ArrowLeftRight,
  Check,
  ChevronDown,
  ChevronsDown,
  ChevronsUp,
  createElement as lucideCreateElement,
  Diff,
  Ellipsis,
  FileText,
  FoldVertical,
  KeyRound,
  LoaderCircle,
  Paperclip,
  Plus,
  Send,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Shrink,
  Square,
  TextQuote,
  TriangleAlert,
  X,
} from 'lucide'
import { marked } from 'marked'
import type { ContextAttachment } from '../../context/context-collector.js'
import type { SkillSummary } from '../../skills/skill-catalog.js'
import type { WorkbenchMessage, WorkbenchSnapshot } from '../../session/types.js'
import { modelControlsUnavailableReason, promptUnavailableReason, steerAvailable } from '../../session/interaction-readiness.js'
import type { HostToWebviewMessage, WebviewToHostMessage } from '../webview-protocol.js'

declare function acquireVsCodeApi(): { postMessage(message: WebviewToHostMessage): void; setState(value: unknown): void; getState(): unknown }

const vscode = acquireVsCodeApi()
const iconComponents = {
  'arrow-left-right': ArrowLeftRight,
  'check': Check,
  'chevron-down': ChevronDown,
  'chevrons-down': ChevronsDown,
  'chevrons-up': ChevronsUp,
  'fold-vertical': FoldVertical,
  'diff': Diff,
  'ellipsis': Ellipsis,
  'file-text': FileText,
  'key-round': KeyRound,
  'loader-circle': LoaderCircle,
  'paperclip': Paperclip,
  'plus': Plus,
  'send': Send,
  'settings-2': Settings2,
  'shield-check': ShieldCheck,
  'sliders-horizontal': SlidersHorizontal,
  'shrink': Shrink,
  'square': Square,
  'text-quote': TextQuote,
  'triangle-alert': TriangleAlert,
  'x': X,
} as const
type IconName = keyof typeof iconComponents
const contextCircumference = 2 * Math.PI * 5.5

let state: WorkbenchSnapshot | undefined
let attachments: readonly ContextAttachment[] = []
let sessionTabsSignature = ''
let noticeTimer: number | undefined
let sendPending = false
let pasteFileThreshold = 8_192
let scrollBottomButton: HTMLButtonElement | undefined
let stickToBottom = true
const collapsedMessages = new Set<string>()
const turnHidden = new Set<string>()
let compactThinking = true
let skillCatalog: readonly SkillSummary[] = []
let skillPopoverVisible = false
let skillHighlight = 0
let skillFilter = ''
const sentHistory: string[] = []
let historyIndex = -1

// Rendering state: state messages are coalesced into at most one full render per animation frame.
let renderScheduled = false
let pendingState: WorkbenchSnapshot | undefined
let pendingAttachments: readonly ContextAttachment[] = []
let renderedSessionKey: string | undefined
let emptyNode: HTMLElement | undefined
let pendingAnchor: HTMLElement | undefined
let pendingSignature = ''
let controlsSignature = ''
let attachmentsSignature = ''
const messageElements = new Map<string, HTMLElement>()
const messageSignatures = new Map<string, string>()
const autoOpenedDetails = new Set<string>()
const userToggledDetails = new Set<string>()

marked.setOptions({ gfm: true, breaks: false })

const elements = {
  sessionTabs: required('session-tabs'),
  conversation: required('conversation'),
  prompt: requiredTextArea('prompt'),
  composerBox: required('composer-box'),
  attachments: required('attachments'),
  notice: required('notice'),
  permissionLabel: required('permission-label'),
  permissionMenu: requiredButton('permission-menu'),
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
  skillPopover: required('skill-popover'),
  compactThinkingButton: requiredButton('compact-thinking'),
}

const persistedWebviewState = vscode.getState()
if (typeof persistedWebviewState === 'object' && persistedWebviewState !== null && 'draft' in persistedWebviewState && typeof persistedWebviewState.draft === 'string') {
  elements.prompt.value = persistedWebviewState.draft
  resizePrompt()
}
if (typeof persistedWebviewState === 'object' && persistedWebviewState !== null && 'compactThinking' in persistedWebviewState && persistedWebviewState.compactThinking === false) {
  compactThinking = false
}
applyCompactThinkingButton()

const popovers = [
  popover('attach-menu', 'attach-popover'),
  popover('permission-menu', 'permission-popover', () => renderPermissionOptions(state)),
  popover('model-menu', 'model-popover', () => {
    if (state === undefined) return
    renderModelOptions(state)
    renderReasoningOptions(state)
    renderPresetOptions(state)
  }),
]

bindAction('attach-selection', { type: 'attachSelection' })
bindAction('attach-file', { type: 'attachFile' })
bindAction('attach-problems', { type: 'attachDiagnostics' })
bindAction('review', { type: 'reviewChanges' })
bindAction('handoff', { type: 'handoff' })
bindAction('set-key', { type: 'openSettings' })
bindAction('compact', { type: 'compact' })
bindAction('configure-context', { type: 'configureContextWindow' })
bindAction('cancel', { type: 'cancel' })
requiredButton('send').addEventListener('click', send)
elements.compactThinkingButton.addEventListener('click', () => {
  compactThinking = !compactThinking
  applyCompactThinkingButton()
  const persisted = vscode.getState()
  vscode.setState({ ...(typeof persisted === 'object' && persisted !== null ? persisted : {}), compactThinking })
  if (compactThinking) {
    for (const [id, node] of messageElements) {
      if (autoOpenedDetails.has(id) && !userToggledDetails.has(id) && node instanceof HTMLDetailsElement) {
        node.open = false
      }
    }
    autoOpenedDetails.clear()
  }
  if (state !== undefined) renderConversation(state)
})

elements.prompt.addEventListener('keydown', event => {
  if (skillPopoverVisible) {
    if (event.key === 'Enter' || event.key === 'Tab') {
      const matches = skillCatalog.filter(skill => skill.name.includes(skillFilter.toLowerCase())).slice(0, 8)
      const selected = matches[skillHighlight]
      if (selected !== undefined) {
        event.preventDefault()
        insertSkillRef(selected.name)
        hideSkillPopover()
        return
      }
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      const count = Math.min(8, skillCatalog.filter(skill => skill.name.includes(skillFilter.toLowerCase())).length)
      if (count > 0) {
        event.preventDefault()
        skillHighlight = (skillHighlight + (event.key === 'ArrowDown' ? 1 : count - 1)) % count
        renderSkillPopover()
        return
      }
    } else if (event.key === 'Escape') {
      event.preventDefault()
      hideSkillPopover()
      return
    }
  }
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault()
    send()
    return
  }
  if ((event.key === 'ArrowUp' || event.key === 'ArrowDown') && sentHistory.length > 0) {
    const browsing = historyIndex !== -1 && elements.prompt.value === sentHistory[historyIndex]
    if (browsing || elements.prompt.value === '') {
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        historyIndex = historyIndex === -1 ? sentHistory.length - 1 : Math.max(0, historyIndex - 1)
        const entry = sentHistory[historyIndex]
        if (entry !== undefined) {
          elements.prompt.value = entry
          resizePrompt()
          vscode.setState({ draft: elements.prompt.value })
        }
        return
      }
      if (browsing) {
        event.preventDefault()
        historyIndex += 1
        if (historyIndex >= sentHistory.length) {
          historyIndex = -1
          elements.prompt.value = ''
        } else {
          const entry = sentHistory[historyIndex]
          if (entry !== undefined) elements.prompt.value = entry
        }
        resizePrompt()
        vscode.setState({ draft: elements.prompt.value })
        return
      }
    }
  }
})
elements.prompt.addEventListener('input', () => {
  if (historyIndex !== -1 && elements.prompt.value !== sentHistory[historyIndex]) historyIndex = -1
  const filter = detectSkillFilter()
  if (filter !== undefined) showSkillPopover(filter)
  else if (skillPopoverVisible) hideSkillPopover()
  resizePrompt()
  vscode.setState({ draft: elements.prompt.value })
})
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
elements.conversation.addEventListener('scroll', () => {
  const conversation = elements.conversation
  const maxScroll = Math.max(0, conversation.scrollHeight - conversation.clientHeight)
  if (conversation.scrollTop >= maxScroll - 24) stickToBottom = true
  else if (conversation.scrollTop < maxScroll - 96) stickToBottom = false
  updateScrollBottomButton()
})
let resizeFrame: number | undefined
window.addEventListener('resize', () => {
  if (resizeFrame !== undefined) return
  resizeFrame = window.requestAnimationFrame(() => {
    resizeFrame = undefined
    for (const item of popovers) {
      if (!item.popover.classList.contains('hidden')) positionPopover(item)
    }
    if (!elements.contextMeterAnchor.classList.contains('hidden')) positionContextTooltip()
    updateScrollBottomButton()
  })
})

window.addEventListener('message', event => {
  const message = event.data as HostToWebviewMessage
  if (message.type === 'state') {
    pendingState = message.state
    pendingAttachments = message.attachments
    pasteFileThreshold = message.state.pasteFileThreshold
    scheduleRender()
  } else if (message.type === 'sendSettled') {
    sendPending = false
    if (message.accepted && elements.prompt.value === message.text) {
      elements.prompt.value = ''
      vscode.setState({ draft: '' })
      resizePrompt()
    }
    if (state !== undefined) renderStatus(state)
    elements.prompt.focus()
  } else if (message.type === 'setDraft') {
    elements.prompt.value = message.text
    vscode.setState({ draft: message.text })
    resizePrompt()
    elements.prompt.focus()
  } else if (message.type === 'notice') showNotice(message.message)
  else if (message.type === 'skills') {
    skillCatalog = message.skills
    if (skillPopoverVisible) renderSkillPopover()
  }
})

// Replace static <i data-lucide> placeholders with real SVG icons. lucide's createIcons
// looks up icons by PascalCase keys, so a direct replacement is used instead.
document.querySelectorAll('i[data-lucide]').forEach(element => {
  const name = element.getAttribute('data-lucide')
  if (name !== null && name in iconComponents) {
    const icon = svgIcon(name as IconName)
    icon.classList.add(...Array.from(element.classList))
    element.replaceWith(icon)
  }
})
resizePrompt()
post({ type: 'ready' })

function scheduleRender(): void {
  if (renderScheduled) return
  renderScheduled = true
  window.requestAnimationFrame(() => {
    renderScheduled = false
    if (pendingState === undefined) return
    render()
  })
}

function render(): void {
  if (pendingState === undefined) return
  state = pendingState
  attachments = pendingAttachments
  renderSessionTabs(state)
  renderControls(state)
  renderContextMeter(state)
  renderConversation(state)
  renderAttachments()
  renderStatus(state)
  vscode.setState({ activeSessionId: state.activeSessionId })
}

function renderControls(snapshot: WorkbenchSnapshot): void {
  const active = snapshot.sessions.find(session => session.id === snapshot.activeSessionId)
  const signature = [
    snapshot.provider, snapshot.model, snapshot.reasoningEffort, snapshot.agentPreset,
    snapshot.permissionMode, String(snapshot.permissionChanging), snapshot.phase,
    snapshot.modelCatalog === undefined ? 'u' : 'd',
    snapshot.presetCatalog === undefined ? 'u' : 'd',
    snapshot.permissionOptions === undefined ? null : snapshot.permissionOptions,
    active === undefined ? null : [active.blank, active.running, active.operation],
  ]
  const fingerprint = JSON.stringify(signature)
  if (fingerprint === controlsSignature) return
  controlsSignature = fingerprint
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
    const icon = svgIcon(session.operation === undefined ? 'ellipsis' : 'loader-circle')
    if (session.operation !== undefined) icon.classList.add('session-operation-icon')
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

function renderModelOptions(snapshot: WorkbenchSnapshot | undefined): void {
  if (snapshot === undefined) return
  const nodes: Node[] = []
  if (snapshot.modelCatalog === undefined) {
    elements.modelOptions.replaceChildren(menuOption({ label: 'Loading models...', selected: false, disabled: true, handler: () => undefined }))
    elements.reasoningOptions.replaceChildren(menuOption({ label: 'Loading reasoning options...', selected: false, disabled: true, handler: () => undefined }))
    elements.modelLabel.textContent = snapshot.model || 'Loading models...'
    return
  }
  let currentName = snapshot.model
  let currentFound = false
  for (const group of snapshot.modelCatalog.groups) {
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
}

function renderReasoningOptions(snapshot: WorkbenchSnapshot | undefined): void {
  if (snapshot === undefined) return
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

function renderPresetOptions(snapshot: WorkbenchSnapshot | undefined): void {
  if (snapshot === undefined) return
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

function renderPermissionOptions(snapshot: WorkbenchSnapshot | undefined): void {
  if (snapshot === undefined) return
  const fallback = [
    { id: 'read-only', label: 'Read only', short: 'Read only', description: 'No model-driven file mutations' },
    { id: 'workspace-write', label: 'Workspace write', short: 'Workspace', description: 'Workspace writes; some Windows external tools require one-time approval' },
    { id: 'danger-full-access', label: 'Full access', short: 'Full access', description: 'Unrestricted writes without approval prompts' },
  ] as const
  const options = snapshot.permissionOptions?.filter(option => option.value !== 'custom').map(option => ({
    id: option.value,
    label: option.name,
    short: option.value === 'workspace-write' ? 'Workspace' : option.value === 'danger-full-access' ? 'Full access' : option.name,
    description: option.description ?? '',
  })) ?? fallback
  const current = options.find(option => option.id === snapshot.permissionMode) ?? options[1]
  elements.permissionLabel.textContent = current?.short ?? snapshot.permissionMode
  const active = snapshot.sessions.find(session => session.id === snapshot.activeSessionId)
  const disabled = snapshot.permissionChanging || snapshot.phase !== 'connected' || active === undefined || active.running
  elements.permissionMenu.disabled = disabled
  elements.permissionMenu.title = snapshot.permissionChanging
    ? 'Changing file permissions...'
    : active?.running === true ? 'Stop the current response before changing file permissions' : 'File access permissions'
  elements.permissionOptions.replaceChildren(...options.map(option => menuOption({
    label: option.label,
    description: option.description,
    selected: option.id === snapshot.permissionMode,
    disabled,
    handler: () => {
      post({ type: 'selectPermission', permission: option.id })
      closePopovers()
    },
  })))
}

function renderConversation(snapshot: WorkbenchSnapshot): void {
  const sessionKey = snapshot.activeSessionId ?? '\u0000'
  if (sessionKey !== renderedSessionKey) {
    renderedSessionKey = sessionKey
    messageElements.clear()
    messageSignatures.clear()
    autoOpenedDetails.clear()
    userToggledDetails.clear()
    collapsedMessages.clear()
    turnHidden.clear()
    stickToBottom = true
    emptyNode = undefined
    elements.conversation.replaceChildren()
    pendingAnchor = document.createElement('div')
    pendingAnchor.className = 'pending-area'
    elements.conversation.append(pendingAnchor)
    scrollBottomButton = document.createElement('button')
    scrollBottomButton.type = 'button'
    scrollBottomButton.className = 'scroll-bottom hidden'
    scrollBottomButton.title = 'Jump to latest output'
    scrollBottomButton.setAttribute('aria-label', 'Jump to latest output')
    scrollBottomButton.append(svgIcon('chevrons-down'))
    scrollBottomButton.addEventListener('click', () => {
      elements.conversation.scrollTop = elements.conversation.scrollHeight
      updateScrollBottomButton()
    })
    elements.conversation.append(scrollBottomButton)
  }
  if (pendingAnchor === undefined || !pendingAnchor.isConnected) {
    pendingAnchor = document.createElement('div')
    pendingAnchor.className = 'pending-area'
    elements.conversation.append(pendingAnchor)
  }

  const messages = snapshot.messages ?? []
  const seen = new Set<string>()
  const turnCounts = new Map<string, number>()
  let countingTurn: string | undefined
  for (const message of messages) {
    if (message.role === 'user') {
      countingTurn = message.id
      turnCounts.set(message.id, turnCounts.get(message.id) ?? 0)
    } else if (countingTurn !== undefined) {
      turnCounts.set(countingTurn, (turnCounts.get(countingTurn) ?? 0) + 1)
    }
  }
  let currentTurn: string | undefined
  let streaming = false
  for (const message of messages) {
    if (message.role === 'user') currentTurn = message.id
    seen.add(message.id)
    const signature = messageSignature(message)
    let node = messageElements.get(message.id)
    if (node === undefined) {
      node = renderMessage(message)
      messageElements.set(message.id, node)
      messageSignatures.set(message.id, signature)
      elements.conversation.insertBefore(node, pendingAnchor)
    } else if (signature !== messageSignatures.get(message.id)) {
      messageSignatures.set(message.id, signature)
      updateMessage(node, message)
    }
    const owner = currentTurn === message.id || message.role !== 'user' ? currentTurn : undefined
    node.classList.toggle('turn-hidden', owner !== undefined && message.role !== 'user' && turnHidden.has(owner))
    if (message.role === 'user') updateTurnBadge(node, message.id, turnCounts.get(message.id) ?? 0)
    if (message.status === 'streaming') streaming = true
  }
  for (const [id, node] of messageElements) {
    if (seen.has(id)) continue
    node.remove()
    messageElements.delete(id)
    messageSignatures.delete(id)
  }

  const approvals = snapshot.approvals
  const questions = snapshot.questions
  const empty = messages.length === 0 && approvals.length === 0 && questions.length === 0
  if (empty) {
    if (emptyNode === undefined) {
      emptyNode = document.createElement('div')
      emptyNode.className = 'empty'
      const title = document.createElement('div')
      title.className = 'empty-title'
      const start = document.createElement('button')
      start.type = 'button'
      start.className = 'command primary'
      start.textContent = 'Start new session'
      start.addEventListener('click', () => post({ type: 'newSession' }))
      emptyNode.append(title, start)
      elements.conversation.insertBefore(emptyNode, pendingAnchor)
    }
    const title = emptyNode.querySelector('.empty-title')
    if (title !== null) title.textContent = snapshot.sessions.find(session => session.id === snapshot.activeSessionId)?.title ?? `DeepSeek Harness: ${snapshot.phase}`
  } else if (emptyNode !== undefined) {
    emptyNode.remove()
    emptyNode = undefined
  }

  const signature = pendingAreaSignature(approvals, questions)
  if (signature !== pendingSignature) {
    pendingSignature = signature
    pendingAnchor.replaceChildren(...renderPendingArea(approvals, questions))
  }

  if (streaming && stickToBottom) {
    const conversation = elements.conversation
    conversation.scrollTop = Math.max(0, conversation.scrollHeight - conversation.clientHeight)
  }
  updateScrollBottomButton()
}

function updateScrollBottomButton(): void {
  if (scrollBottomButton === undefined) return
  const conversation = elements.conversation
  const maxScroll = Math.max(0, conversation.scrollHeight - conversation.clientHeight)
  const away = maxScroll - conversation.scrollTop > 48
  scrollBottomButton.classList.toggle('hidden', !away)
}

function applyCompactThinkingButton(): void {
  elements.compactThinkingButton.classList.toggle('active', compactThinking)
  elements.compactThinkingButton.setAttribute('aria-pressed', String(compactThinking))
  elements.compactThinkingButton.title = compactThinking
    ? 'Thinking and tool details are collapsed by default; click to expand them while streaming'
    : 'Collapse thinking and tool details by default'
}

function updateTurnBadge(node: HTMLElement, userMessageId: string, count: number): void {
  if (count === 0) return
  const collapsed = turnHidden.has(userMessageId)
  let badge = node.querySelector<HTMLButtonElement>('.turn-badge')
  if (collapsed) {
    if (badge === null) {
      badge = document.createElement('button')
      badge.type = 'button'
      badge.className = 'turn-badge'
      badge.title = 'Show the replies of this turn'
      badge.addEventListener('click', () => {
        turnHidden.delete(userMessageId)
        if (state !== undefined) renderConversation(state)
      })
      node.querySelector('.message-head')?.append(badge)
    }
    badge.textContent = `${String(count)} ${count === 1 ? 'reply' : 'replies'} hidden`
  } else {
    badge?.remove()
  }
}

function detailSummaryText(message: WorkbenchMessage): string {
  const base = message.role === 'reasoning' ? 'Reasoning' : message.title ?? 'Tool'
  if (!compactThinking || message.text === '') return base
  return `${base} · ${formatChars(message.text.length)}`
}

function formatChars(value: number): string {
  if (value >= 1_000_000) return `${stripTrailingZero(value / 1_000_000)}M chars`
  if (value >= 1_000) return `${stripTrailingZero(value / 1_000)}K chars`
  return `${String(value)} chars`
}

function renderPendingArea(approvals: WorkbenchSnapshot['approvals'], questions: WorkbenchSnapshot['questions']): Node[] {
  const nodes: Node[] = []
  for (const approval of approvals) {
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
  for (const batch of groupQuestions(questions)) nodes.push(renderQuestionBatch(batch))
  return nodes
}

function pendingAreaSignature(approvals: WorkbenchSnapshot['approvals'], questions: WorkbenchSnapshot['questions']): string {
  return JSON.stringify([
    approvals.map(approval => [approval.id, approval.toolName, approval.reason]),
    questions.map(question => [question.rpcId, question.id, question.header, question.question, question.detail, question.multiSelect, question.options.map(option => [option.label, option.description])]),
  ])
}

function messageSignature(message: WorkbenchMessage): string {
  return `${message.id}\u0000${message.seq ?? ''}\u0000${message.status ?? ''}\u0000${message.text.length}\u0000${message.title ?? ''}\u0000${message.attachments === undefined ? '' : message.attachments.map(attachment => attachment.kind + attachment.label).join(',')}`
}

function renderMessage(message: WorkbenchMessage): HTMLElement {
  if (message.role === 'reasoning' || message.role === 'tool') {
    const details = document.createElement('details')
    details.className = `message ${message.role}`
    if (message.status === 'streaming' && !userToggledDetails.has(message.id) && !compactThinking) {
      details.open = true
      autoOpenedDetails.add(message.id)
    }
    const summary = document.createElement('summary')
    const summaryLabel = document.createElement('span')
    summaryLabel.className = 'summary-label'
    summaryLabel.textContent = detailSummaryText(message)
    const chevron = svgIcon('chevron-down')
    chevron.classList.add('summary-chevron')
    summary.append(summaryLabel, chevron)
    const body = document.createElement('div')
    body.className = 'message-body'
    body.append(renderMessageBody(message))
    details.append(summary, body)
    summary.addEventListener('click', () => { userToggledDetails.add(message.id) })
    summary.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') userToggledDetails.add(message.id)
    })
    return details
  }
  const article = document.createElement('article')
  article.className = `message ${message.role}`
  const head = buildMessageHead(message)
  article.append(head.head)
  if (message.attachments !== undefined && message.attachments.length > 0) {
    article.append(buildAttachmentsRow(message.attachments))
  }
  if (message.text !== '') article.append(buildMessageCopy(message))
  bindCollapseToggle(article, head.toggle, message)
  if (collapsedMessages.has(message.id)) applyCollapse(article, message, true)
  return article
}

function updateMessage(node: HTMLElement, message: WorkbenchMessage): void {
  if (message.role === 'reasoning' || message.role === 'tool') {
    const details = node as HTMLDetailsElement
    const summary = details.querySelector('summary')
    const summaryLabel = summary?.querySelector('.summary-label')
    if (summaryLabel !== undefined && summaryLabel !== null) summaryLabel.textContent = detailSummaryText(message)
    const body = details.querySelector('.message-body')
    if (body !== null) body.replaceChildren(renderMessageBody(message))
    if (message.status === 'streaming') {
      if (!userToggledDetails.has(message.id) && !compactThinking) {
        details.open = true
        autoOpenedDetails.add(message.id)
      }
    } else {
      if (autoOpenedDetails.has(message.id) && !userToggledDetails.has(message.id) && !compactThinking) details.open = false
      autoOpenedDetails.delete(message.id)
    }
    return
  }
  let head = node.querySelector('.message-head')
  if (head === null) {
    const built = buildMessageHead(message)
    head = built.head
    bindCollapseToggle(node, built.toggle, message)
    node.prepend(head)
  }
  node.querySelectorAll('.message-attachments, .message-copy, .message-preview').forEach(element => element.remove())
  if (message.attachments !== undefined && message.attachments.length > 0) {
    node.append(buildAttachmentsRow(message.attachments))
  }
  if (message.text !== '') node.append(buildMessageCopy(message))
  if (collapsedMessages.has(message.id)) applyCollapse(node, message, true)
}

function buildMessageHead(message: WorkbenchMessage): { head: HTMLDivElement; toggle: HTMLButtonElement } {
  const head = document.createElement('div')
  head.className = 'message-head'
  const toggle = document.createElement('button')
  toggle.type = 'button'
  toggle.className = 'collapse-toggle'
  toggle.setAttribute('aria-expanded', 'true')
  toggle.title = 'Collapse or expand this message'
  toggle.setAttribute('aria-label', 'Collapse or expand this message')
  toggle.append(svgIcon('chevron-down'))
  const label = document.createElement('span')
  label.className = 'message-role-label'
  label.textContent = roleLabel(message.role)
  head.append(toggle, label)
  if (message.role === 'user') {
    const turnToggle = document.createElement('button')
    turnToggle.type = 'button'
    turnToggle.className = 'collapse-toggle turn-toggle'
    turnToggle.title = 'Collapse or expand this turn'
    turnToggle.setAttribute('aria-label', 'Collapse or expand this turn')
    turnToggle.append(svgIcon('chevrons-up'))
    turnToggle.addEventListener('click', () => {
      if (turnHidden.has(message.id)) turnHidden.delete(message.id)
      else turnHidden.add(message.id)
      if (state !== undefined) renderConversation(state)
    })
    head.append(turnToggle)
  }
  return { head, toggle }
}

function bindCollapseToggle(article: HTMLElement, toggle: HTMLButtonElement, message: WorkbenchMessage): void {
  toggle.addEventListener('click', () => {
    const collapsed = collapsedMessages.has(message.id)
    if (collapsed) {
      collapsedMessages.delete(message.id)
      applyCollapse(article, message, false)
    } else {
      collapsedMessages.add(message.id)
      applyCollapse(article, message, true)
    }
  })
}

function applyCollapse(article: HTMLElement, message: WorkbenchMessage, collapsed: boolean): void {
  article.classList.toggle('collapsed', collapsed)
  const toggle = article.querySelector('.collapse-toggle')
  toggle?.classList.toggle('collapsed', collapsed)
  toggle?.setAttribute('aria-expanded', String(!collapsed))
  article.querySelectorAll('.message-attachments, .message-copy').forEach(element => element.classList.toggle('hidden', collapsed))
  let preview = article.querySelector('.message-preview')
  if (collapsed) {
    if (preview === null) {
      preview = document.createElement('div')
      preview.className = 'message-preview'
      const copy = article.querySelector('.message-copy')
      if (copy !== null) article.insertBefore(preview, copy)
      else article.append(preview)
    }
    const text = message.text === '' ? (message.attachments?.map(attachment => attachment.label).join(', ') ?? '') : message.text
    const flattened = text.replace(/\s+/gu, ' ')
    preview.textContent = flattened.length > 120 ? flattened.slice(0, 117).trimEnd() + '...' : flattened
  } else {
    preview?.remove()
  }
}

function roleLabel(role: WorkbenchMessage['role']): string {
  if (role === 'user') return 'You'
  if (role === 'assistant') return 'Assistant'
  if (role === 'system') return 'System'
  if (role === 'reasoning') return 'Reasoning'
  return 'Tool'
}

function buildAttachmentsRow(attachments: readonly NonNullable<WorkbenchMessage['attachments']>[number][]): HTMLDivElement {
  const row = document.createElement('div')
  row.className = 'message-attachments'
  for (const attachment of attachments) {
    const item = document.createElement('span')
    item.className = 'message-attachment'
    item.title = `${attachment.label} - content hidden from the conversation view`
    item.append(svgIcon(attachment.kind === 'handoff' ? 'arrow-left-right' : 'paperclip'))
    const label = document.createElement('span')
    label.className = 'message-attachment-label'
    label.textContent = attachment.label
    item.append(label)
    row.append(item)
  }
  return row
}

function buildMessageCopy(message: WorkbenchMessage): HTMLDivElement {
  const copy = document.createElement('div')
  copy.className = 'message-copy'
  copy.append(renderMessageBody(message))
  return copy
}

function renderMessageBody(message: WorkbenchMessage): Node {
  if (message.status === 'streaming') {
    const stream = document.createElement('div')
    stream.className = 'streaming-text'
    stream.textContent = message.text
    return stream
  }
  const content = document.createElement('div')
  content.innerHTML = markdown(message.text)
  return content
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
  const signature = JSON.stringify(attachments.map(attachment => [attachment.id, attachment.label, attachment.truncated === true]))
  if (signature === attachmentsSignature) return
  attachmentsSignature = signature
  elements.attachments.replaceChildren(...attachments.map(attachment => {
    const chip = document.createElement('div')
    chip.className = 'chip'
    if (attachment.kind === 'image' && attachment.image !== undefined && attachment.image.dataBase64 !== '') {
      const thumb = document.createElement('img')
      thumb.className = 'attachment-thumb'
      thumb.src = `data:${attachment.image.mimeType};base64,${attachment.image.dataBase64}`
      thumb.alt = attachment.label
      chip.append(thumb)
    } else if (attachment.pastedPath !== undefined) {
      const thumb = document.createElement('span')
      thumb.className = 'attachment-thumb file-thumb'
      thumb.title = attachment.pastedPath
      thumb.append(svgIcon('file-text'))
      chip.append(thumb)
    }
    const label = document.createElement('span')
    const display = attachment.kind === 'image' ? attachment.label.replace(/^Image: /u, '') : attachment.label
    label.textContent = attachment.pastedPath !== undefined
      ? `${display} · saved to file`
      : `${display}${attachment.truncated ? ' [truncated]' : ''}`
    const remove = document.createElement('button')
    remove.title = 'Remove attachment'
    remove.setAttribute('aria-label', 'Remove attachment')
    remove.append(svgIcon('x'))
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
  const sendUnavailable = promptUnavailableReason(snapshot)
  const steer = steerAvailable(snapshot)
  const modelControlsUnavailable = modelControlsUnavailableReason(snapshot)
  const compactionUnavailable = snapshot.agentPreset === 'minimal'
  elements.cancel.classList.toggle('hidden', !running)
  elements.cancel.disabled = cancelling
  elements.cancel.title = cancelling ? 'Stop request is being processed' : 'Stop'
  elements.cancel.setAttribute('aria-label', elements.cancel.title)
  elements.send.classList.toggle('hidden', false)
  elements.send.classList.toggle('steer', running && steer)
  elements.send.disabled = sendPending || (sendUnavailable !== undefined && !steer)
  elements.send.title = sendPending
    ? 'Sending...'
    : steer
      ? 'Send immediately - the running response will address this prompt'
      : sendUnavailable ?? 'Send'
  elements.send.setAttribute('aria-label', elements.send.title)
  elements.modelMenu.disabled = modelControlsUnavailable !== undefined
  elements.modelMenu.title = modelControlsUnavailable ?? 'Model, reasoning, and agent preset'
  elements.modelMenu.setAttribute('aria-label', elements.modelMenu.title)
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
  if (options.selected) check.append(svgIcon('check'))
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

function svgIcon(name: IconName): SVGSVGElement {
  const component = iconComponents[name]
  const svg = lucideCreateElement(component) as SVGSVGElement
  svg.setAttribute('data-lucide', name)
  svg.classList.add('lucide', `lucide-${name}`)
  svg.setAttribute('aria-hidden', 'true')
  return svg
}

function send(): void {
  if (sendPending || state === undefined || promptUnavailableReason(state) !== undefined) return
  const value = elements.prompt.value
  if (value.trim() === '' && attachments.length === 0) return
  sendPending = true
  if (value.trim() !== '') {
    if (sentHistory[sentHistory.length - 1] !== value) sentHistory.push(value)
    if (sentHistory.length > 200) sentHistory.shift()
  }
  historyIndex = -1
  renderStatus(state)
  const steer = steerAvailable(state)
  post({ type: 'send', text: value, ...(steer ? { mode: 'steer' } : {}) })
  elements.prompt.focus()
}

function showSkillPopover(filter: string): void {
  if (skillCatalog.length === 0) post({ type: 'listSkills' })
  skillFilter = filter
  skillHighlight = 0
  skillPopoverVisible = true
  renderSkillPopover()
  elements.skillPopover.classList.remove('hidden')
}

function hideSkillPopover(): void {
  skillPopoverVisible = false
  elements.skillPopover.classList.add('hidden')
}

function renderSkillPopover(): void {
  const matches = skillCatalog
    .filter(skill => skill.name.includes(skillFilter.toLowerCase()))
    .slice(0, 8)
  elements.skillPopover.replaceChildren()
  if (matches.length === 0) {
    const empty = document.createElement('div')
    empty.className = 'skill-empty'
    empty.textContent = 'No matching skills found'
    elements.skillPopover.append(empty)
    return
  }
  for (const [index, skill] of matches.entries()) {
    const option = document.createElement('button')
    option.type = 'button'
    option.className = `skill-option${index === skillHighlight ? ' highlighted' : ''}`
    option.setAttribute('role', 'option')
    option.setAttribute('aria-selected', String(index === skillHighlight))
    const name = document.createElement('div')
    name.className = 'skill-option-name'
    name.textContent = `@${skill.name}`
    const description = document.createElement('div')
    description.className = 'skill-option-desc'
    description.textContent = skill.description === '' ? 'SKILL.md' : skill.description
    option.append(name, description)
    option.addEventListener('click', () => {
      insertSkillRef(skill.name)
      hideSkillPopover()
    })
    elements.skillPopover.append(option)
  }
}

function insertSkillRef(name: string): void {
  const el = elements.prompt
  const position = el.selectionStart
  const before = el.value.slice(0, position)
  const at = before.lastIndexOf('@')
  const start = at === -1 ? position : at
  el.value = `${el.value.slice(0, start)}@${name} ${el.value.slice(position)}`
  const caret = start + name.length + 2
  el.setSelectionRange(caret, caret)
  resizePrompt()
  vscode.setState({ draft: el.value })
  el.focus()
}

function detectSkillFilter(): string | undefined {
  const el = elements.prompt
  const before = el.value.slice(0, el.selectionStart)
  const match = /(?:^|\s)@([a-z0-9-]*)$/iu.exec(before)
  return match === null ? undefined : match[1] ?? ''
}

async function handlePaste(event: ClipboardEvent): Promise<void> {
  const data = event.clipboardData
  if (data === null) return
  if (data.files.length > 0) {
    event.preventDefault()
    await attachBrowserFiles(data.files)
    return
  }
  for (const item of Array.from(data.items)) {
    if (item.kind !== 'file' || !item.type.startsWith('image/')) continue
    const file = item.getAsFile()
    if (file === null) continue
    event.preventDefault()
    await attachBrowserFiles([file])
    return
  }
  const plain = data.getData('text/plain')
  if (plain !== '' && plain.length > pasteFileThreshold) {
    event.preventDefault()
    post({ type: 'attachTextFiles', files: [{ name: pasteFileName(plain), text: plain }] })
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

async function attachBrowserFiles(files: FileList | readonly File[]): Promise<void> {
  const textPayload: { readonly name: string; readonly text: string }[] = []
  const imagePayload: { readonly name: string; readonly dataUrl: string }[] = []
  let imageBytes = 0
  for (const file of Array.from(files).slice(0, 10)) {
    if (file.type.startsWith('image/')) {
      const dataUrl = await readFileAsDataUrl(file)
      imageBytes += dataUrl.length
      if (imageBytes > 64 * 1_048_576) break
      imagePayload.push({ name: file.name, dataUrl })
    } else {
      textPayload.push({ name: file.name, text: await file.slice(0, 262_144).text() })
    }
  }
  if (textPayload.length > 0) post({ type: 'attachTextFiles', files: textPayload })
  if (imagePayload.length > 0) post({ type: 'attachImageFiles', files: imagePayload })
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '')
    reader.onerror = () => reject(new Error(`Could not read image ${file.name}.`))
    reader.readAsDataURL(file)
  })
}

function hasAttachableData(data: DataTransfer | null): boolean {
  if (data === null) return false
  return data.files.length > 0 || data.types.includes('text/uri-list')
}

function pasteFileName(value: string): string {
  const firstLine = value.split(/\r?\n/u).find(line => line.trim() !== '') ?? 'pasted-text'
  const safe = firstLine.trim().slice(0, 40).replace(/[\\/:*?"<>|]/gu, '_').trim()
  return `${safe === '' ? 'pasted-text' : safe}.txt`
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

function popover(buttonId: string, popoverId: string, onOpen?: () => void): PopoverBinding {
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
    if (opening) {
      onOpen?.()
      window.requestAnimationFrame(() => {
        if (!popup.classList.contains('hidden')) positionPopover({ button, popover: popup, anchor })
      })
    }
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

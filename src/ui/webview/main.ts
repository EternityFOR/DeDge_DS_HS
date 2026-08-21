import DOMPurify from 'dompurify'
import {
  ArrowLeftRight,
  Check,
  ChevronDown,
  ChevronUp,
  ChevronsDown,
  CornerDownRight,
  createElement as lucideCreateElement,
  Diff,
  Ellipsis,
  FileText,
  FoldVertical,
  Image,
  KeyRound,
  Layers3,
  LoaderCircle,
  ListPlus,
  Paperclip,
  Pencil,
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
  Search,
  WandSparkles,
} from 'lucide'
import { marked } from 'marked'
import type { ContextAttachment } from '../../context/context-collector.js'
import type { SkillSummary } from '../../skills/skill-catalog.js'
import type { WorkbenchMessage, WorkbenchSnapshot } from '../../session/types.js'
import { modelControlsUnavailableReason, promptUnavailableReason, steerAvailable } from '../../session/interaction-readiness.js'
import type { HostToWebviewMessage, WebviewToHostMessage, WorkbenchSettings } from '../webview-protocol.js'

declare function acquireVsCodeApi(): { postMessage(message: WebviewToHostMessage): void; setState(value: unknown): void; getState(): unknown }

const vscode = acquireVsCodeApi()
const iconComponents = {
  'arrow-left-right': ArrowLeftRight,
  'check': Check,
  'chevron-down': ChevronDown,
  'chevron-up': ChevronUp,
  'chevrons-down': ChevronsDown,
  'corner-down-right': CornerDownRight,
  'fold-vertical': FoldVertical,
  'image': Image,
  'diff': Diff,
  'ellipsis': Ellipsis,
  'file-text': FileText,
  'key-round': KeyRound,
  'layers-3': Layers3,
  'loader-circle': LoaderCircle,
  'list-plus': ListPlus,
  'paperclip': Paperclip,
  'pencil': Pencil,
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
  'search': Search,
  'wand-sparkles': WandSparkles,
} as const
type IconName = keyof typeof iconComponents
const contextCircumference = 2 * Math.PI * 5.5
const maxStreamingChars = 32_768

let state: WorkbenchSnapshot | undefined
let attachments: readonly ContextAttachment[] = []
let sessionTabsSignature = ''
let noticeTimer: number | undefined
let sendPending = false
let pendingSendPreview: HTMLElement | undefined
let pendingSendText: string | undefined
let pendingSendBaselineCount = 0
let steerPendingText: string | undefined
type DeliveryMode = 'auto' | 'queue' | 'steer'
let deliveryMode: DeliveryMode = 'queue'
let pasteFileThreshold = 4_096
let scrollBottomButton: HTMLButtonElement | undefined
let stickToBottom = true
const collapsedMessages = new Set<string>()
const expandedTasks = new Set<string>()
const collapsedTasks = new Set<string>()
const knownTaskIds = new Set<string>()
let compactThinking = true
let skillCatalog: readonly SkillSummary[] = []
let skillPopoverVisible = false
let skillHighlight = 0
let skillFilter = ''
const sentHistory: string[] = []
let historyIndex = -1
let searchMatches: HTMLElement[] = []
let searchMatchIndex = -1
let searchScopeIds: Set<string> | undefined
let searchComposing = false
let searchDebounceTimer: number | undefined

// Rendering state: state messages are coalesced into at most one full render per animation frame.
let renderScheduled = false
let pendingState: WorkbenchSnapshot | undefined
let pendingAttachments: readonly ContextAttachment[] = []
let renderedSessionKey: string | undefined
let emptyNode: HTMLElement | undefined
let pendingAnchor: HTMLElement | undefined
let historyLoader: HTMLButtonElement | undefined
let historyLoadPending = false
let historyLoadScrollHeight = 0
let currentSettings: WorkbenchSettings | undefined
let currentInspection: import('../webview-protocol.js').PromptInspection | undefined
let showAllVisionModels = false
let pendingSignature = ''
let controlsSignature = ''
let attachmentsSignature = ''
const messageElements = new Map<string, HTMLElement>()
const messageSignatures = new Map<string, string>()
const autoOpenedDetails = new Set<string>()
const userToggledDetails = new Set<string>()
const taskFoldElements = new Map<string, HTMLButtonElement>()
const taskGroupElements = new Map<string, HTMLElement>()

marked.setOptions({ gfm: true, breaks: false })

const elements = {
  sessionTabs: required('session-tabs'),
  searchConversation: requiredButton('search-conversation'),
  searchPanel: required('search-panel'),
  searchInput: requiredInput('search-input'),
  searchSelection: requiredButton('search-selection'),
  searchPrev: requiredButton('search-prev'),
  searchNext: requiredButton('search-next'),
  searchClose: requiredButton('search-close'),
  searchCase: requiredInput('search-case'),
  searchWord: requiredInput('search-word'),
  searchRegex: requiredInput('search-regex'),
  searchCount: required('search-count'),
  conversation: required('conversation'),
  prompt: requiredTextArea('prompt'),
  composerResize: required('composer-resize'),
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
  deliveryMode: requiredButton('delivery-mode'),
  cancel: requiredButton('cancel'),
  compact: requiredButton('compact'),
  configureContext: requiredButton('configure-context'),
  statusDot: required('status-dot'),
  statusText: required('status-text'),
  skillPopover: required('skill-popover'),
  compactThinkingButton: requiredButton('compact-thinking'),
  steerNotice: required('steer-notice'),
  steerNoticeText: required('steer-notice-text'),
  steerNoticeClose: requiredButton('steer-notice-close'),
  settingsDialog: required('settings-dialog'),
  inspectorDialog: required('inspector-dialog'),
  inspectorClose: requiredButton('inspector-close'),
  inspectorCopy: requiredButton('inspector-copy'),
  inspectorScope: required('inspector-scope'),
  inspectorNote: required('inspector-note'),
  inspectorBody: required('inspector-body'),
  inspectPrompt: requiredButton('inspect-prompt'),
  settingsClose: requiredButton('settings-close'),
  settingsCancel: requiredButton('settings-cancel'),
  settingsSave: requiredButton('settings-save'),
  settingBaseUrl: requiredInput('setting-base-url'),
  settingApiKey: requiredInput('setting-api-key'),
  settingVisionUrl: requiredInput('setting-vision-url'),
  settingVisionModel: requiredInput('setting-vision-model'),
  settingVisionModelPicker: requiredSelect('setting-vision-model-picker'),
  settingVisionReasoning: requiredSelect('setting-vision-reasoning'),
  settingVisionKey: requiredInput('setting-vision-key'),
  settingPasteThreshold: requiredInput('setting-paste-threshold'),
  settingContextWindow: requiredInput('setting-context-window'),
  settingCodexHome: requiredInput('setting-codex-home'),
  settingClaudeHome: requiredInput('setting-claude-home'),
  settingHandoffMode: requiredSelect('setting-handoff-mode'),
  settingSkillDirectories: requiredTextArea('setting-skill-directories'),
  visionModelOptions: required('vision-model-options'),
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
  popover('vision-model-menu', 'vision-model-popover', renderVisionModelOptions),
  popover('delivery-mode', 'delivery-popover'),
]

bindAction('attach-selection', { type: 'attachSelection' })
elements.inspectPrompt.addEventListener('click', () => post({ type: 'inspectPrompt', text: elements.prompt.value }))
bindAction('attach-file', { type: 'attachFile' })
bindAction('attach-problems', { type: 'attachDiagnostics' })
bindAction('review', { type: 'reviewChanges' })
bindAction('review-toolbar', { type: 'reviewChanges' })
bindAction('handoff', { type: 'handoff' })
bindAction('set-key', { type: 'openSettings' })
bindAction('compact', { type: 'compact' })
bindAction('configure-context', { type: 'configureContextWindow' })
bindAction('cancel', { type: 'cancel' })
requiredButton('send').addEventListener('click', send)
for (const [id, mode] of [['delivery-auto', 'auto'], ['delivery-queue', 'queue'], ['delivery-steer', 'steer']] as const) {
  requiredButton(id).addEventListener('click', () => {
    deliveryMode = mode
    renderDeliveryMode()
    document.getElementById('delivery-popover')?.classList.add('hidden')
  })
}
elements.steerNoticeClose.addEventListener('click', () => {
  steerPendingText = undefined
  elements.steerNotice.classList.add('hidden')
})
elements.settingsClose.addEventListener('click', closeSettings)
elements.settingsCancel.addEventListener('click', closeSettings)
elements.settingsSave.addEventListener('click', saveSettings)
elements.inspectorClose.addEventListener('click', () => elements.inspectorDialog.classList.add('hidden'))
elements.inspectorCopy.addEventListener('click', copyInspection)
elements.settingVisionModelPicker.addEventListener('change', () => {
  if (elements.settingVisionModelPicker.value !== '') elements.settingVisionModel.value = elements.settingVisionModelPicker.value
})
window.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !elements.settingsDialog.classList.contains('hidden')) closeSettings()
})

elements.compactThinkingButton.addEventListener('click', () => {
  const taskIds = new Set(state?.messages.flatMap(message => message.taskId === undefined ? [] : [message.taskId]) ?? [])
  const collapseAll = [...taskIds].some(taskId => !collapsedTasks.has(taskId))
  compactThinking = true
  expandedTasks.clear()
  collapsedMessages.clear()
  if (collapseAll) {
    for (const taskId of taskIds) collapsedTasks.add(taskId)
    for (const [id, node] of messageElements) {
      if (node instanceof HTMLDetailsElement) node.open = false
      autoOpenedDetails.delete(id)
    }
  } else {
    for (const taskId of taskIds) collapsedTasks.delete(taskId)
  }
  applyCompactThinkingButton()
  const persisted = vscode.getState()
  vscode.setState({ ...(typeof persisted === 'object' && persisted !== null ? persisted : {}), compactThinking })
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
elements.composerResize.addEventListener('pointerdown', startComposerResize)
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
  if (conversation.scrollTop <= 24) requestOlderHistory()
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
    if (pendingSendText !== undefined) {
      const count = message.state.messages.filter(item => item.role === 'user' && item.text === pendingSendText).length
      if (count > pendingSendBaselineCount) {
        pendingSendPreview?.remove()
        pendingSendPreview = undefined
        pendingSendText = undefined
      }
    }
    scheduleRender()
  } else if (message.type === 'sendStarted') {
    sendPending = true
    if (elements.prompt.value === message.text) {
      elements.prompt.value = ''
      vscode.setState({ draft: '' })
      resizePrompt()
    }
    elements.prompt.focus()
    showPendingSendPreview(message.text, message.attachments.map(item => item.label))
    pendingSendText = message.text
    pendingSendBaselineCount = state?.messages.filter(item => item.role === 'user' && item.text === message.text).length ?? 0
    if (state !== undefined) renderStatus(state)
  } else if (message.type === 'sendProgress') {
    renderPendingVisionProgress(message.progress)
  } else if (message.type === 'sendSettled') {
    sendPending = false
    if (!message.accepted) {
      pendingSendPreview?.remove()
      pendingSendPreview = undefined
      pendingSendText = undefined
      steerPendingText = undefined
      elements.steerNotice.classList.add('hidden')
      if (elements.prompt.value.trim() === '') {
        elements.prompt.value = message.text
        vscode.setState({ draft: message.text })
        resizePrompt()
      }
    } else {
      const status = pendingSendPreview?.querySelector('.message-send-status')
      if (status !== null && status !== undefined) status.textContent = 'Sent'
    }
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
  } else if (message.type === 'notice') showNotice(message.message, message.level)
  else if (message.type === 'settings') {
    currentSettings = message.settings
    renderVisionModelOptions()
    if (message.open !== false) showSettings(message.settings, message.section)
  }
  else if (message.type === 'promptInspection') renderPromptInspection(message.inspection)
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

elements.searchConversation.addEventListener('click', () => {
  elements.searchPanel.classList.toggle('hidden')
  if (!elements.searchPanel.classList.contains('hidden')) {
    elements.searchInput.focus()
    runConversationSearch()
  }
})
elements.searchClose.addEventListener('click', () => elements.searchPanel.classList.add('hidden'))
elements.searchSelection.addEventListener('mousedown', event => {
  event.preventDefault()
  const selection = window.getSelection()
  if (selection === null || selection.isCollapsed || selection.rangeCount === 0) return
  const ids = new Set<string>()
  document.querySelectorAll<HTMLElement>('.message[data-message-id]').forEach(node => {
    if (selection.containsNode(node, true) && node.dataset.messageId !== undefined) ids.add(node.dataset.messageId)
  })
  if (ids.size === 0) return
  searchScopeIds = ids
  elements.searchSelection.classList.add('active')
  elements.searchSelection.title = 'Search within selected messages; click again to clear scope'
  elements.searchSelection.setAttribute('aria-label', elements.searchSelection.title)
  elements.searchInput.focus()
  runConversationSearch()
})
elements.searchSelection.addEventListener('click', () => {
  if (searchScopeIds === undefined) return
  searchScopeIds = undefined
  elements.searchSelection.classList.remove('active')
  elements.searchSelection.title = 'Search within selected text range'
  elements.searchSelection.setAttribute('aria-label', elements.searchSelection.title)
  runConversationSearch()
})
elements.searchInput.addEventListener('compositionstart', () => { searchComposing = true })
elements.searchInput.addEventListener('compositionend', () => { searchComposing = false; scheduleConversationSearch(0) })
for (const control of [elements.searchInput, elements.searchCase, elements.searchWord, elements.searchRegex]) control.addEventListener('input', () => scheduleConversationSearch())
elements.searchNext.addEventListener('click', () => stepConversationSearch(1))
elements.searchPrev.addEventListener('click', () => stepConversationSearch(-1))

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
  if (!elements.searchPanel.classList.contains('hidden') && elements.searchInput.value !== '') scheduleConversationSearch()
  updateSteerNotice(state)
  if (historyLoadPending && !state.historyLoading) {
    historyLoadPending = false
    renderHistoryLoader(state)
    window.requestAnimationFrame(() => {
      elements.conversation.scrollTop += Math.max(0, elements.conversation.scrollHeight - historyLoadScrollHeight)
    })
  }
  vscode.setState({ activeSessionId: state.activeSessionId })
}

function runConversationSearch(): void {
  if (searchComposing) return
  const query = elements.searchInput.value
  unwrapSearchMarks()
  clearSearchHighlight()
  document.querySelectorAll('.search-hit, .search-current').forEach(item => item.classList.remove('search-hit', 'search-current'))
  searchMatches = []
  searchMatchIndex = -1
  if (state === undefined || query === '') { elements.searchCount.textContent = ''; return }
  let matcher: RegExp
  try {
    const source = elements.searchRegex.checked ? query : query.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
    const bounded = elements.searchWord.checked ? `\\b${source}\\b` : source
    matcher = new RegExp(bounded, elements.searchCase.checked ? 'u' : 'iu')
  } catch { elements.searchCount.textContent = 'Invalid expression'; return }
  for (const message of state.messages) {
    const node = messageElements.get(message.id)
    if (node !== undefined && (searchScopeIds === undefined || searchScopeIds.has(message.id)) && matcher.test(message.text)) {
      node.classList.add('search-hit')
      searchMatches.push(node)
    }
  }
  elements.searchCount.textContent = `${String(searchMatches.length)} matches`
}

function scheduleConversationSearch(delay = 160): void {
  if (searchComposing) return
  if (searchDebounceTimer !== undefined) window.clearTimeout(searchDebounceTimer)
  searchDebounceTimer = window.setTimeout(() => {
    searchDebounceTimer = undefined
    runConversationSearch()
  }, delay)
}

function unwrapSearchMarks(): void {
  document.querySelectorAll('mark.search-text-hit').forEach(mark => {
    mark.replaceWith(document.createTextNode(mark.textContent ?? ''))
  })
}

function stepConversationSearch(direction: number): void {
  if (searchMatches.length === 0) return
  searchMatches[searchMatchIndex]?.classList.remove('search-current')
  searchMatchIndex = (searchMatchIndex + direction + searchMatches.length) % searchMatches.length
  const target = searchMatches[searchMatchIndex]
  if (target === undefined) return
  const message = state?.messages.find(item => messageElements.get(item.id) === target)
  if (message !== undefined) {
    if (message.taskId !== undefined) {
      expandedTasks.add(message.taskId)
      collapsedTasks.delete(message.taskId)
      expandSearchTask(message.taskId)
    }
    collapsedMessages.delete(message.id)
    const details = target?.closest('details') as HTMLDetailsElement | null
    if (details !== null) details.open = true
  }
  const visibleTarget = searchMatches[searchMatchIndex]
  visibleTarget?.classList.add('search-current')
  if (visibleTarget !== undefined) highlightSearchTarget(visibleTarget)
}

function expandSearchTask(taskId: string): void {
  const group = taskGroupElements.get(taskId)
  if (group === undefined) return
  group.querySelectorAll<HTMLElement>('.task-middle-hidden, .task-all-hidden').forEach(node => {
    node.classList.remove('task-middle-hidden', 'task-all-hidden')
  })
  group.querySelector<HTMLElement>('.task-fold-summary')?.classList.remove('task-all-hidden')
  const fold = taskFoldElements.get(taskId)
  if (fold !== undefined) {
    const label = fold.querySelector('span')
    if (label !== null) label.textContent = label.textContent?.replace(/^Show\b/u, 'Hide') ?? 'Hide task details'
    fold.setAttribute('aria-expanded', 'true')
  }
}

function highlightSearchTarget(node: HTMLElement): void {
  const css = (globalThis as typeof globalThis & { readonly CSS?: { readonly highlights?: { set: (name: string, highlight: unknown) => void; delete: (name: string) => void } } }).CSS
  const HighlightCtor = (globalThis as typeof globalThis & { readonly Highlight?: new (...ranges: Range[]) => unknown }).Highlight
  if (css?.highlights === undefined || HighlightCtor === undefined) return
  css.highlights.delete('dedge-search-current')
  const matcher = buildSearchMatcherForHighlight()
  if (matcher === undefined) return
  const ranges: Range[] = []
  const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT)
  let current: Node | null
  while ((current = walker.nextNode()) !== null) {
    if (current.parentElement?.closest('summary, button, input, textarea, select') !== null) continue
    const value = current.nodeValue ?? ''
    matcher.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = matcher.exec(value)) !== null) {
      const range = document.createRange()
      range.setStart(current, match.index)
      range.setEnd(current, match.index + match[0].length)
      ranges.push(range)
      if (match[0] === '') matcher.lastIndex += 1
    }
  }
  if (ranges.length === 0) return
  css.highlights.set('dedge-search-current', new HighlightCtor(...ranges))
  const firstRange = ranges[0]
  if (firstRange !== undefined) scrollSearchRangeIntoView(firstRange)
}

function scrollSearchRangeIntoView(range: Range): void {
  const match = range.getBoundingClientRect()
  const viewport = elements.conversation.getBoundingClientRect()
  const panel = elements.searchPanel.classList.contains('hidden') ? undefined : elements.searchPanel.getBoundingClientRect()
  const visibleTop = Math.max(viewport.top, panel === undefined ? viewport.top : panel.bottom + 8)
  const visibleBottom = viewport.bottom
  const desiredCenter = visibleTop + Math.max(0, visibleBottom - visibleTop) / 2
  const matchCenter = match.top + match.height / 2
  elements.conversation.scrollTo({
    top: elements.conversation.scrollTop + matchCenter - desiredCenter,
    behavior: 'auto',
  })
}

function clearSearchHighlight(): void {
  const css = (globalThis as typeof globalThis & { readonly CSS?: { readonly highlights?: { delete: (name: string) => void } } }).CSS
  css?.highlights?.delete('dedge-search-current')
}

function buildSearchMatcherForHighlight(): RegExp | undefined {
  const query = elements.searchInput.value
  if (query === '') return undefined
  try {
    const source = elements.searchRegex.checked ? query : query.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
    const bounded = elements.searchWord.checked ? `\\b${source}\\b` : source
    // Highlight navigation iterates with exec(); global matching is required
    // so each iteration advances instead of returning the same match forever.
    return new RegExp(bounded, elements.searchCase.checked ? 'gu' : 'giu')
  } catch { return undefined }
}

function renderControls(snapshot: WorkbenchSnapshot): void {
  const active = snapshot.sessions.find(session => session.id === snapshot.activeSessionId)
  const signature = [
    snapshot.provider, snapshot.model, snapshot.reasoningEffort, snapshot.agentPreset,
    snapshot.permissionMode, snapshot.approvalPolicy ?? 'ask', String(snapshot.permissionChanging), snapshot.phase,
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
  const visibleSessions = snapshot.sessions.filter(session => !session.blank || session.id === snapshot.activeSessionId)
  const signature = JSON.stringify({
    activeSessionId: snapshot.activeSessionId,
    sessions: visibleSessions.map(session => [session.id, session.title, session.running, session.operation]),
  })
  if (signature === sessionTabsSignature) return
  sessionTabsSignature = signature
  const scrollLeft = elements.sessionTabs.scrollLeft
  const activeId = snapshot.activeSessionId
  const nodes = visibleSessions.map(session => {
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
          : session.operation === 'compacting'
            ? `${session.title} - compacting context`
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
          : session.operation === 'compacting'
            ? 'Context compaction in progress'
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
  const unavailable = active?.running === true || active?.operation !== undefined
  const presets = snapshot.presetCatalog?.presets?.filter(preset => preset.broken === undefined) ?? []
  const options = presets.map(preset => menuOption({
    label: preset.name ?? preset.id,
    ...(preset.description === undefined
      ? (active?.blank === false && preset.id !== snapshot.agentPreset ? { description: 'Continue in a new isolated session' } : {})
      : { description: active?.blank === false && preset.id !== snapshot.agentPreset ? `${preset.description} · Continue in a new session` : preset.description }),
    selected: preset.id === snapshot.agentPreset,
    disabled: unavailable,
    handler: () => {
      post({ type: 'selectPreset', preset: preset.id })
      closePopovers()
    },
  }))
  if (!presets.some(preset => preset.id === snapshot.agentPreset)) {
    options.unshift(menuOption({ label: snapshot.agentPreset, selected: true, disabled: unavailable, handler: () => undefined }))
  }
  elements.presetOptions.replaceChildren(...options)
}

function renderPermissionOptions(snapshot: WorkbenchSnapshot | undefined): void {
  if (snapshot === undefined) return
  const fallback = [
    { id: 'read-only', label: 'Read only', short: 'Read only', description: 'No model-driven file mutations' },
    { id: 'workspace-write', label: 'Ask for approval', short: 'Ask', description: 'Workspace writes; ask before wider or unsafe actions' },
    { id: 'approve-for-me', label: 'Approve for me', short: 'Approve', description: 'Keep workspace sandboxing and allow each approval once' },
    { id: 'danger-full-access', label: 'Full access', short: 'Full access', description: 'Unrestricted writes without approval prompts' },
  ] as const
  const options = snapshot.permissionOptions?.filter(option => option.value !== 'custom').map(option => ({
    id: option.value,
    label: option.name,
    short: option.value === 'workspace-write' ? 'Ask' : option.value === 'approve-for-me' ? 'Approve' : option.value === 'danger-full-access' ? 'Full access' : option.name,
    description: option.description ?? '',
  })) ?? fallback
  const permissionOptions = options.some(option => option.id === 'approve-for-me') ? options : [...options.slice(0, 2), fallback[2], ...options.slice(2)]
  const currentId = snapshot.approvalPolicy === 'approve-for-me' ? 'approve-for-me' : snapshot.permissionMode
  const current = permissionOptions.find(option => option.id === currentId) ?? permissionOptions[1]
  elements.permissionLabel.textContent = current?.short ?? snapshot.permissionMode
  const active = snapshot.sessions.find(session => session.id === snapshot.activeSessionId)
  const disabled = snapshot.permissionChanging || snapshot.phase !== 'connected' || active === undefined || active.running || active.operation !== undefined
  elements.permissionMenu.disabled = disabled
  elements.permissionMenu.title = snapshot.permissionChanging
    ? 'Changing file permissions...'
    : active?.running === true ? 'Stop the current response before changing file permissions' : 'File access permissions'
  elements.permissionOptions.replaceChildren(...permissionOptions.map(option => menuOption({
    label: option.label,
    description: option.description,
    selected: option.id === currentId,
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
    expandedTasks.clear()
    collapsedTasks.clear()
    knownTaskIds.clear()
    taskFoldElements.clear()
    taskGroupElements.clear()
    stickToBottom = true
    emptyNode = undefined
    elements.conversation.replaceChildren()
    historyLoader = document.createElement('button')
    historyLoader.type = 'button'
    historyLoader.className = 'history-loader hidden'
    historyLoader.addEventListener('click', requestOlderHistory)
    elements.conversation.append(historyLoader)
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
  const currentTaskIds = new Set(messages.flatMap(message => message.taskId === undefined ? [] : [message.taskId]))
  for (const [taskId, group] of taskGroupElements) {
    if (currentTaskIds.has(taskId)) continue
    group.remove()
    taskGroupElements.delete(taskId)
    taskFoldElements.delete(taskId)
    knownTaskIds.delete(taskId)
    collapsedTasks.delete(taskId)
    expandedTasks.delete(taskId)
  }
  const seen = new Set<string>()
  let streaming = false
  for (let messageIndex = 0; messageIndex < messages.length; messageIndex++) {
    const message = messages[messageIndex]
    if (message === undefined) continue
    seen.add(message.id)
    const signature = messageSignature(message)
    let node = messageElements.get(message.id)
    if (node === undefined) {
      node = renderMessage(message)
      messageElements.set(message.id, node)
      messageSignatures.set(message.id, signature)
    } else if (signature !== messageSignatures.get(message.id)) {
      messageSignatures.set(message.id, signature)
      updateMessage(node, message)
    }
    if (!node.isConnected) {
      const group = message.taskId === undefined ? undefined : taskGroupElements.get(message.taskId)
      const next = messages.slice(messageIndex + 1).map(item => messageElements.get(item.id)).find(item => item?.isConnected)
      if (group !== undefined) group.append(node)
      else if (next !== undefined && next.parentElement === elements.conversation) elements.conversation.insertBefore(node, next)
      else elements.conversation.insertBefore(node, pendingAnchor)
    }
    if (message.status === 'streaming') streaming = true
  }
  for (const [id, node] of messageElements) {
    if (seen.has(id)) continue
    node.remove()
    messageElements.delete(id)
    messageSignatures.delete(id)
  }
  renderTaskFolds(messages)
  reorderConversationUnits(messages)
  if (pendingSendPreview !== undefined && pendingSendPreview.isConnected && pendingAnchor !== undefined) {
    elements.conversation.insertBefore(pendingSendPreview, pendingAnchor)
  }
  renderMessageSegments(messages)
  if (historyLoader !== undefined) {
    renderHistoryLoader(snapshot)
  }

  const approvals = snapshot.approvals
  const questions = snapshot.questions
  const empty = messages.length === 0 && approvals.length === 0 && questions.length === 0
  if (empty) {
    if (emptyNode === undefined) {
      emptyNode = document.createElement('div')
      emptyNode.className = 'empty'
      elements.conversation.insertBefore(emptyNode, pendingAnchor)
    }
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
  applyCompactThinkingButton()
  updateScrollBottomButton()
}

function reorderConversationUnits(messages: readonly WorkbenchMessage[]): void {
  if (pendingAnchor === undefined) return
  const seen = new Set<HTMLElement>()
  for (const message of messages) {
    const node = messageElements.get(message.id)
    if (node === undefined) continue
    const unit = message.taskId === undefined ? node : taskGroupElements.get(message.taskId) ?? node
    if (seen.has(unit)) continue
    seen.add(unit)
    elements.conversation.insertBefore(unit, pendingAnchor)
  }
}

function renderHistoryLoader(snapshot: WorkbenchSnapshot): void {
  if (historyLoader === undefined) return
  const loading = historyLoadPending || snapshot.historyLoading
  const active = snapshot.sessions.find(session => session.id === snapshot.activeSessionId)
  const operationBlocked = active?.operation !== undefined
  historyLoader.classList.toggle('hidden', !snapshot.hasMoreHistory && !loading)
  historyLoader.disabled = loading || operationBlocked
  historyLoader.title = operationBlocked ? 'Wait for the current session operation to finish' : ''
  historyLoader.replaceChildren()
  if (loading) {
    const spinner = svgIcon('loader-circle')
    spinner.classList.add('history-loader-spinner')
    historyLoader.append(spinner, document.createTextNode('Loading earlier messages...'))
  } else {
    historyLoader.textContent = 'Load earlier messages'
  }
}

function showPendingSendPreview(text: string, attachmentLabels: readonly string[]): void {
  pendingSendPreview?.remove()
  pendingSendPreview = document.createElement('article')
  pendingSendPreview.className = 'message user pending-send'
  const head = document.createElement('div')
  head.className = 'message-head'
  const label = document.createElement('span')
  label.className = 'message-role-label'
  label.textContent = 'You'
  const status = document.createElement('span')
  status.className = 'message-send-status'
  status.textContent = 'Sending...'
  head.append(label, status)
  pendingSendPreview.append(head)
  if (attachmentLabels.length > 0) pendingSendPreview.append(buildAttachmentsRow(attachmentLabels.map(label => ({ kind: 'file' as const, label }))))
  if (text.trim() !== '') {
    const copy = document.createElement('div')
    copy.className = 'message-copy'
    copy.textContent = text
    pendingSendPreview.append(copy)
  }
  if (pendingAnchor !== undefined) elements.conversation.insertBefore(pendingSendPreview, pendingAnchor)
  else elements.conversation.append(pendingSendPreview)
  elements.conversation.scrollTop = elements.conversation.scrollHeight
}

function renderPendingVisionProgress(progress: import('../../session/types.js').WorkbenchSendProgress): void {
  if (pendingSendPreview === undefined) return
  let details = Array.from(pendingSendPreview.querySelectorAll<HTMLDetailsElement>('.vision-process'))
    .find(item => item.dataset.label === progress.label)
  if (details === undefined) {
    details = document.createElement('details')
    details.className = 'vision-process'
    details.dataset.label = progress.label
    const summary = document.createElement('summary')
    summary.append(svgIcon('image'), document.createElement('span'))
    details.append(summary, document.createElement('div'))
    pendingSendPreview.append(details)
  }
  const label = details.querySelector('summary span')
  const body = details.querySelector('div')
  if (label !== null) label.textContent = progress.type === 'vision-start'
    ? `Vision · ${progress.model} · reading image...`
    : `Vision · ${progress.model} · complete`
  if (body !== null && progress.type === 'vision-complete') body.textContent = progress.text
}

function renderTaskFolds(messages: readonly WorkbenchMessage[]): void {
  const groups = new Map<string, WorkbenchMessage[]>()
  for (const message of messages) {
    if (message.taskId === undefined) continue
    const items = groups.get(message.taskId) ?? []
    items.push(message)
    groups.set(message.taskId, items)
  }
  for (const [taskId, node] of taskFoldElements) {
    if (groups.has(taskId)) continue
    node.remove()
    taskFoldElements.delete(taskId)
    taskGroupElements.get(taskId)?.remove()
    taskGroupElements.delete(taskId)
  }
  for (const [taskId, items] of groups) {
    if (!knownTaskIds.has(taskId)) {
      knownTaskIds.add(taskId)
      collapsedTasks.add(taskId)
    }
    const first = items.find(item => item.role === 'user') ?? items[0]
    const last = [...items].reverse().find(item => item.role === 'assistant' || item.role === 'system') ?? items.at(-1)
    if (first === undefined || last === undefined || first.id === last.id) continue
    const middle = items.filter(item => item.id !== first.id && item.id !== last.id)
    const collapsed = compactThinking && !expandedTasks.has(taskId) && middle.length > 0
    for (const item of items) {
      const node = messageElements.get(item.id)
      const intermediate = middle.some(candidate => candidate.id === item.id)
      node?.classList.toggle('task-middle-hidden', collapsed && intermediate)
      node?.classList.toggle('task-intermediate', intermediate)
      if (item.role === 'user') {
        const role = node?.querySelector('.message-role-label')
        if (role !== null && role !== undefined) role.textContent = intermediate ? 'You · Steer' : 'You'
      }
    }

    let fold = taskFoldElements.get(taskId)
    if (fold === undefined) {
      fold = document.createElement('button')
      fold.type = 'button'
      fold.className = 'task-fold-summary'
      fold.append(svgIcon('chevron-down'), document.createElement('span'))
      fold.addEventListener('click', () => {
        if (expandedTasks.has(taskId)) expandedTasks.delete(taskId)
        else expandedTasks.add(taskId)
        if (state !== undefined) renderConversation(state)
      })
      taskFoldElements.set(taskId, fold)
    }
    let group = taskGroupElements.get(taskId)
    if (group === undefined) {
      group = document.createElement('section')
      group.className = 'task-group'
      taskGroupElements.set(taskId, group)
    }
    const reasoning = middle.filter(item => item.role === 'reasoning').length
    const tools = middle.filter(item => item.role === 'tool').length
    const inserted = middle.filter(item => item.role === 'user').length
    const details = [
      items.some(item => item.taskComplete !== true) ? 'current task' : '',
      `${String(middle.length)} intermediate ${middle.length === 1 ? 'item' : 'items'}`,
      reasoning === 0 ? '' : `${String(reasoning)} reasoning`,
      tools === 0 ? '' : `${String(tools)} tools`,
      inserted === 0 ? '' : `${String(inserted)} inserted ${inserted === 1 ? 'message' : 'messages'}`,
    ].filter(Boolean).join(' · ')
    const label = fold.querySelector('span')
    if (label !== null) label.textContent = `${collapsed ? 'Show' : 'Hide'} ${details}`
    fold.title = collapsed ? 'Show the intermediate work in this completed task' : 'Hide the intermediate work in this completed task'
    fold.setAttribute('aria-expanded', String(!collapsed))
    fold.querySelector('svg')?.classList.toggle('collapsed', collapsed)
    const nodes = items.map(item => messageElements.get(item.id)).filter((node): node is HTMLElement => node !== undefined)
    const firstNode = messageElements.get(first.id)
    if (firstNode !== undefined && nodes.length > 1) {
      if (group.parentElement !== elements.conversation) elements.conversation.insertBefore(group, firstNode)
      let taskToggle = group.querySelector<HTMLButtonElement>('.task-collapse-all')
      if (taskToggle === null) {
        taskToggle = document.createElement('button')
        taskToggle.type = 'button'
        taskToggle.className = 'task-collapse-all'
        taskToggle.addEventListener('click', () => {
          if (collapsedTasks.has(taskId)) collapsedTasks.delete(taskId)
          else collapsedTasks.add(taskId)
          if (state !== undefined) renderConversation(state)
        })
      }
      const wholeCollapsed = collapsedTasks.has(taskId)
      const firstPreview = first.text.replace(/\s+/gu, ' ').slice(0, 72)
      taskToggle.replaceChildren(svgIcon('chevron-down'), document.createTextNode(wholeCollapsed ? `Show task · ${firstPreview}` : 'Collapse entire task'))
      taskToggle.setAttribute('aria-expanded', String(!wholeCollapsed))
      taskToggle.querySelector('svg')?.classList.toggle('collapsed', wholeCollapsed)
      for (const node of nodes) node.classList.toggle('task-all-hidden', wholeCollapsed)
      fold.classList.toggle('task-all-hidden', wholeCollapsed)
      const remainingNodes = nodes.filter(node => node !== firstNode)
      group.replaceChildren(taskToggle, firstNode, fold, ...remainingNodes)
    }
  }
}

function renderMessageSegments(messages: readonly WorkbenchMessage[]): void {
  let segmentOwner: WorkbenchMessage | undefined
  for (const message of messages) {
    const node = messageElements.get(message.id)
    if (node === undefined) continue
    if (message.role !== 'reasoning' && message.role !== 'tool') {
      segmentOwner = message
      node.classList.remove('message-segment-hidden')
      continue
    }
    node.classList.toggle('message-segment-hidden', segmentOwner !== undefined && collapsedMessages.has(segmentOwner.id))
  }
}

function updateSteerNotice(snapshot: WorkbenchSnapshot): void {
  if (steerPendingText === undefined) return
  const delivered = snapshot.messages.some(message => message.role === 'user' && message.text === steerPendingText)
  if (delivered) {
    steerPendingText = undefined
    elements.steerNotice.classList.add('hidden')
    return
  }
  elements.steerNotice.classList.remove('hidden')
}

function updateScrollBottomButton(): void {
  if (scrollBottomButton === undefined) return
  const conversation = elements.conversation
  const maxScroll = Math.max(0, conversation.scrollHeight - conversation.clientHeight)
  const away = maxScroll - conversation.scrollTop > 48
  scrollBottomButton.classList.toggle('hidden', !away)
}

function applyCompactThinkingButton(): void {
  const taskIds = new Set(state?.messages.flatMap(message => message.taskId === undefined ? [] : [message.taskId]) ?? [])
  const allCollapsed = taskIds.size > 0 && [...taskIds].every(taskId => collapsedTasks.has(taskId))
  elements.compactThinkingButton.classList.toggle('active', allCollapsed)
  elements.compactThinkingButton.setAttribute('aria-pressed', String(allCollapsed))
  elements.compactThinkingButton.title = allCollapsed
    ? 'Expand tasks to the first level; nested process, Vision, reasoning, and tool details stay collapsed'
    : 'Recursively collapse every task and nested detail'
  elements.compactThinkingButton.setAttribute('aria-label', elements.compactThinkingButton.title)
}

function detailSummaryText(message: WorkbenchMessage): string {
  const base = message.role === 'reasoning' ? 'Reasoning' : message.title ?? 'Tool'
  if (!compactThinking || message.text === '') return base
  return `${base} · ${formatChars(message.textLength ?? message.text.length)}`
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
  return `${message.id}\u0000${message.seq ?? ''}\u0000${message.status ?? ''}\u0000${message.text.length}\u0000${message.textLength ?? ''}\u0000${message.title ?? ''}\u0000${message.attachments === undefined ? '' : message.attachments.map(attachment => attachment.kind + attachment.label).join(',')}`
}

function renderMessage(message: WorkbenchMessage): HTMLElement {
  if (message.role === 'reasoning' || message.role === 'tool') {
    const details = document.createElement('details')
    details.className = `message ${message.role}`
    details.dataset.messageId = message.id
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
    if (details.open) body.append(renderMessageBody(message))
    details.append(summary, body)
    summary.addEventListener('click', () => { userToggledDetails.add(message.id) })
    summary.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') userToggledDetails.add(message.id)
    })
    details.addEventListener('toggle', () => {
      if (!details.open) {
        body.replaceChildren()
        return
      }
      const latest = state?.messages.find(item => item.id === message.id)
      if (latest !== undefined) body.replaceChildren(renderMessageBody(latest))
    })
    details.addEventListener('click', event => {
      if (!(event.target instanceof HTMLElement) || event.target.closest('summary') === null) return
      if (event.target.closest('button, a, input, textarea, select') !== null) return
      userToggledDetails.add(message.id)
    })
    return details
  }
  const article = document.createElement('article')
  article.className = `message ${message.role}`
  article.dataset.messageId = message.id
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
    if (body !== null) {
      if (details.open) body.replaceChildren(renderMessageBody(message))
      else body.replaceChildren()
    }
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
  if (message.role === 'user' && message.text !== '') {
    const snapshot = state
    const active = snapshot?.sessions.find(session => session.id === snapshot.activeSessionId)
    const latestUserId = snapshot?.messages.filter(item => item.role === 'user').at(-1)?.id
    const hasActiveTurn = snapshot?.messages.some(item => item.status === 'streaming' || item.taskComplete === false) === true
    if (message.id === latestUserId && active?.running === true && hasActiveTurn && active.operation === undefined) {
      const actions = document.createElement('span')
      actions.className = 'message-actions'
      const edit = document.createElement('button')
      edit.type = 'button'
      edit.className = 'message-action'
      edit.title = 'Edit this prompt and send it as a new message'
      edit.append(svgIcon('pencil'), document.createTextNode('Edit'))
      edit.addEventListener('click', () => {
        elements.prompt.value = message.text
        resizePrompt()
        const persisted = vscode.getState()
        vscode.setState({ ...(typeof persisted === 'object' && persisted !== null ? persisted : {}), draft: message.text })
        elements.prompt.focus()
      })
      const steer = document.createElement('button')
      steer.type = 'button'
      steer.className = 'message-action'
      steer.title = 'Steer the active turn with this prompt'
      steer.append(svgIcon('corner-down-right'), document.createTextNode('Steer'))
      steer.addEventListener('click', () => post({ type: 'send', text: message.text, mode: 'steer' }))
      actions.append(edit, steer)
      head.append(actions)
    }
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
    if (state !== undefined) renderMessageSegments(state.messages)
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
    if (attachment.kind === 'vision') {
      const details = document.createElement('details')
      details.className = 'vision-process'
      const summary = document.createElement('summary')
      summary.append(svgIcon('image'), document.createTextNode(`Vision · ${attachment.model ?? 'image model'} · complete`))
      const body = document.createElement('div')
      body.textContent = attachment.detail ?? 'Vision result is unavailable in this history entry.'
      details.append(summary, body)
      row.append(details)
      continue
    }
    const item = document.createElement('span')
    item.className = 'message-attachment'
    item.title = `${attachment.label} - content hidden from the conversation view`
    item.append(svgIcon(attachment.kind === 'handoff' ? 'arrow-left-right' : 'paperclip'))
    const label = document.createElement('span')
    label.className = 'message-attachment-label'
    label.textContent = attachment.label
    item.append(label)
    if (attachment.uri !== undefined) {
      item.classList.add('attachment-openable')
      item.title = `Open ${attachment.label} in VS Code`
      item.addEventListener('click', () => {
        if (attachment.uri !== undefined) post({ type: 'openAttachment', uri: attachment.uri })
      })
    }
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
    stream.textContent = streamingText(message.text)
    return stream
  }
  const content = document.createElement('div')
  content.innerHTML = markdown(message.text)
  return content
}

function streamingText(value: string): string {
  if (value.length <= maxStreamingChars) return value
  return `[Earlier streaming output hidden to keep the workbench responsive; the complete event remains in Harness session data.]\n\n${value.slice(-maxStreamingChars)}`
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
    if (attachment.pastedPath !== undefined || attachment.uri !== undefined) {
      chip.classList.add('attachment-openable')
      chip.title = 'Open attached file in VS Code'
      chip.addEventListener('click', () => post({ type: 'openAttachment', id: attachment.id }))
    }
    const remove = document.createElement('button')
    remove.title = 'Remove attachment'
    remove.setAttribute('aria-label', 'Remove attachment')
    remove.append(svgIcon('x'))
    remove.addEventListener('click', event => {
      event.stopPropagation()
      post({ type: 'removeAttachment', id: attachment.id })
    })
    chip.append(label, remove)
    return chip
  }))
}

function renderStatus(snapshot: WorkbenchSnapshot): void {
  const active = snapshot.sessions.find(session => session.id === snapshot.activeSessionId)
  const running = active?.running === true
  const cancelling = active?.operation === 'cancelling'
  const compacting = active?.operation === 'compacting'
  const modelUnavailable = snapshot.modelCatalog?.routable === false
  const sendUnavailable = promptUnavailableReason(snapshot)
  const steer = steerAvailable(snapshot)
  renderDeliveryMode()
  const modelControlsUnavailable = modelControlsUnavailableReason(snapshot)
  const compactionUnavailable = snapshot.agentPreset === 'minimal'
  const hasActiveTurn = snapshot.messages.some(message => message.status === 'streaming' || message.taskComplete === false)
  elements.cancel.classList.toggle('hidden', !running || !hasActiveTurn)
  elements.cancel.disabled = cancelling
  elements.cancel.title = cancelling ? 'Stop request is being processed' : 'Stop'
  elements.cancel.setAttribute('aria-label', elements.cancel.title)
  elements.send.classList.toggle('hidden', false)
  const effectiveSteer = steer && (deliveryMode === 'steer' || deliveryMode === 'auto')
  elements.send.classList.toggle('steer', effectiveSteer)
  elements.send.disabled = sendPending || (sendUnavailable !== undefined && !effectiveSteer)
  elements.send.title = sendPending
    ? 'Sending...'
    : effectiveSteer
      ? 'Steer: deliver this prompt into the active turn'
      : sendUnavailable ?? 'Send'
  elements.send.setAttribute('aria-label', elements.send.title)
  elements.modelMenu.disabled = modelControlsUnavailable !== undefined
  elements.modelMenu.title = modelControlsUnavailable ?? 'Model, reasoning, and agent preset'
  elements.modelMenu.setAttribute('aria-label', elements.modelMenu.title)
  const compactDisabled = snapshot.phase !== 'connected' || active === undefined || running || sendPending || active.operation !== undefined || compactionUnavailable
  elements.compact.disabled = compactDisabled
  const compactIconState = compacting ? 'compacting' : 'idle'
  if (elements.compact.dataset.state !== compactIconState) {
    elements.compact.dataset.state = compactIconState
    const icon = svgIcon(compacting ? 'loader-circle' : 'shrink')
    if (compacting) icon.classList.add('session-operation-icon')
    elements.compact.replaceChildren(icon)
  }
  elements.compact.title = compacting
    ? 'Compacting context; session actions are temporarily locked'
    : sendPending
      ? 'Wait for the current message to finish submitting before compacting context'
    : running
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
    ? compacting
      ? 'Compacting context...'
      : modelUnavailable
      ? 'Selected model is unavailable'
      : `${snapshot.runtime.version ?? 'Harness'}${snapshot.hasApiKey ? '' : ' - API key required'}`
    : phase === 'error' ? snapshot.runtime.error ?? snapshot.error ?? 'Runtime error' : phase
}

function renderDeliveryMode(): void {
  const label = deliveryMode === 'auto' ? 'Auto' : deliveryMode === 'steer' ? 'Steer' : 'Queue'
  const detail = deliveryMode === 'auto'
    ? 'Running: steer | Idle: queue'
    : deliveryMode === 'steer' ? 'Inject into active turn' : 'After current turn'
  elements.deliveryMode.title = `Delivery mode: ${label} (${detail})`
  elements.deliveryMode.setAttribute('aria-label', elements.deliveryMode.title)
  elements.deliveryMode.replaceChildren(svgIcon(deliveryMode === 'auto' ? 'wand-sparkles' : deliveryMode === 'steer' ? 'corner-down-right' : 'list-plus'))
  elements.deliveryMode.classList.toggle('steer', deliveryMode === 'steer')
  for (const [id, mode] of [['delivery-auto', 'auto'], ['delivery-steer', 'steer'], ['delivery-queue', 'queue']] as const) {
    const option = requiredButton(id)
    option.classList.toggle('selected', deliveryMode === mode)
    option.setAttribute('aria-checked', String(deliveryMode === mode))
  }
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
  const steer = steerAvailable(state) && (deliveryMode === 'steer' || deliveryMode === 'auto')
  if (steer) {
    steerPendingText = value
    elements.steerNoticeText.textContent = 'Steer message sent to the active turn.'
    elements.steerNotice.classList.remove('hidden')
  }
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
  if (elements.prompt.dataset.manualResize === 'true') return
  elements.prompt.style.height = 'auto'
  elements.prompt.style.height = `${Math.min(480, Math.max(88, elements.prompt.scrollHeight))}px`
}

function startComposerResize(event: PointerEvent): void {
  event.preventDefault()
  const startY = event.clientY
  const startHeight = elements.prompt.getBoundingClientRect().height
  elements.composerResize.setPointerCapture(event.pointerId)
  const move = (moveEvent: PointerEvent): void => {
    const maximum = Math.max(88, Math.min(480, window.innerHeight * 0.5))
    const height = Math.max(88, Math.min(maximum, startHeight + startY - moveEvent.clientY))
    elements.prompt.dataset.manualResize = 'true'
    elements.prompt.style.height = `${String(Math.round(height))}px`
  }
  const finish = (): void => {
    elements.composerResize.removeEventListener('pointermove', move)
    elements.composerResize.removeEventListener('pointerup', finish)
    elements.composerResize.removeEventListener('pointercancel', finish)
  }
  elements.composerResize.addEventListener('pointermove', move)
  elements.composerResize.addEventListener('pointerup', finish)
  elements.composerResize.addEventListener('pointercancel', finish)
}

function requestOlderHistory(): void {
  if (state?.hasMoreHistory !== true || state.historyLoading || historyLoadPending) return
  historyLoadPending = true
  historyLoadScrollHeight = elements.conversation.scrollHeight
  renderHistoryLoader(state)
  post({ type: 'loadOlderHistory' })
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

function showNotice(message: string, level: 'info' | 'warning' | 'error'): void {
  if (noticeTimer !== undefined) window.clearTimeout(noticeTimer)
  elements.notice.textContent = message
  elements.notice.className = `notice ${level}`
  elements.notice.classList.remove('hidden')
  noticeTimer = window.setTimeout(() => {
    elements.notice.classList.add('hidden')
    noticeTimer = undefined
  }, 6_000)
}

function showSettings(settings: WorkbenchSettings, section?: 'connection' | 'vision' | 'context' | 'handoff' | 'skills'): void {
  currentSettings = settings
  elements.settingBaseUrl.value = settings.baseUrl
  elements.settingApiKey.value = ''
  elements.settingApiKey.placeholder = settings.hasApiKey ? 'Configured - leave blank to keep' : 'Enter API key'
  elements.settingVisionUrl.value = settings.visionBaseUrl
  elements.settingVisionModel.value = settings.visionModel
  elements.settingVisionReasoning.value = settings.visionReasoningEffort
  const pickerModels = recommendedVisionModels(settings.visionModels)
  const placeholder = document.createElement('option')
  placeholder.value = ''
  placeholder.textContent = pickerModels.length === 0 ? 'Save URL and key to load models...' : 'Select an endpoint model...'
  elements.settingVisionModelPicker.replaceChildren(placeholder, ...pickerModels.map(model => {
    const option = document.createElement('option')
    option.value = model
    option.textContent = model
    return option
  }))
  elements.settingVisionModelPicker.value = pickerModels.includes(settings.visionModel) ? settings.visionModel : ''
  elements.settingVisionKey.value = ''
  elements.settingVisionKey.placeholder = settings.hasVisionApiKey ? 'Configured - leave blank to keep' : 'Enter Vision API key'
  elements.settingPasteThreshold.value = String(settings.pasteFileThreshold)
  elements.settingContextWindow.value = String(settings.contextWindowTokens)
  elements.settingCodexHome.value = settings.codexHome
  elements.settingClaudeHome.value = settings.claudeHome
  elements.settingHandoffMode.value = settings.handoffLaunchMode
  elements.settingSkillDirectories.value = settings.skillDirectories.join('\n')
  elements.settingsDialog.classList.remove('hidden')
  if (section !== undefined) document.getElementById(`settings-${section}`)?.scrollIntoView({ block: 'start' })
}

function closeSettings(): void {
  elements.settingsDialog.classList.add('hidden')
  elements.prompt.focus()
}

function renderPromptInspection(inspection: import('../webview-protocol.js').PromptInspection): void {
  currentInspection = inspection
  elements.inspectorDialog.classList.remove('hidden')
  elements.inspectorScope.textContent = inspection.scope
  elements.inspectorNote.textContent = inspection.limitation
  const layers = inspection.layers.map(layer => ({ ...layer }))
  const render = (): void => {
    elements.inspectorBody.replaceChildren(...layers.map((layer, index) => {
      const card = document.createElement('article')
      card.className = 'inspector-layer'
      card.draggable = true
      card.dataset.layerId = layer.id
      const grip = document.createElement('span')
      grip.textContent = '::'
      grip.title = 'Drag to reorder this preview layer'
      const copy = document.createElement('div')
      const title = document.createElement('div')
      title.className = 'inspector-layer-title'
      title.textContent = layer.label
      const meta = document.createElement('div')
      meta.className = 'inspector-layer-meta'
      meta.textContent = `${layer.source} · ${String(layer.bytes)} bytes · ${layer.detail}`
      const details = document.createElement('details')
      const summary = document.createElement('summary')
      summary.textContent = 'View content'
      const pre = document.createElement('pre')
      pre.textContent = layer.text
      details.append(summary, pre)
      copy.append(title, meta, details)
      const enabled = document.createElement('input')
      enabled.type = 'checkbox'
      enabled.checked = layer.enabled
      enabled.title = 'Include this layer in the local preview'
      enabled.addEventListener('change', () => {
        const found = layers[index]
        if (found !== undefined) layers[index] = { ...found, enabled: enabled.checked }
        render()
      })
      card.append(grip, copy, enabled)
      card.addEventListener('dragstart', () => card.classList.add('dragging'))
      card.addEventListener('dragend', () => card.classList.remove('dragging'))
      card.addEventListener('dragover', event => event.preventDefault())
      card.addEventListener('drop', event => {
        event.preventDefault()
        const from = layers.findIndex(item => item.id === document.querySelector('.inspector-layer.dragging')?.getAttribute('data-layer-id'))
        if (from < 0 || from === index) return
        const [moved] = layers.splice(from, 1)
        if (moved !== undefined) layers.splice(index, 0, moved)
        render()
      })
      return card
    }))
    const preview = document.createElement('pre')
    preview.className = 'inspector-layer'
    preview.textContent = layers.filter(layer => layer.enabled).map(layer => `### ${layer.label}\n${layer.text}`).join('\n\n')
    elements.inspectorBody.append(preview)
  }
  render()
}

function copyInspection(): void {
  if (currentInspection === undefined) return
  const text = currentInspection.layers.map(layer => `### ${layer.label}\n${layer.text}`).join('\n\n')
  post({ type: 'copyInspection', text })
}

function renderVisionModelOptions(): void {
  const settings = currentSettings
  if (settings === undefined) return
  const allModels = settings.visionModels.length > 0 ? settings.visionModels : (settings.visionModel === '' ? [] : [settings.visionModel])
  const recommended = recommendedVisionModels(allModels)
  const models = showAllVisionModels ? allModels : recommended
  const options = models.map(model => menuOption({
    label: model,
    selected: model === settings.visionModel,
    handler: () => {
      post({ type: 'saveSettings', settings: { ...settings, visionModel: model } })
      closePopovers()
    },
  }))
  if (allModels.length > recommended.length) options.push(menuOption({
    label: showAllVisionModels ? 'Show recommended models only' : `Show all endpoint models (${String(allModels.length)})`,
    description: showAllVisionModels ? 'Hide obvious image-generation and code-review-only models' : 'Includes models that may not accept image input',
    selected: false,
    handler: () => { showAllVisionModels = !showAllVisionModels; renderVisionModelOptions() },
  }))
  options.push(menuOption({ label: 'Configure vision...', selected: false, handler: () => { post({ type: 'openVisionSettings' }); closePopovers() } }))
  elements.visionModelOptions.replaceChildren(...options)
}

function recommendedVisionModels(models: readonly string[]): string[] {
  const excluded = /(?:^|[-_.])(image|imagen|dall-?e|flux|sdxl|stable-?diffusion|seedream|sora|code-?review|auto-?review)(?:$|[-_.0-9])/iu
  return [...new Set(models)].filter(model => !excluded.test(model)).sort((left, right) => left.localeCompare(right))
}

function saveSettings(): void {
  const previous = currentSettings
  if (previous === undefined) return
  const pasteFileThreshold = Math.max(1_024, Math.min(131_072, Number(elements.settingPasteThreshold.value) || previous.pasteFileThreshold))
  const contextWindowTokens = Math.max(16_384, Math.min(16_000_000, Number(elements.settingContextWindow.value) || previous.contextWindowTokens))
  post({
    type: 'saveSettings',
    settings: {
      baseUrl: elements.settingBaseUrl.value.trim(),
      hasApiKey: previous.hasApiKey,
      visionBaseUrl: elements.settingVisionUrl.value.trim(),
      visionModel: elements.settingVisionModel.value.trim(),
      visionReasoningEffort: elements.settingVisionReasoning.value,
      visionModels: previous.visionModels,
      hasVisionApiKey: previous.hasVisionApiKey,
      pasteFileThreshold,
      contextWindowTokens,
      codexHome: elements.settingCodexHome.value.trim(),
      claudeHome: elements.settingClaudeHome.value.trim(),
      handoffLaunchMode: elements.settingHandoffMode.value === 'cli' ? 'cli' : 'clipboard',
      skillDirectories: elements.settingSkillDirectories.value.split(/\r?\n/u).map(value => value.trim()).filter(Boolean),
      ...(elements.settingApiKey.value.trim() === '' ? {} : { apiKey: elements.settingApiKey.value.trim() }),
      ...(elements.settingVisionKey.value.trim() === '' ? {} : { visionApiKey: elements.settingVisionKey.value.trim() }),
    },
  })
  elements.settingsDialog.classList.add('hidden')
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

function requiredInput(id: string): HTMLInputElement {
  const element = required(id)
  if (!(element instanceof HTMLInputElement)) throw new Error(`Expected input: ${id}`)
  return element
}

function requiredSelect(id: string): HTMLSelectElement {
  const element = required(id)
  if (!(element instanceof HTMLSelectElement)) throw new Error(`Expected select: ${id}`)
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

import type { WorkbenchMessageAttachment } from './types.js'

export interface ProjectedUserPrompt {
  readonly text: string
  readonly attachments: readonly WorkbenchMessageAttachment[]
}

const contextStart = '<editor_context '
const contextEnd = '\n</editor_context>'
const contextHeader = /^<editor_context kind=("(?:\\.|[^"\\])*") label=("(?:\\.|[^"\\])*")(?: uri=("(?:\\.|[^"\\])*"))?(?: model=("(?:\\.|[^"\\])*"))?>$/u

export function projectUserPrompt(value: string): ProjectedUserPrompt {
  const normalized = value.replaceAll('\r\n', '\n')
  const contextual = extractEditorContexts(normalized)
  if (contextual.attachments.length > 0) return contextual
  return projectLegacyHandoff(normalized) ?? { text: value, attachments: [] }
}

function extractEditorContexts(value: string): ProjectedUserPrompt {
  const attachments: WorkbenchMessageAttachment[] = []
  const visible: string[] = []
  let cursor = 0
  let scan = 0

  while (scan < value.length) {
    const start = value.indexOf(contextStart, scan)
    if (start < 0) break
    if (start > 0 && value[start - 1] !== '\n') {
      scan = start + contextStart.length
      continue
    }
    const headerEnd = value.indexOf('>\n', start)
    if (headerEnd < 0) break
    const end = value.indexOf(contextEnd, headerEnd + 2)
    if (end < 0) break
    const body = value.slice(headerEnd + 2, end)
    const attachment = parseContextHeader(value.slice(start, headerEnd + 1), body)
    if (attachment === undefined) {
      scan = start + contextStart.length
      continue
    }
    visible.push(value.slice(cursor, start))
    attachments.push(attachment)
    cursor = end + contextEnd.length
    scan = cursor
  }

  if (attachments.length === 0) return { text: value, attachments }
  visible.push(value.slice(cursor))
  return { text: cleanVisibleText(visible.join('')), attachments }
}

function parseContextHeader(value: string, body: string): WorkbenchMessageAttachment | undefined {
  const match = contextHeader.exec(value)
  if (match === null) return undefined
  try {
    const kind: unknown = JSON.parse(match[1] ?? '')
    const label: unknown = JSON.parse(match[2] ?? '')
    const uri: unknown = match[3] === undefined ? undefined : JSON.parse(match[3])
    const model: unknown = match[4] === undefined ? undefined : JSON.parse(match[4])
    if (typeof label !== 'string') return undefined
    const handoff = handoffAttachment(label)
    if (handoff !== undefined) return handoff
    return {
      kind: kind === 'selection' || kind === 'diagnostics' || kind === 'vision' || kind === 'skill' ? kind : 'file',
      label: boundedLabel(label.trim() || 'Attached context'),
      ...(typeof uri === 'string' ? { uri } : {}),
      ...(kind === 'vision' ? { detail: body, ...(typeof model === 'string' ? { model } : {}) } : {}),
    }
  } catch {
    return undefined
  }
}

function projectLegacyHandoff(value: string): ProjectedUserPrompt | undefined {
  const marker = value.search(/^#?\s*Isolated agent handoff\s*$/mu)
  if (marker < 0) return undefined
  const source = metadata(value, 'Source') ?? 'Cross-agent'
  const title = metadata(value, 'Source title')
  const lead = value.slice(0, marker).replaceAll('<agent_handoff>', '').trim()
  return {
    text: firstSentence(lead) || 'Continue from this isolated cross-agent handoff.',
    attachments: [{
      kind: 'handoff',
      label: boundedLabel(title === undefined ? `${source} handoff` : `${source} handoff - ${title}`),
    }],
  }
}

function handoffAttachment(label: string): WorkbenchMessageAttachment | undefined {
  const codex = /^codex-handoff-(.+)\.md$/iu.exec(label)
  if (codex !== null) return { kind: 'handoff', label: boundedLabel(`Codex handoff - ${codex[1] ?? 'session'}`) }
  const claude = /^claude-code-handoff-(.+)\.md$/iu.exec(label)
  if (claude !== null) return { kind: 'handoff', label: boundedLabel(`Claude Code handoff - ${claude[1] ?? 'session'}`) }
  return undefined
}

function metadata(value: string, key: 'Source' | 'Source title'): string | undefined {
  const pattern = new RegExp(`^\\s*(?:-\\s*)?${key}:\\s*(.+?)\\s*$`, 'imu')
  const found = pattern.exec(value)?.[1]?.replace(/[*`]/gu, '').trim()
  return found === undefined || found === '' ? undefined : found
}

function firstSentence(value: string): string {
  const compact = value.replace(/\s+/gu, ' ').trim()
  const match = /^.*?[.!?](?:\s|$)/u.exec(compact)
  return boundedText((match?.[0] ?? compact).trim(), 180)
}

function cleanVisibleText(value: string): string {
  return value.replaceAll('\r\n', '\n').replace(/\n{3,}/gu, '\n\n').trim()
}

function boundedLabel(value: string): string {
  return boundedText(value, 180)
}

function boundedText(value: string, limit: number): string {
  if (value.length <= limit) return value
  return `${value.slice(0, limit - 3).trimEnd()}...`
}

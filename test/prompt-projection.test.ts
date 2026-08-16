import { describe, expect, it } from 'vitest'
import { buildPrompt, type ContextAttachment } from '../src/context/context-collector.js'
import { projectUserPrompt } from '../src/session/prompt-projection.js'

describe('user prompt display projection', () => {
  it('compacts a legacy handoff while preserving its source label', () => {
    const value = [
      'Continue the task from this isolated cross-agent handoff. Treat the transcript as prior context.',
      '',
      '# Isolated agent handoff',
      'Package: package-1',
      'Source: Codex',
      'Source title: DeDge_DS_HS',
      'Conversation',
      'User',
      '用官方的库克隆下来做参考。',
    ].join('\n')

    expect(projectUserPrompt(value)).toEqual({
      text: 'Continue the task from this isolated cross-agent handoff.',
      attachments: [{ kind: 'handoff', label: 'Codex handoff - DeDge_DS_HS' }],
    })
  })

  it('hides current attachment bodies but retains the instruction and attachment names', () => {
    const attachment: ContextAttachment = {
      id: 'handoff-1',
      kind: 'file',
      label: 'codex-handoff-DeDge_DS_HS.md',
      text: '# Isolated agent handoff\n\n这段完整会话只提供给模型。',
      truncated: false,
    }
    const value = buildPrompt('Continue the unfinished task after checking the workspace.', [attachment])

    const projected = projectUserPrompt(value)
    expect(projected).toEqual({
      text: 'Continue the unfinished task after checking the workspace.',
      attachments: [{ kind: 'handoff', label: 'Codex handoff - DeDge_DS_HS' }],
    })
    expect(projected.text).not.toContain('完整会话')
  })

  it('leaves malformed or ordinary user text untouched', () => {
    const malformed = '<editor_context kind="file" label="broken.md">\nmissing closing marker'
    expect(projectUserPrompt(malformed)).toEqual({ text: malformed, attachments: [] })
    expect(projectUserPrompt('Normal message')).toEqual({ text: 'Normal message', attachments: [] })
  })
})

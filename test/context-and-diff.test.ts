import { describe, expect, it } from 'vitest'
import { buildPrompt, ContextCollector, limitUtf8 } from '../src/context/context-collector.js'
import { parseStatus } from '../src/diff/change-review.js'

describe('UTF-8 context limits', () => {
  it('keeps text unchanged when it fits the byte budget', () => {
    expect(limitUtf8('hello', 5)).toEqual({ text: 'hello', truncated: false })
  })

  it('never cuts in the middle of a multi-byte code point', () => {
    const limited = limitUtf8('A\u{1f600}\u754cB', 6)
    expect(limited.truncated).toBe(true)
    expect(limited.text).toBe('A\u{1f600}\n[truncated]')
    expect(Buffer.from(limited.text.replace('\n[truncated]', ''), 'utf8').byteLength).toBeLessThanOrEqual(6)
  })

  it('builds a prompt with explicit context boundaries', () => {
    expect(buildPrompt('Explain', [{ id: 'f-1', kind: 'file', label: 'src/a.ts', text: 'const x = 1', truncated: false }]))
      .toBe('<editor_context kind="file" label="src/a.ts">\nconst x = 1\n</editor_context>\n\nExplain')
  })

  it('converts pasted text files into bounded attachments and rejects binary content', () => {
    const collector = new ContextCollector()
    expect(collector.collectTextFile('folder/example.txt', 'hello world', 5)).toMatchObject({
      kind: 'file',
      label: 'example.txt',
      truncated: true,
    })
    expect(() => collector.collectTextFile('binary.bin', 'a\u0000b', 32)).toThrow('binary')
  })
})

describe('Git porcelain parsing', () => {
  it('parses ordinary, untracked and rename records from NUL-delimited output', () => {
    const value = [
      ' M src/changed.ts',
      '?? notes with spaces.md',
      'R  src/new-name.ts',
      'src/old-name.ts',
      'C  src/copied.ts',
      'src/source.ts',
      '',
    ].join('\0')

    expect(parseStatus(value)).toEqual([
      { status: ' M', path: 'src/changed.ts', untracked: false, added: false, deleted: false },
      { status: '??', path: 'notes with spaces.md', untracked: true, added: false, deleted: false },
      { status: 'R ', path: 'src/new-name.ts', originalPath: 'src/old-name.ts', untracked: false, added: false, deleted: false },
      { status: 'C ', path: 'src/copied.ts', originalPath: 'src/source.ts', untracked: false, added: false, deleted: false },
    ])
  })

  it('ignores malformed records instead of inventing paths', () => {
    expect(parseStatus('x\0   \0')).toEqual([])
  })
})

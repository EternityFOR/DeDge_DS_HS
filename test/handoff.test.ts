import { mkdtemp, mkdir, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { normalizeBaseUrl, OFFICIAL_DEEPSEEK_BASE_URL, parseTokenCount } from '../src/config/configuration.js'
import { codexThreadListDescriptors } from '../src/handoff/codex-app-server.js'
import { createHandoffPackage, createStagedHandoff, renderHandoffMarkdown, renderTargetPrompt } from '../src/handoff/handoff-format.js'
import { groupExternalSessions } from '../src/handoff/session-groups.js'
import { expandUserPath, listExternalSessions, readExternalSession } from '../src/handoff/session-readers.js'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
})

describe('API endpoint configuration', () => {
  it('normalizes the official endpoint and compatible http endpoints', () => {
    expect(normalizeBaseUrl(OFFICIAL_DEEPSEEK_BASE_URL)).toBe('https://api.deepseek.com/')
    expect(normalizeBaseUrl('http://127.0.0.1:3000/v1')).toBe('http://127.0.0.1:3000/v1')
  })

  it('rejects credentials and unsupported URL schemes', () => {
    expect(() => normalizeBaseUrl('https://user:secret@example.com/v1')).toThrow('must not contain credentials')
    expect(() => normalizeBaseUrl('file:///tmp/api')).toThrow('http or https')
    expect(() => normalizeBaseUrl('not a url')).toThrow('valid absolute')
  })

  it('parses configurable context-window counts with K and M suffixes', () => {
    expect(parseTokenCount('256K')).toBe(256_000)
    expect(parseTokenCount('1M')).toBe(1_000_000)
    expect(parseTokenCount('353000')).toBe(353_000)
    expect(() => parseTokenCount('8K')).toThrow('16,384')
    expect(() => parseTokenCount('1.5')).toThrow('integer')
  })
})

describe('read-only external session discovery', () => {
  it('maps the official Codex thread list without surfacing temporary or duplicate rows', () => {
    const sessions = codexThreadListDescriptors({
      data: [
        {
          id: '11111111-2222-3333-4444-555555555555',
          path: 'C:\\Users\\tester\\.codex\\sessions\\root.jsonl',
          name: 'Renamed root chat',
          preview: 'Original prompt',
          cwd: 'D:\\work',
          recencyAt: 123,
          modelProvider: 'CurrentProvider',
        },
        {
          id: '11111111-2222-3333-4444-555555555555',
          path: 'C:\\Users\\tester\\.codex\\sessions\\duplicate.jsonl',
          preview: 'Duplicate row',
          recencyAt: 122,
        },
        {
          id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
          path: 'C:\\Users\\tester\\.codex\\sessions\\ambient.jsonl',
          preview: 'Ambient suggestion',
          threadSource: 'ambient_suggestions',
          recencyAt: 121,
        },
        {
          id: '99999999-8888-7777-6666-555555555555',
          path: 'C:\\Users\\tester\\.codex\\sessions\\ephemeral.jsonl',
          preview: 'Temporary',
          ephemeral: true,
          recencyAt: 120,
        },
      ],
      nextCursor: null,
    })

    expect(sessions).toEqual([{
      platform: 'codex',
      source: 'active',
      id: '11111111-2222-3333-4444-555555555555',
      title: 'Renamed root chat',
      filePath: 'C:\\Users\\tester\\.codex\\sessions\\root.jsonl',
      updatedAt: 123_000,
      cwd: 'D:\\work',
    }])
  })

  it('extracts user and final assistant text from Codex while excluding commentary', async () => {
    const home = await temporaryHome()
    const sessionDirectory = path.join(home, 'sessions', '2026', '08', '16')
    await mkdir(sessionDirectory, { recursive: true })
    const filePath = path.join(sessionDirectory, 'rollout-2026-08-16T00-00-00-12345678-1234-1234-1234-123456789abc.jsonl')
    await writeJsonl(filePath, [
      { type: 'session_meta', timestamp: '2026-08-16T00:00:00Z', payload: { id: '12345678-1234-1234-1234-123456789abc', cwd: 'D:\\work' } },
      { type: 'event_msg', timestamp: '2026-08-16T00:00:01Z', payload: { type: 'user_message', message: 'Fix the parser' } },
      { type: 'event_msg', timestamp: '2026-08-16T00:00:02Z', payload: { type: 'agent_message', phase: 'commentary', message: 'Reading files' } },
      { type: 'session_meta', timestamp: '2026-08-16T00:00:02Z', payload: { id: '12345678-1234-1234-1234-123456789abc', cwd: 'D:\\work' } },
      { type: 'event_msg', timestamp: '2026-08-16T00:00:03Z', payload: { type: 'agent_message', phase: 'final_answer', message: 'Parser fixed' } },
    ])

    const sessions = await listExternalSessions('codex', home)
    expect(sessions).toHaveLength(1)
    expect(sessions[0]).toMatchObject({ id: '12345678-1234-1234-1234-123456789abc', title: 'Fix the parser', cwd: 'D:\\work' })
    expect(await readExternalSession(sessions[0]!, 32_768)).toMatchObject({
      platform: 'codex',
      turns: [
        { role: 'user', text: 'Fix the parser' },
        { role: 'assistant', text: 'Parser fixed' },
      ],
    })
  })

  it('uses the latest Codex index name and never discovers archived sessions', async () => {
    const home = await temporaryHome()
    const activeDirectory = path.join(home, 'sessions', '2026', '08', '16')
    const archivedDirectory = path.join(home, 'archived_sessions')
    await Promise.all([mkdir(activeDirectory, { recursive: true }), mkdir(archivedDirectory, { recursive: true })])
    const id = '11111111-2222-3333-4444-555555555555'
    await writeJsonl(path.join(activeDirectory, `rollout-2026-08-16T00-00-00-${id}.jsonl`), [
      { type: 'session_meta', payload: { id, cwd: 'D:\\active' } },
      { type: 'event_msg', payload: { type: 'user_message', message: 'Original prompt title' } },
    ])
    await writeJsonl(path.join(archivedDirectory, 'rollout-2026-08-16T00-00-00-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.jsonl'), [
      { type: 'session_meta', payload: { id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' } },
      { type: 'event_msg', payload: { type: 'user_message', message: 'Archived chat' } },
    ])
    await writeJsonl(path.join(home, 'session_index.jsonl'), [
      { id, thread_name: 'Old name', updated_at: '2026-08-16T00:00:00Z' },
      { id, thread_name: 'Renamed active chat', updated_at: '2026-08-16T00:01:00Z' },
      { id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', thread_name: 'Renamed archive', updated_at: '2026-08-16T00:02:00Z' },
    ])

    const sessions = await listExternalSessions('codex', home)
    expect(sessions).toHaveLength(1)
    expect(sessions[0]).toMatchObject({ id, title: 'Renamed active chat', source: 'active', cwd: 'D:\\active' })
  })

  it('refuses to merge different Codex session IDs found in one rollout', async () => {
    const home = await temporaryHome()
    const directory = path.join(home, 'sessions', '2026', '08', '16')
    await mkdir(directory, { recursive: true })
    const firstId = '11111111-2222-3333-4444-555555555555'
    const secondId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
    await writeJsonl(path.join(directory, `rollout-2026-08-16T00-00-00-${firstId}.jsonl`), [
      { type: 'session_meta', payload: { id: firstId } },
      { type: 'event_msg', payload: { type: 'user_message', message: 'First session' } },
      { type: 'session_meta', payload: { id: secondId } },
      { type: 'event_msg', payload: { type: 'user_message', message: 'Second session' } },
    ])

    const descriptor = (await listExternalSessions('codex', home))[0]
    expect(descriptor).toBeDefined()
    await expect(readExternalSession(descriptor!, 32_768)).rejects.toThrow('refusing to merge session boundaries')
  })

  it('filters Codex subagent and guardian transcripts from the user session picker', async () => {
    const home = await temporaryHome()
    const directory = path.join(home, 'sessions', '2026', '08', '16')
    await mkdir(directory, { recursive: true })
    const rootId = '11111111-2222-3333-4444-555555555555'
    const spawnedId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
    const guardianId = '99999999-8888-7777-6666-555555555555'
    await writeJsonl(path.join(directory, `rollout-root-${rootId}.jsonl`), [
      { type: 'session_meta', payload: { id: rootId, source: 'vscode', cwd: 'D:\\work' } },
      { type: 'event_msg', payload: { type: 'user_message', message: 'Root conversation' } },
    ])
    await writeJsonl(path.join(directory, `rollout-spawned-${spawnedId}.jsonl`), [
      { type: 'session_meta', payload: { id: spawnedId, source: { subagent: { thread_spawn: { parent_thread_id: rootId } } }, cwd: 'D:\\work' } },
      { type: 'event_msg', payload: { type: 'user_message', message: 'Internal worker' } },
    ])
    await writeJsonl(path.join(directory, `rollout-guardian-${guardianId}.jsonl`), [
      { type: 'session_meta', payload: { id: guardianId, source: { subagent: { other: 'guardian' } }, cwd: 'D:\\work' } },
      { type: 'event_msg', payload: { type: 'user_message', message: 'Internal guardian' } },
    ])

    const sessions = await listExternalSessions('codex', home)
    expect(sessions.map(session => session.id)).toEqual([rootId])
  })

  it('continues fallback discovery past a full batch of newer subagent transcripts', async () => {
    const home = await temporaryHome()
    const directory = path.join(home, 'sessions', '2026', '08', '16')
    await mkdir(directory, { recursive: true })
    const rootId = '11111111-2222-3333-4444-555555555555'
    const rootPath = path.join(directory, `rollout-root-${rootId}.jsonl`)
    await writeJsonl(rootPath, [
      { type: 'session_meta', payload: { id: rootId, source: 'vscode', cwd: 'D:\\work' } },
      { type: 'event_msg', payload: { type: 'user_message', message: 'Older root conversation' } },
    ])
    await utimes(rootPath, new Date('2020-01-01T00:00:00Z'), new Date('2020-01-01T00:00:00Z'))
    await Promise.all(Array.from({ length: 70 }, async (_, index) => {
      const id = `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`
      await writeJsonl(path.join(directory, `rollout-worker-${id}.jsonl`), [
        { type: 'session_meta', payload: { id, source: { subagent: { thread_spawn: { parent_thread_id: rootId } } } } },
        { type: 'event_msg', payload: { type: 'user_message', message: `Worker ${String(index)}` } },
      ])
    }))

    const sessions = await listExternalSessions('codex', home, 1)
    expect(sessions.map(session => session.id)).toEqual([rootId])
  })

  it('excludes non-interactive Codex exec, MCP, and unknown sources in fallback mode', async () => {
    const home = await temporaryHome()
    const directory = path.join(home, 'sessions', '2026', '08', '16')
    await mkdir(directory, { recursive: true })
    const sources = ['exec', 'mcp', 'unknown'] as const
    await Promise.all(sources.map(async (source, index) => {
      const id = `00000000-0000-4000-9000-${String(index).padStart(12, '0')}`
      await writeJsonl(path.join(directory, `rollout-${source}-${id}.jsonl`), [
        { type: 'session_meta', payload: { id, source } },
        { type: 'event_msg', payload: { type: 'user_message', message: source } },
      ])
    }))

    expect(await listExternalSessions('codex', home)).toEqual([])
  })

  it('groups external sessions by project with the current workspace first', () => {
    const sessions = [
      { platform: 'codex', source: 'active', id: 'other', title: 'Other', filePath: 'other.jsonl', updatedAt: 30, cwd: 'D:\\projects\\Other' },
      { platform: 'codex', source: 'active', id: 'current-old', title: 'Old', filePath: 'old.jsonl', updatedAt: 10, cwd: 'D:\\projects\\Current' },
      { platform: 'codex', source: 'active', id: 'current-new', title: 'New', filePath: 'new.jsonl', updatedAt: 20, cwd: 'd:\\projects\\current\\' },
    ] as const

    const groups = groupExternalSessions(sessions, ['D:\\projects\\Current'])
    expect(groups.map(group => group.label)).toEqual(['Current workspace - Current (2)', 'Project - Other (1)'])
    expect(groups[0]?.sessions.map(session => session.id)).toEqual(['current-new', 'current-old'])
  })

  it('extracts only top-level text turns from Claude sessions', async () => {
    const home = await temporaryHome()
    const sessionDirectory = path.join(home, 'projects', 'project-a')
    await mkdir(sessionDirectory, { recursive: true })
    const filePath = path.join(sessionDirectory, 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.jsonl')
    await writeJsonl(filePath, [
      { type: 'user', sessionId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', cwd: '/work', message: { role: 'user', content: 'Continue here' } },
      { type: 'assistant', sessionId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', cwd: '/work', message: { role: 'assistant', content: [{ type: 'thinking', thinking: 'private' }, { type: 'text', text: 'Done' }] } },
      { type: 'assistant', isSidechain: true, sessionId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', message: { role: 'assistant', content: [{ type: 'text', text: 'Subagent detail' }] } },
    ])

    const sessions = await listExternalSessions('claude', home)
    expect(sessions).toHaveLength(1)
    expect((await readExternalSession(sessions[0]!, 32_768)).turns).toEqual([
      { role: 'user', text: 'Continue here' },
      { role: 'assistant', text: 'Done' },
    ])
  })

  it('expands portable home placeholders without touching the source directory', () => {
    expect(expandUserPath('${userHome}/.codex', 'C:\\Users\\tester')).toBe(path.resolve('C:\\Users\\tester/.codex'))
    expect(expandUserPath('~/.claude', '/home/tester')).toBe(path.join('/home/tester', '.claude'))
  })
})

describe('canonical handoff format', () => {
  it('keeps recent turns within budget and marks source ownership', () => {
    const value = createHandoffPackage({
      platform: 'codex',
      sessionId: 'session-1',
      title: 'Task',
      turns: [
        { role: 'user', text: 'old'.repeat(100) },
        { role: 'assistant', text: 'recent result' },
      ],
    }, ['D:\\work'], 64)
    expect(value.source.turns).toEqual([{ role: 'assistant', text: 'recent result' }])
    expect(renderHandoffMarkdown(value)).toContain('- Source: Codex')
    expect(renderTargetPrompt(value)).toContain('Do not write to or rewrite the source platform session files.')
  })

  it('creates an unsent, attachment-based draft for external sessions', () => {
    const value = createHandoffPackage({
      platform: 'codex',
      sessionId: 'codex-1',
      title: 'Fix: Windows / PowerShell',
      turns: [{ role: 'user', text: 'Inspect the launcher.' }],
    }, [], 65_536)
    const draft = createStagedHandoff(value)
    expect(draft.prompt).toContain('attached isolated Codex handoff')
    expect(draft.attachmentName).toBe('codex-handoff-Fix- Windows - PowerShell.md')
    expect(draft.attachmentText).toContain('Inspect the launcher.')
  })
})

async function temporaryHome(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'dedge-handoff-'))
  temporaryDirectories.push(directory)
  return directory
}

async function writeJsonl(filePath: string, records: readonly unknown[]): Promise<void> {
  await writeFile(filePath, `${records.map(record => JSON.stringify(record)).join('\n')}\n`, 'utf8')
}

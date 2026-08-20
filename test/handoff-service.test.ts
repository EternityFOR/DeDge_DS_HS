import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ConfigurationService } from '../src/config/configuration.js'
import { HandoffService } from '../src/handoff/handoff-service.js'
import type { HandoffSource, StagedHandoff } from '../src/handoff/types.js'
import type { Logger } from '../src/platform/logger.js'
import type { StorageLayout } from '../src/platform/storage.js'
import type { WorkbenchController } from '../src/session/workbench-controller.js'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('staged external handoffs', () => {
  it('creates a new Harness session without sending a model prompt', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'dedge-staged-handoff-'))
    roots.push(root)
    const layout = storageLayout(root)
    await mkdir(layout.handoffs, { recursive: true })
    const newSession = vi.fn(async () => undefined)
    const send = vi.fn(async () => undefined)
    const renameSession = vi.fn(async () => undefined)
    const controller = {
      newSession,
      send,
      renameSession,
      snapshot: () => ({ activeSessionId: undefined }),
    } as unknown as WorkbenchController
    const configuration = { get: () => ({ handoffMaxBytes: 65_536 }) } as unknown as ConfigurationService
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as Logger
    const service = new HandoffService(configuration, controller, layout, logger)
    const source: HandoffSource = {
      platform: 'codex',
      sessionId: 'codex-session',
      title: 'Read-only source',
      turns: [{ role: 'user', text: 'Continue this safely.' }],
    }
    const execute = (service as unknown as {
      execute(source: HandoffSource, target: 'deepseek-harness'): Promise<StagedHandoff | undefined>
    }).execute.bind(service)

    const draft = await execute(source, 'deepseek-harness')

    expect(newSession).toHaveBeenCalledTimes(1)
    expect(send).not.toHaveBeenCalled()
    expect(draft).toMatchObject({ sourcePlatform: 'codex', prompt: expect.stringContaining('attached isolated Codex handoff') })
  })
})

function storageLayout(root: string): StorageLayout {
  return {
    root,
    harnessHomes: path.join(root, 'harness-homes'),
    runtimeBin: path.join(root, 'runtime-bin'),
    generated: path.join(root, 'generated'),
    logs: path.join(root, 'logs'),
    temp: path.join(root, 'tmp'),
    snapshots: path.join(root, 'snapshots'),
    handoffs: path.join(root, 'handoffs'),
    sessionTrash: path.join(root, 'session-trash'),
  }
}

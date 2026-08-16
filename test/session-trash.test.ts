import { access, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { StorageLayout } from '../src/platform/storage.js'
import { SessionTrashService } from '../src/session/session-trash.js'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
})

describe('recoverable Harness session deletion', () => {
  it('finds a managed session and atomically moves its complete directory to recovery storage', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'dedge-session-trash-'))
    temporaryDirectories.push(root)
    const layout = storageLayout(root)
    const sessionId = 'session-11111111-2222-3333-4444-555555555555'
    const source = path.join(layout.harnessHomes, '0.1.0-rc.6', 'sessions', 'workspace-a', sessionId)
    await mkdir(source, { recursive: true })
    await writeFile(path.join(source, 'session.jsonl.zstd'), 'compressed-session', 'utf8')
    const service = new SessionTrashService(layout)

    const located = await service.locate('0.1.0-rc.6', sessionId)
    const trashed = await service.moveToTrash('0.1.0-rc.6', sessionId, located)

    await expect(access(source)).rejects.toThrow()
    expect(await readFile(path.join(trashed.dataPath, 'session.jsonl.zstd'), 'utf8')).toBe('compressed-session')
    expect(JSON.parse(await readFile(trashed.manifestPath, 'utf8'))).toMatchObject({ sessionId, runtimeVersion: '0.1.0-rc.6', originalPath: source })
  })

  it('refuses session IDs that could escape the managed session tree', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'dedge-session-trash-'))
    temporaryDirectories.push(root)
    await expect(new SessionTrashService(storageLayout(root)).locate('0.1.0-rc.6', '../outside')).rejects.toThrow('unsafe session ID')
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

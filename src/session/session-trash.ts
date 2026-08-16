import { randomUUID } from 'node:crypto'
import { mkdir, readdir, realpath, rename, rm, stat, writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import type { StorageLayout } from '../platform/storage.js'
import { versionedHome } from '../platform/storage.js'

const MAX_SCANNED_DIRECTORIES = 10_000
const MAX_SCAN_DEPTH = 4

export interface TrashedSession {
  readonly directory: string
  readonly dataPath: string
  readonly manifestPath: string
}

export class SessionTrashService {
  constructor(private readonly layout: StorageLayout) {}

  async locate(runtimeVersion: string, sessionId: string): Promise<string> {
    validateSessionId(sessionId)
    const sessionsRoot = path.join(versionedHome(this.layout, runtimeVersion), 'sessions')
    const pending: { readonly directory: string; readonly depth: number }[] = [{ directory: sessionsRoot, depth: 0 }]
    let scanned = 0
    while (pending.length > 0 && scanned < MAX_SCANNED_DIRECTORIES) {
      const current = pending.pop()
      if (current === undefined) break
      scanned += 1
      let entries
      try {
        entries = await readdir(current.directory, { withFileTypes: true })
      } catch {
        continue
      }
      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        const candidate = path.join(current.directory, entry.name)
        if (entry.name === sessionId) {
          await assertContainedDirectory(sessionsRoot, candidate)
          return candidate
        }
        if (current.depth < MAX_SCAN_DEPTH) pending.push({ directory: candidate, depth: current.depth + 1 })
      }
    }
    throw new Error(`Could not locate persisted data for session ${sessionId}. It was not deleted.`)
  }

  async moveToTrash(runtimeVersion: string, sessionId: string, sourcePath: string): Promise<TrashedSession> {
    validateSessionId(sessionId)
    if (path.basename(sourcePath) !== sessionId) throw new Error('Session storage path did not match the requested session ID; deletion was refused.')
    const sessionsRoot = path.join(versionedHome(this.layout, runtimeVersion), 'sessions')
    await assertContainedDirectory(sessionsRoot, sourcePath)
    await mkdir(this.layout.sessionTrash, { recursive: true })
    const timestamp = new Date().toISOString().replace(/[:.]/gu, '-')
    const directory = path.join(this.layout.sessionTrash, `${timestamp}-${sessionId}-${randomUUID().slice(0, 8)}`)
    const dataPath = path.join(directory, sessionId)
    const manifestPath = path.join(directory, 'manifest.json')
    await mkdir(directory, { recursive: false })
    try {
      await writeFile(manifestPath, `${JSON.stringify({
        version: 1,
        sessionId,
        runtimeVersion,
        deletedAt: new Date().toISOString(),
        originalPath: sourcePath,
        dataPath,
      }, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
      await rename(sourcePath, dataPath)
    } catch (error) {
      if (!await exists(dataPath)) await rm(directory, { recursive: true, force: true }).catch(() => undefined)
      throw error
    }
    return { directory, dataPath, manifestPath }
  }
}

function validateSessionId(sessionId: string): void {
  if (!/^session-[a-z0-9][a-z0-9._-]{0,127}$/iu.test(sessionId)) throw new Error('Harness returned an unsafe session ID; deletion was refused.')
}

async function assertContainedDirectory(root: string, candidate: string): Promise<void> {
  const [resolvedRoot, resolvedCandidate, candidateStat] = await Promise.all([realpath(root), realpath(candidate), stat(candidate)])
  const relative = path.relative(resolvedRoot, resolvedCandidate)
  if (!candidateStat.isDirectory() || relative === '' || path.isAbsolute(relative) || relative === '..' || relative.startsWith(`..${path.sep}`)) {
    throw new Error('Session data resolved outside the managed Harness home; deletion was refused.')
  }
}

async function exists(value: string): Promise<boolean> {
  try {
    await stat(value)
    return true
  } catch {
    return false
  }
}

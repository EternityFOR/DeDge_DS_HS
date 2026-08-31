import { randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import * as path from 'node:path'

export interface GatewayLease {
  readonly url: string
  readonly pid: number
  readonly version: string
  readonly workspace: string
}

export interface GatewayStartupLock {
  readonly release: () => Promise<void>
}

/** A short-lived VS Code extension-host registration for a shared runtime. */
export interface GatewayClientRegistration {
  readonly pid: number
  readonly nonce: string
  readonly release: () => Promise<void>
}

export function gatewayLeaseMatchesVersion(lease: Pick<GatewayLease, 'version'>, expectedVersion: string): boolean {
  return lease.version === expectedVersion
}

interface GatewayStartupLockRecord {
  readonly pid: number
  readonly nonce: string
}

export function defaultGatewayLeasePath(env: NodeJS.ProcessEnv = process.env, userHome = homedir()): string {
  const dataRoot = env.LOCALAPPDATA?.trim() || path.join(userHome, '.local', 'share')
  return path.join(dataRoot, 'DeDge', 'DeepSeekHarness', 'gateway-lease.json')
}

export async function writeGatewayLease(target: string, lease: GatewayLease): Promise<void> {
  const normalized = normalizeGatewayLease(lease)
  await mkdir(path.dirname(target), { recursive: true })
  const temporary = `${target}.tmp-${process.pid}-${Date.now()}`
  await writeFile(temporary, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8')
  await rm(target, { force: true })
  await rename(temporary, target)
}

export async function readGatewayLease(target: string): Promise<GatewayLease> {
  return normalizeGatewayLease(JSON.parse(await readFile(target, 'utf8')) as unknown)
}

export async function clearGatewayLease(target: string, ownerPid: number): Promise<void> {
  let current: unknown
  try {
    current = JSON.parse(await readFile(target, 'utf8')) as unknown
  } catch {
    return
  }
  if (!isRecord(current) || current.pid !== ownerPid) return
  await rm(target, { force: true })
}

/**
 * Register one extension host as a consumer of the shared Gateway. The marker
 * contains only a process id and random nonce; it never carries workspace data
 * or credentials. Process liveness lets another window clean up a crashed host
 * without requiring a shutdown callback.
 */
export async function registerGatewayClient(leasePath: string, ownerPid = process.pid): Promise<GatewayClientRegistration> {
  const directory = gatewayClientDirectory(leasePath)
  const nonce = randomUUID()
  const target = path.join(directory, `${String(ownerPid)}-${nonce}.json`)
  await mkdir(directory, { recursive: true })
  const temporary = `${target}.tmp-${process.pid}`
  await writeFile(temporary, `${JSON.stringify({ pid: ownerPid, nonce, at: Date.now() })}\n`, 'utf8')
  await rename(temporary, target)
  return {
    pid: ownerPid,
    nonce,
    release: async () => {
      await rm(target, { force: true })
    },
  }
}

/**
 * Return whether another live extension host still consumes the shared
 * runtime. Stale markers are removed opportunistically.
 */
export async function hasLiveGatewayClients(
  leasePath: string,
  excludePid = process.pid,
  processProbe: (pid: number) => boolean = isProcessRunning,
): Promise<boolean> {
  const directory = gatewayClientDirectory(leasePath)
  let entries: string[]
  try {
    entries = await readdir(directory)
  } catch {
    return false
  }
  let live = false
  await Promise.all(entries.map(async name => {
    if (!name.endsWith('.json')) return
    const target = path.join(directory, name)
    let pid: number | undefined
    try {
      const value: unknown = JSON.parse(await readFile(target, 'utf8'))
      if (isRecord(value) && Number.isSafeInteger(value.pid) && Number(value.pid) > 0) pid = Number(value.pid)
    } catch {
      // A partially-written or removed marker is stale by definition.
    }
    if (pid === undefined || !processProbe(pid)) {
      await rm(target, { force: true }).catch(() => undefined)
      return
    }
    if (pid !== excludePid) live = true
  }))
  return live
}

export function gatewayClientDirectory(leasePath: string): string {
  return `${leasePath}.clients`
}

export async function tryAcquireGatewayStartupLock(
  leasePath: string,
  ownerPid = process.pid,
  processProbe: (pid: number) => boolean = isProcessRunning,
): Promise<GatewayStartupLock | undefined> {
  const lockDirectory = `${leasePath}.startup-lock`
  const ownerFile = path.join(lockDirectory, 'owner.json')
  const nonce = randomUUID()
  const record: GatewayStartupLockRecord = { pid: ownerPid, nonce }

  const create = async (): Promise<boolean> => {
    try {
      await mkdir(lockDirectory)
      await writeFile(ownerFile, `${JSON.stringify(record)}\n`, 'utf8')
      return true
    } catch (error) {
      if (isAlreadyExists(error)) return false
      await rm(lockDirectory, { recursive: true, force: true }).catch(() => undefined)
      throw error
    }
  }

  if (!await create()) {
    const current = await readStartupLock(ownerFile)
    if (current !== undefined && processProbe(current.pid)) return undefined
    if (current === undefined && !await isOldIncompleteLock(lockDirectory)) return undefined
    await rm(lockDirectory, { recursive: true, force: true })
    if (!await create()) return undefined
  }

  return {
    release: async () => {
      const current = await readStartupLock(ownerFile)
      if (current?.pid !== ownerPid || current.nonce !== nonce) return
      await rm(lockDirectory, { recursive: true, force: true })
    },
  }
}

export function isProcessRunning(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return isRecord(error) && error.code === 'EPERM'
  }
}

function normalizeGatewayLease(value: unknown): GatewayLease {
  if (!isRecord(value) || !Number.isSafeInteger(value.pid) || Number(value.pid) <= 0 ||
    typeof value.version !== 'string' || value.version.trim() === '' || typeof value.workspace !== 'string') {
    throw new Error('Malformed Harness gateway lease.')
  }
  if (typeof value.url !== 'string') throw new Error('Malformed Harness gateway lease URL.')
  const endpoint = new URL(value.url)
  if (endpoint.protocol !== 'http:' || endpoint.hostname !== '127.0.0.1' || endpoint.port === '') {
    throw new Error('Harness gateway lease must use a numeric 127.0.0.1 HTTP endpoint.')
  }
  endpoint.pathname = '/'
  endpoint.search = ''
  endpoint.hash = ''
  return {
    url: endpoint.toString(),
    pid: Number(value.pid),
    version: value.version,
    workspace: value.workspace,
  }
}

async function readStartupLock(ownerFile: string): Promise<GatewayStartupLockRecord | undefined> {
  try {
    const value: unknown = JSON.parse(await readFile(ownerFile, 'utf8'))
    if (!isRecord(value) || !Number.isSafeInteger(value.pid) || Number(value.pid) <= 0 || typeof value.nonce !== 'string') return undefined
    return { pid: Number(value.pid), nonce: value.nonce }
  } catch {
    return undefined
  }
}

async function isOldIncompleteLock(lockDirectory: string): Promise<boolean> {
  try {
    return Date.now() - (await stat(lockDirectory)).mtimeMs > 10_000
  } catch {
    return true
  }
}

function isAlreadyExists(error: unknown): boolean {
  return isRecord(error) && error.code === 'EEXIST'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

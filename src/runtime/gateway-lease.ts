import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import * as path from 'node:path'

export interface GatewayLease {
  readonly url: string
  readonly pid: number
  readonly version: string
  readonly workspace: string
}

export function defaultGatewayLeasePath(env: NodeJS.ProcessEnv = process.env, userHome = homedir()): string {
  const dataRoot = env.LOCALAPPDATA?.trim() || path.join(userHome, '.local', 'share')
  return path.join(dataRoot, 'DeDge', 'DeepSeekHarness', 'gateway-lease.json')
}

export async function writeGatewayLease(target: string, lease: GatewayLease): Promise<void> {
  const endpoint = new URL(lease.url)
  if (endpoint.protocol !== 'http:' || endpoint.hostname !== '127.0.0.1' || endpoint.port === '') {
    throw new Error('Harness gateway lease must use a numeric 127.0.0.1 HTTP endpoint.')
  }
  endpoint.pathname = '/'
  endpoint.search = ''
  endpoint.hash = ''
  const normalized: GatewayLease = {
    url: endpoint.toString(),
    pid: lease.pid,
    version: lease.version,
    workspace: lease.workspace,
  }
  await mkdir(path.dirname(target), { recursive: true })
  const temporary = `${target}.tmp-${process.pid}-${Date.now()}`
  await writeFile(temporary, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8')
  await rename(temporary, target)
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

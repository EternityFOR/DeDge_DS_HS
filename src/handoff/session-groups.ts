import * as path from 'node:path'
import type { ExternalSessionDescriptor } from './types.js'

export interface ExternalSessionGroup {
  readonly key: string
  readonly label: string
  readonly cwd?: string
  readonly currentWorkspace: boolean
  readonly sessions: readonly ExternalSessionDescriptor[]
}

export function groupExternalSessions(
  sessions: readonly ExternalSessionDescriptor[],
  workspaceFolders: readonly string[],
): ExternalSessionGroup[] {
  const current = new Set(workspaceFolders.map(pathKey))
  const buckets = new Map<string, { cwd?: string; sessions: ExternalSessionDescriptor[] }>()
  for (const session of sessions) {
    const key = session.cwd === undefined ? '<unknown>' : pathKey(session.cwd)
    const bucket = buckets.get(key) ?? { ...(session.cwd === undefined ? {} : { cwd: session.cwd }), sessions: [] }
    bucket.sessions.push(session)
    buckets.set(key, bucket)
  }

  return [...buckets.entries()]
    .map(([key, bucket]) => {
      const sorted = bucket.sessions.sort((left, right) => right.updatedAt - left.updatedAt)
      const currentWorkspace = bucket.cwd !== undefined && current.has(pathKey(bucket.cwd))
      const name = bucket.cwd === undefined ? 'Unknown workspace' : projectName(bucket.cwd)
      return {
        key,
        label: `${currentWorkspace ? 'Current workspace' : 'Project'} - ${name} (${String(sorted.length)})`,
        ...(bucket.cwd === undefined ? {} : { cwd: bucket.cwd }),
        currentWorkspace,
        sessions: sorted,
      }
    })
    .sort((left, right) => {
      if (left.currentWorkspace !== right.currentWorkspace) return left.currentWorkspace ? -1 : 1
      const recent = (right.sessions[0]?.updatedAt ?? 0) - (left.sessions[0]?.updatedAt ?? 0)
      return recent === 0 ? left.label.localeCompare(right.label) : recent
    })
}

function pathKey(value: string): string {
  const normalized = value.trim().replaceAll('\\', '/').replace(/\/+$/u, '')
  return /^[a-z]:\//iu.test(normalized) || process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

function projectName(value: string): string {
  const flavor = /^[a-z]:[\\/]/iu.test(value) || value.includes('\\') ? path.win32 : path.posix
  return flavor.basename(value.replace(/[\\/]+$/u, '')) || value
}

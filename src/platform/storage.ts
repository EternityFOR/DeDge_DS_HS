import { mkdir } from 'node:fs/promises'
import * as path from 'node:path'
import type * as vscode from 'vscode'

export interface StorageLayout {
  readonly root: string
  readonly harnessHomes: string
  readonly runtimeBin: string
  readonly generated: string
  readonly logs: string
  readonly temp: string
  readonly snapshots: string
  readonly handoffs: string
  readonly sessionTrash: string
}

export async function createStorageLayout(context: vscode.ExtensionContext): Promise<StorageLayout> {
  const root = context.globalStorageUri.fsPath
  const layout: StorageLayout = {
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
  await Promise.all(Object.values(layout).map(directory => mkdir(directory, { recursive: true })))
  return layout
}

export function versionedHome(layout: StorageLayout, version: string): string {
  return path.join(layout.harnessHomes, sanitizeSegment(version))
}

function sanitizeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/gu, '_') || 'unknown'
}

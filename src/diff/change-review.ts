import { execFile } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import { promisify } from 'node:util'
import * as vscode from 'vscode'
import type { StorageLayout } from '../platform/storage.js'

const execFileAsync = promisify(execFile)

export class ChangeReviewService {
  constructor(private readonly layout: StorageLayout) {}

  async open(): Promise<void> {
    const cwd = workspaceDirectory()
    if (cwd === undefined) throw new Error('Open a workspace before reviewing changes.')
    const root = (await git(cwd, ['rev-parse', '--show-toplevel'])).trim()
    const entries = parseStatus(await git(root, ['status', '--porcelain=v1', '-z']))
    if (entries.length === 0) {
      void vscode.window.showInformationMessage('No Git working tree changes to review.')
      return
    }
    const picked = await vscode.window.showQuickPick(entries.map(entry => ({ label: entry.path, description: entry.status, entry })), { title: 'Review workspace changes' })
    if (picked !== undefined) await this.openNativeDiff(root, picked.entry)
  }

  private async openNativeDiff(root: string, entry: StatusEntry): Promise<void> {
    const working = vscode.Uri.file(path.join(root, entry.path))
    if (entry.untracked) {
      await vscode.window.showTextDocument(working)
      return
    }
    const baseEntry = entry.originalPath ?? entry.path
    const baseBytes = entry.added ? Buffer.alloc(0) : await gitBuffer(root, ['show', `HEAD:${baseEntry.replaceAll(path.sep, '/')}`])
    const basePath = path.join(this.layout.snapshots, 'git-head', entry.path)
    await mkdir(path.dirname(basePath), { recursive: true })
    await writeFile(basePath, baseBytes)
    let workingUri = working
    if (entry.deleted) {
      const deletedPath = path.join(this.layout.snapshots, 'working-tree', entry.path)
      await mkdir(path.dirname(deletedPath), { recursive: true })
      await writeFile(deletedPath, Buffer.alloc(0))
      workingUri = vscode.Uri.file(deletedPath)
    }
    await vscode.commands.executeCommand('vscode.diff', vscode.Uri.file(basePath), workingUri, `${entry.path} (HEAD -> Working Tree)`, { preview: true })
  }
}

interface StatusEntry {
  readonly status: string
  readonly path: string
  readonly untracked: boolean
  readonly added: boolean
  readonly deleted: boolean
  readonly originalPath?: string
}

export function parseStatus(value: string): StatusEntry[] {
  const records = value.split('\0').filter(Boolean)
  const entries: StatusEntry[] = []
  for (let index = 0; index < records.length; index++) {
    const record = records[index]
    if (record === undefined || record.length < 4) continue
    const status = record.slice(0, 2)
    const file = record.slice(3)
    const originalPath = status.includes('R') || status.includes('C') ? records[index + 1] : undefined
    if (originalPath !== undefined) index++
    entries.push({ status, path: file, untracked: status === '??', added: status.includes('A'), deleted: status.includes('D'), ...(originalPath === undefined ? {} : { originalPath }) })
  }
  return entries
}

function workspaceDirectory(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
}

async function git(cwd: string, args: string[]): Promise<string> {
  try {
    const result = await execFileAsync('git', args, { cwd, windowsHide: true, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
    return result.stdout
  } catch (error) {
    throw new Error(`Git command failed: ${error instanceof Error ? error.message : String(error)}`)
  }
}

async function gitBuffer(cwd: string, args: string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd, windowsHide: true, encoding: 'buffer', maxBuffer: 32 * 1024 * 1024 }, (error, stdout) => {
      if (error !== null) reject(new Error(`Git command failed: ${error.message}`))
      else resolve(Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout))
    })
  })
}

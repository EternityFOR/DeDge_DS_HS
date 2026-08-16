import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { open } from 'node:fs/promises'
import * as path from 'node:path'
import * as vscode from 'vscode'

export interface ContextAttachment {
  readonly id: string
  readonly kind: 'selection' | 'file' | 'diagnostics'
  readonly label: string
  readonly text: string
  readonly uri?: string
  readonly truncated: boolean
}

export class ContextCollector {
  collectSelection(maxBytes: number): ContextAttachment | undefined {
    const editor = vscode.window.activeTextEditor
    if (editor === undefined || editor.selection.isEmpty) return undefined
    const document = editor.document
    const selection = editor.selection
    const selected = document.getText(selection)
    const location = `${relativeLabel(document.uri)}:${selection.start.line + 1}-${selection.end.line + 1}`
    const body = [
      `File: ${relativeLabel(document.uri)}`,
      `Language: ${document.languageId}`,
      `Lines: ${selection.start.line + 1}-${selection.end.line + 1}`,
      '',
      selected,
    ].join('\n')
    const limited = limitUtf8(body, maxBytes)
    return {
      id: `selection:${document.uri.toString()}:${selection.start.line}:${selection.end.line}`,
      kind: 'selection',
      label: location,
      text: limited.text,
      uri: document.uri.toString(),
      truncated: limited.truncated,
    }
  }

  collectDiagnostics(maxBytes: number): ContextAttachment | undefined {
    const uri = vscode.window.activeTextEditor?.document.uri
    if (uri === undefined) return undefined
    const diagnostics = vscode.languages.getDiagnostics(uri).filter(item => item.severity <= vscode.DiagnosticSeverity.Warning)
    if (diagnostics.length === 0) return undefined
    const text = diagnostics.map(item => {
      const severity = item.severity === vscode.DiagnosticSeverity.Error ? 'error' : 'warning'
      return `${severity} L${item.range.start.line + 1}:${item.range.start.character + 1} ${item.message}`
    }).join('\n')
    const limited = limitUtf8(`Diagnostics for ${relativeLabel(uri)}:\n${text}`, maxBytes)
    return {
      id: `diagnostics:${uri.toString()}`,
      kind: 'diagnostics',
      label: `Problems: ${relativeLabel(uri)}`,
      text: limited.text,
      uri: uri.toString(),
      truncated: limited.truncated,
    }
  }

  async pickFile(maxBytes: number): Promise<ContextAttachment | undefined> {
    const files = await vscode.workspace.findFiles('**/*', '**/{node_modules,.git,.tmp,dist,out,coverage}/**', 2_000)
    const picked = await vscode.window.showQuickPick(
      files.map(uri => ({ label: relativeLabel(uri), uri })),
      { title: 'Attach a workspace file', matchOnDescription: true },
    )
    if (picked === undefined) return undefined
    return this.collectUri(picked.uri, maxBytes, picked.label)
  }

  async collectUri(uri: vscode.Uri, maxBytes: number, label = relativeLabel(uri)): Promise<ContextAttachment> {
    const stat = await vscode.workspace.fs.stat(uri)
    if ((stat.type & vscode.FileType.Directory) !== 0) throw new Error('Folders cannot be attached as prompt text.')
    const bytes = uri.scheme === 'file'
      ? await readLocalPrefix(uri.fsPath, Math.min(stat.size, maxBytes + 4))
      : await vscode.workspace.fs.readFile(uri)
    if (looksBinary(bytes)) throw new Error('Binary files cannot be attached as prompt text.')
    const limited = limitUtf8(new TextDecoder('utf-8', { fatal: false }).decode(bytes), maxBytes)
    return {
      id: `file:${uri.toString()}`,
      kind: 'file',
      label,
      text: `File: ${label}\n\n${limited.text}`,
      uri: uri.toString(),
      truncated: limited.truncated || stat.size > bytes.byteLength,
    }
  }

  collectTextFile(name: string, value: string, maxBytes: number): ContextAttachment {
    if (value.includes('\u0000')) throw new Error(`${name} appears to be binary and cannot be attached.`)
    const label = path.basename(name.trim()) || 'pasted-file.txt'
    const limited = limitUtf8(value, maxBytes)
    const digest = createHash('sha256').update(label).update('\u0000').update(value).digest('hex').slice(0, 16)
    return {
      id: `inline-file:${digest}`,
      kind: 'file',
      label,
      text: `File: ${label}\n\n${limited.text}`,
      truncated: limited.truncated,
    }
  }
}

export function buildPrompt(input: string, attachments: readonly ContextAttachment[]): string {
  const blocks = attachments.map(attachment => [
    `<editor_context kind=${JSON.stringify(attachment.kind)} label=${JSON.stringify(attachment.label)}>`,
    attachment.text,
    '</editor_context>',
  ].join('\n'))
  return [...blocks, input.trim()].filter(Boolean).join('\n\n')
}

export function limitUtf8(value: string, maxBytes: number): { text: string; truncated: boolean } {
  const bytes = Buffer.from(value, 'utf8')
  if (bytes.byteLength <= maxBytes) return { text: value, truncated: false }
  let end = maxBytes
  while (end > 0 && (bytes[end] ?? 0) >> 6 === 0b10) end--
  return { text: `${bytes.subarray(0, end).toString('utf8')}\n[truncated]`, truncated: true }
}

function relativeLabel(uri: vscode.Uri): string {
  const folder = vscode.workspace.getWorkspaceFolder(uri)
  return folder === undefined ? path.basename(uri.fsPath) : path.relative(folder.uri.fsPath, uri.fsPath).replaceAll(path.sep, '/')
}

function looksBinary(bytes: Uint8Array): boolean {
  const sample = bytes.subarray(0, Math.min(bytes.length, 8_192))
  return sample.some(byte => byte === 0)
}

async function readLocalPrefix(filePath: string, bytes: number): Promise<Uint8Array> {
  if (bytes <= 0) return new Uint8Array()
  const handle = await open(filePath, 'r')
  try {
    const buffer = Buffer.allocUnsafe(bytes)
    const result = await handle.read(buffer, 0, buffer.byteLength, 0)
    return buffer.subarray(0, result.bytesRead)
  } finally {
    await handle.close()
  }
}

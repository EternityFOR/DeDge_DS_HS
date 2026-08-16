import { constants } from 'node:fs'
import { access, readdir, stat } from 'node:fs/promises'
import * as path from 'node:path'
import * as vscode from 'vscode'
import type { HarnessConfiguration, PermissionMode } from '../config/configuration.js'
import { expandUserPath } from './session-readers.js'
import type { ExternalAgentPlatform, StoredHandoff } from './types.js'

export async function launchHandoffTarget(
  platform: ExternalAgentPlatform,
  stored: StoredHandoff,
  configuration: HarnessConfiguration,
): Promise<void> {
  const executable = await resolveAgentCli(platform, configuration)
  const cwd = stored.value.source.cwd ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd()
  const packageDirectory = stored.directory
  const prompt = [
    `Continue the task from the isolated handoff file: ${stored.markdownPath}`,
    'Read that file first. Treat it as prior context, re-check the workspace, and do not modify source-agent session files.',
  ].join(' ')
  const args = platform === 'codex'
    ? codexArgs(cwd, packageDirectory, prompt, configuration.permissionMode)
    : claudeArgs(packageDirectory, prompt, configuration.permissionMode)
  const terminal = vscode.window.createTerminal({
    name: `${platform === 'codex' ? 'Codex' : 'Claude'} Handoff`,
    cwd,
    shellPath: executable,
    shellArgs: args,
    iconPath: new vscode.ThemeIcon('arrow-swap'),
  })
  terminal.show(false)
}

export async function resolveAgentCli(platform: ExternalAgentPlatform, configuration: HarnessConfiguration): Promise<string> {
  const configured = platform === 'codex' ? configuration.codexCommand : configuration.claudeCommand
  if (configured !== '') {
    const resolved = expandUserPath(configured)
    if (!path.isAbsolute(resolved)) throw new Error(`${platformName(platform)} command must be an absolute path.`)
    if (process.platform === 'win32' && path.extname(resolved).toLowerCase() !== '.exe') {
      throw new Error(`${platformName(platform)} must use a native .exe on Windows so the handoff never depends on PowerShell or cmd.exe.`)
    }
    if (await isExecutable(resolved)) return resolved
    throw new Error(`${platformName(platform)} executable was not found: ${resolved}`)
  }

  const candidates = await automaticCandidates(platform)
  for (const candidate of candidates) {
    if (await isExecutable(candidate)) return candidate
  }
  const setting = platform === 'codex' ? 'dedgeDeepSeekHarness.handoff.codexCommand' : 'dedgeDeepSeekHarness.handoff.claudeCommand'
  throw new Error(`${platformName(platform)} native executable was not found. Configure ${setting} with an absolute path.`)
}

async function automaticCandidates(platform: ExternalAgentPlatform): Promise<string[]> {
  const name = platform === 'codex' ? 'codex' : 'claude'
  const executableName = process.platform === 'win32' ? `${name}.exe` : name
  const output: string[] = []
  const extensionId = platform === 'codex' ? 'openai.chatgpt' : 'anthropic.claude-code'
  const extensionRoot = vscode.extensions.getExtension(extensionId)?.extensionPath
  if (extensionRoot !== undefined) output.push(...await findNamedFiles(extensionRoot, executableName, 6))

  if (platform === 'codex' && process.env.APPDATA !== undefined) {
    output.push(...await findNamedFiles(path.join(process.env.APPDATA, 'npm', 'node_modules', '@openai', 'codex'), executableName, 8))
  }
  const pathEntries = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean)
  output.push(...pathEntries.map(entry => path.join(entry.replace(/^"|"$/gu, ''), executableName)))
  return [...new Set(output)]
}

async function findNamedFiles(root: string, fileName: string, maxDepth: number): Promise<string[]> {
  const output: string[] = []
  const pending: { readonly directory: string; readonly depth: number }[] = [{ directory: root, depth: 0 }]
  while (pending.length > 0 && output.length < 8) {
    const current = pending.pop()
    if (current === undefined) break
    let entries
    try {
      entries = await readdir(current.directory, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      const fullPath = path.join(current.directory, entry.name)
      if (entry.isFile() && entry.name.toLowerCase() === fileName.toLowerCase()) output.push(fullPath)
      else if (entry.isDirectory() && current.depth < maxDepth) pending.push({ directory: fullPath, depth: current.depth + 1 })
    }
  }
  return output
}

async function isExecutable(filePath: string): Promise<boolean> {
  try {
    const value = await stat(filePath)
    if (!value.isFile()) return false
    await access(filePath, process.platform === 'win32' ? constants.F_OK : constants.X_OK)
    return true
  } catch {
    return false
  }
}

function codexArgs(cwd: string, packageDirectory: string, prompt: string, permissionMode: PermissionMode): string[] {
  return [
    '-C', cwd,
    '--add-dir', packageDirectory,
    '-s', permissionMode,
    '-a', permissionMode === 'danger-full-access' ? 'never' : 'on-request',
    prompt,
  ]
}

function claudeArgs(packageDirectory: string, prompt: string, permissionMode: PermissionMode): string[] {
  const mode = permissionMode === 'read-only' ? 'manual' : permissionMode === 'workspace-write' ? 'acceptEdits' : 'bypassPermissions'
  return [
    '--add-dir', packageDirectory,
    '--permission-mode', mode,
    ...(permissionMode === 'danger-full-access' ? ['--dangerously-skip-permissions'] : []),
    prompt,
  ]
}

function platformName(platform: ExternalAgentPlatform): string {
  return platform === 'codex' ? 'Codex' : 'Claude Code'
}

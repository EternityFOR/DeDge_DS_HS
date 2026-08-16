import { execFile } from 'node:child_process'
import { access, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import { promisify } from 'node:util'
import type { Logger } from '../platform/logger.js'
import type { StorageLayout } from '../platform/storage.js'

const execFileAsync = promisify(execFile)
const UTF8_PREAMBLE = '[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); $OutputEncoding=[Text.UTF8Encoding]::new($false); '

export interface WindowsCompatibilityReport {
  readonly executable: string
  readonly version: string
  readonly edition: string
  readonly outputEncoding: string
  readonly languageMode: string
  readonly pathRoundTrip: boolean
  readonly junctions: boolean
  readonly warnings: readonly string[]
}

export async function checkWindowsCompatibility(
  workspace: string,
  layout: StorageLayout,
  logger: Logger,
): Promise<WindowsCompatibilityReport | undefined> {
  if (process.platform !== 'win32') return undefined
  const executable = await resolvePowerShell()
  if (executable === undefined) {
    logger.warn('[windows] PowerShell is unavailable. Harness can start, but PowerShell-backed shell tools will not work.')
    return undefined
  }

  const warnings: string[] = []
  let parsed = { version: 'unknown', edition: 'unknown', outputEncoding: 'unknown', languageMode: 'unknown' }
  try {
    const metadata = await runPowerShell(executable, [
      `${UTF8_PREAMBLE}[pscustomobject]@{version=$PSVersionTable.PSVersion.ToString();edition=$PSVersionTable.PSEdition;encoding=[Console]::OutputEncoding.WebName;language=$ExecutionContext.SessionState.LanguageMode.ToString()}|ConvertTo-Json -Compress`,
    ])
    parsed = parsePowerShellMetadata(metadata.stdout)
  } catch (error) {
    warnings.push(`PowerShell metadata probe failed: ${error instanceof Error ? error.message : String(error)}`)
  }
  const majorVersion = Number(parsed.version.split('.')[0])
  if (Number.isFinite(majorVersion) && majorVersion < 7) {
    warnings.push('PowerShell 7 is not installed; Harness will use the Windows PowerShell 5.1 fallback. Non-ASCII redirected input can be unreliable.')
  }
  if (workspace.length >= 220) warnings.push(`The workspace path is ${workspace.length} characters long; enable Windows long paths and keep tool output below MAX_PATH-sensitive utilities.`)
  if (/[^\x20-\x7e]/u.test(workspace)) warnings.push('The workspace path contains non-ASCII characters; the UTF-8 probe passed, but third-party CLI tools may still use a legacy code page.')

  const probeRoot = path.join(layout.temp, 'windows-compat-probe')
  if (parsed.languageMode !== 'FullLanguage') {
    warnings.push(`PowerShell language mode is ${parsed.languageMode}; some Harness shell commands may be blocked by system policy.`)
  }

  const probeDir = path.join(probeRoot, 'path with spaces - utf8-\u6d4b\u8bd5')
  const probeFile = path.join(probeDir, 'probe.txt')
  const sentinel = 'DeepSeek-Harness-Windows-UTF8-path'
  let pathRoundTrip = false
  let junctions = false
  await rm(probeRoot, { recursive: true, force: true })
  try {
    await mkdir(probeDir, { recursive: true })
    await writeFile(probeFile, sentinel, 'utf8')
    try {
      const roundTrip = await runPowerShell(executable, [
        `${UTF8_PREAMBLE}& { param([string]$p) [IO.File]::ReadAllText($p,[Text.Encoding]::UTF8) }`,
        probeFile,
      ])
      pathRoundTrip = roundTrip.stdout.trim() === sentinel
      if (!pathRoundTrip) warnings.push('PowerShell did not preserve UTF-8 output or a path containing spaces and non-ASCII characters.')
    } catch (error) {
      warnings.push(`PowerShell path probe failed: ${error instanceof Error ? error.message : String(error)}`)
    }

    junctions = await probeJunction(path.join(probeRoot, 'junction-target'), path.join(probeRoot, 'junction-link'))
    if (!junctions) warnings.push('Directory junction creation failed. First-run Harness profile activation may require an administrator-approved policy.')
  } finally {
    await rm(probeRoot, { recursive: true, force: true })
  }

  for (const warning of warnings) logger.warn(`[windows] ${warning}`)
  logger.info(`[windows] PowerShell ${parsed.version} (${parsed.edition}), language=${parsed.languageMode}, encoding=${parsed.outputEncoding}, pathRoundTrip=${String(pathRoundTrip)}, junctions=${String(junctions)}`)
  return { executable, ...parsed, pathRoundTrip, junctions, warnings }
}

export async function resolvePowerShell(): Promise<string | undefined> {
  if (process.platform !== 'win32') return 'pwsh'
  const candidates = [
    process.env.ProgramFiles === undefined ? undefined : path.join(process.env.ProgramFiles, 'PowerShell', '7', 'pwsh.exe'),
    ...await where('pwsh.exe'),
    process.env.SystemRoot === undefined ? undefined : path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
  ].filter((value): value is string => value !== undefined)
  for (const candidate of unique(candidates)) {
    try {
      await access(candidate)
      return candidate
    } catch {
      // Continue to the next candidate.
    }
  }
  return undefined
}

export function describeWindowsExitCode(code: number | null): string | undefined {
  if (code === null) return undefined
  const unsigned = code >>> 0
  if (unsigned === 0xc0000142) return 'Windows DLL initialization failed (0xC0000142). Endpoint protection or restricted-token policy may have blocked the process.'
  if (unsigned === 0xe0434352) return 'A .NET/PowerShell process failed during startup (0xE0434352), commonly under an incompatible restricted token.'
  return undefined
}

async function runPowerShell(executable: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  try {
    const result = await execFileAsync(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', ...args], {
      windowsHide: true,
      timeout: 15_000,
      encoding: 'utf8',
      maxBuffer: 2 * 1024 * 1024,
      env: { ...process.env, NO_COLOR: '1', PAGER: 'cat', GIT_PAGER: 'cat' },
    })
    return { stdout: result.stdout, stderr: result.stderr }
  } catch (error) {
    throw new Error(`PowerShell compatibility probe failed: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function parsePowerShellMetadata(value: string): { version: string; edition: string; outputEncoding: string; languageMode: string } {
  try {
    const parsed = JSON.parse(value.trim()) as { version?: unknown; edition?: unknown; encoding?: unknown; language?: unknown }
    if (typeof parsed.version !== 'string') throw new Error('missing version')
    return {
      version: parsed.version,
      edition: typeof parsed.edition === 'string' ? parsed.edition : 'unknown',
      outputEncoding: typeof parsed.encoding === 'string' ? parsed.encoding : 'unknown',
      languageMode: typeof parsed.language === 'string' ? parsed.language : 'unknown',
    }
  } catch (error) {
    throw new Error(`Cannot parse PowerShell probe output: ${error instanceof Error ? error.message : String(error)}`)
  }
}

async function probeJunction(target: string, link: string): Promise<boolean> {
  try {
    await Promise.all([mkdir(target, { recursive: true }), rm(link, { recursive: true, force: true })])
    const sentinel = 'junction-ok'
    await writeFile(path.join(target, 'probe.txt'), sentinel, 'utf8')
    await symlink(target, link, 'junction')
    const linked = await readFile(path.join(link, 'probe.txt'), 'utf8')
    await rm(link, { recursive: true, force: true })
    return linked === sentinel
  } catch {
    return false
  }
}

async function where(command: string): Promise<string[]> {
  try {
    const result = await execFileAsync('where.exe', [command], { windowsHide: true, timeout: 5_000, encoding: 'utf8' })
    return result.stdout.split(/\r?\n/u).map(value => value.trim().replace(/^"|"$/gu, '')).filter(Boolean)
  } catch {
    return []
  }
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.map(value => path.resolve(value)))]
}

import { execFile } from 'node:child_process'
import { constants as fsConstants } from 'node:fs'
import { access, chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import { promisify } from 'node:util'
import type * as vscode from 'vscode'
import type { HarnessConfiguration } from '../config/configuration.js'
import type { Logger } from '../platform/logger.js'
import type { StorageLayout } from '../platform/storage.js'
import type { RuntimeLaunch } from './types.js'

const execFileAsync = promisify(execFile)
export const EXPECTED_DSH_VERSION = '0.1.1-rc.1'

export class RuntimeResolver {
  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly layout: StorageLayout,
    private readonly logger: Logger,
  ) {}

  async resolve(configuration: HarnessConfiguration): Promise<RuntimeLaunch> {
    return configuration.runtimeMode === 'bundled'
      ? this.resolveBundled()
      : this.resolveExternal(configuration)
  }

  private async resolveBundled(): Promise<RuntimeLaunch> {
    const runtimeModules = path.join('dist', 'runtime', 'node_modules')
    const entry = this.context.asAbsolutePath(path.join(runtimeModules, '@deepseek-ai', 'dsh', 'lib', 'bin.js'))
    const manifestPath = this.context.asAbsolutePath(path.join(runtimeModules, '@deepseek-ai', 'dsh', 'package.json'))
    const node = this.context.asAbsolutePath(path.join(
      runtimeModules,
      'node',
      'bin',
      process.platform === 'win32' ? 'node.exe' : 'node',
    ))
    const pnpm = this.context.asAbsolutePath(path.join(runtimeModules, 'pnpm', 'bin', 'pnpm.mjs'))

    await Promise.all([
      requireAccess(entry, fsConstants.R_OK, 'DeepSeek Harness entry'),
      requireAccess(manifestPath, fsConstants.R_OK, 'DeepSeek Harness manifest'),
      requireAccess(node, fsConstants.R_OK, 'bundled Node executable'),
      requireAccess(pnpm, fsConstants.R_OK, 'bundled pnpm entry'),
    ])

    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as { version?: unknown }
    const version = typeof manifest.version === 'string' ? manifest.version : 'unknown'
    if (!supportsHarnessVersion(EXPECTED_DSH_VERSION, version)) {
      throw new Error(`Bundled Harness version mismatch: expected ${EXPECTED_DSH_VERSION}, found ${version}. Reinstall this platform VSIX.`)
    }
    if (version !== EXPECTED_DSH_VERSION) this.logger.warn(`Using compatible bundled Harness ${version}; extension was built against ${EXPECTED_DSH_VERSION}.`)
    const nodeVersion = await executableVersion(node)
    if (!supportsHarnessNode(nodeVersion)) {
      throw new Error(`Bundled Node ${nodeVersion.raw} is incompatible with Harness; Node 22.19+ or 24+ is required.`)
    }

    const tooling = await this.preparePnpmWrapper(node, pnpm)
    this.logger.info(`Resolved bundled runtime ${version} with Node ${nodeVersion.raw}`)
    return {
      command: node,
      args: [entry],
      environment: {
        ...process.env,
        PATH: [tooling, path.dirname(node), process.env.PATH].filter(Boolean).join(path.delimiter),
        DSH_BUNDLED_NODE: node,
        DSH_BUNDLED_PNPM: pnpm,
      },
      version,
      source: 'bundled',
      diagnostics: [`dsh=${entry}`, `node=${node}`, `pnpm=${pnpm}`, `nodeVersion=${nodeVersion.raw}`],
    }
  }

  private async resolveExternal(configuration: HarnessConfiguration): Promise<RuntimeLaunch> {
    const command = configuration.runtimeCommand
    if (command === '') {
      throw new Error('runtime.mode is external, but runtime.command is empty. Configure an absolute executable path.')
    }
    if (!path.isAbsolute(command)) {
      throw new Error('The external runtime command must be an absolute path. PATH discovery is intentionally disabled.')
    }
    await requireAccess(command, fsConstants.R_OK, 'external Harness command')

    const nodePath = configuration.runtimeNodePath
    const launchesScript = command.endsWith('.js') || command.endsWith('.mjs') || command.endsWith('.cjs')
    if (launchesScript && nodePath === '') {
      throw new Error('An external JavaScript runtime requires runtime.nodePath to be an absolute Node executable.')
    }
    const executable = launchesScript ? nodePath : command
    if (!path.isAbsolute(executable)) throw new Error('runtime.nodePath must be an absolute path.')
    await requireAccess(executable, fsConstants.R_OK, 'external runtime executable')
    if (launchesScript) {
      const nodeVersion = await executableVersion(executable)
      if (!supportsHarnessNode(nodeVersion)) {
        throw new Error(`External Node ${nodeVersion.raw} is incompatible with Harness; Node 22.19+ or 24+ is required.`)
      }
    }

    const versionResult = await execFileAsync(executable, [...(launchesScript ? [command] : []), '--version'], {
      windowsHide: true,
      timeout: 15_000,
      encoding: 'utf8',
    }).catch(error => {
      throw new Error(`External Harness version probe failed: ${error instanceof Error ? error.message : String(error)}`)
    })
    const version = versionResult.stdout.trim().replace(/^v/u, '')
    if (!supportsHarnessVersion(EXPECTED_DSH_VERSION, version)) {
      throw new Error(`External Harness ${version || 'unknown'} is unsupported. Configure the pinned ${EXPECTED_DSH_VERSION} runtime.`)
    }
    if (version !== EXPECTED_DSH_VERSION) this.logger.warn(`Using compatible external Harness ${version}; extension was built against ${EXPECTED_DSH_VERSION}.`)
    return {
      command: executable,
      args: launchesScript ? [command] : [],
      environment: { ...process.env },
      version,
      source: 'external',
      diagnostics: [`command=${executable}`, ...(launchesScript ? [`script=${command}`] : [])],
    }
  }

  private async preparePnpmWrapper(node: string, pnpm: string): Promise<string> {
    await mkdir(this.layout.runtimeBin, { recursive: true })
    const target = path.join(this.layout.runtimeBin, process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm')
    const content = process.platform === 'win32'
      ? '@echo off\r\n"%DSH_BUNDLED_NODE%" "%DSH_BUNDLED_PNPM%" %*\r\n'
      : '#!/bin/sh\nexec "$DSH_BUNDLED_NODE" "$DSH_BUNDLED_PNPM" "$@"\n'
    const temporary = `${target}.tmp-${process.pid}`
    await writeFile(temporary, content, 'utf8')
    if (process.platform !== 'win32') await chmod(temporary, 0o755)
    await rm(target, { force: true })
    await rename(temporary, target)
    this.logger.info(`Prepared bundled pnpm wrapper for Node ${node} and ${pnpm}`)
    return this.layout.runtimeBin
  }
}

interface ParsedNodeVersion {
  readonly major: number
  readonly minor: number
  readonly patch: number
  readonly raw: string
}

export function parseNodeVersion(raw: string): ParsedNodeVersion {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/u.exec(raw.trim())
  if (match === null) throw new Error(`Cannot parse Node version: ${raw.trim() || '<empty>'}`)
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]), raw: raw.trim() }
}

export function supportsHarnessNode(version: Pick<ParsedNodeVersion, 'major' | 'minor'>): boolean {
  return version.major >= 24 || (version.major === 22 && version.minor >= 19)
}

export function supportsHarnessVersion(expected: string, actual: string): boolean {
  if (actual === expected) return true
  const expectedRc = /^(\d+\.\d+\.\d+)-rc\.\d+$/u.exec(expected)
  const actualRc = /^(\d+\.\d+\.\d+)-rc\.\d+$/u.exec(actual)
  return expectedRc !== null && actualRc !== null && expectedRc[1] === actualRc[1]
}

async function executableVersion(command: string): Promise<ParsedNodeVersion> {
  try {
    const result = await execFileAsync(command, ['--version'], { windowsHide: true, timeout: 15_000, encoding: 'utf8' })
    return parseNodeVersion(result.stdout)
  } catch (error) {
    throw new Error(`Bundled Node cannot run on ${process.platform}-${process.arch}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

async function requireAccess(file: string, mode: number, label: string): Promise<void> {
  try {
    await access(file, mode)
  } catch {
    throw new Error(`The ${label} is missing or inaccessible: ${file}. Install the VSIX matching ${process.platform}-${process.arch}.`)
  }
}

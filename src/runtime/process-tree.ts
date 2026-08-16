import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import * as path from 'node:path'

const STOP_GRACE_MS = 5_000

export async function terminateProcessTree(child: ChildProcess, graceMs = STOP_GRACE_MS): Promise<void> {
  if (child.exitCode !== null || child.pid === undefined) return
  const exited = new Promise<void>(resolve => child.once('exit', () => resolve()))

  if (process.platform === 'win32') {
    await run(windowsSystemExecutable('taskkill.exe'), ['/pid', String(child.pid), '/T', '/F']).catch(() => {
      child.kill()
    })
    const stopped = await Promise.race([exited.then(() => true), delay(graceMs).then(() => false)])
    if (!stopped && child.exitCode === null) {
      child.kill()
      await Promise.race([exited, delay(1_000)])
    }
    return
  }

  signalGroup(child, 'SIGTERM')
  const stopped = await Promise.race([exited.then(() => true), delay(graceMs).then(() => false)])
  if (!stopped && child.exitCode === null) {
    signalGroup(child, 'SIGKILL')
    await Promise.race([exited, delay(1_000)])
  }
}

function windowsSystemExecutable(name: string): string {
  return process.env.SystemRoot === undefined ? name : path.join(process.env.SystemRoot, 'System32', name)
}

function signalGroup(child: ChildProcess, signal: NodeJS.Signals): void {
  if (child.pid === undefined) return
  try {
    process.kill(-child.pid, signal)
  } catch {
    child.kill(signal)
  }
}

function run(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { shell: false, stdio: 'ignore', windowsHide: true })
    child.once('error', reject)
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(`${command} exited with ${String(code)}`)))
  })
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

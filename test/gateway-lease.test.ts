import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { clearGatewayLease, defaultGatewayLeasePath, writeGatewayLease } from '../src/runtime/gateway-lease.js'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
})

describe('Harness gateway lease', () => {
  it('uses the per-user local application data directory', () => {
    expect(defaultGatewayLeasePath({ LOCALAPPDATA: 'C:\\Users\\test\\AppData\\Local' }, 'C:\\Users\\test'))
      .toBe(path.join('C:\\Users\\test\\AppData\\Local', 'DeDge', 'DeepSeekHarness', 'gateway-lease.json'))
  })

  it('writes a normalized loopback lease and only clears the owning process', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'dedge-dsh-lease-'))
    temporaryDirectories.push(directory)
    const target = path.join(directory, 'gateway-lease.json')
    await writeGatewayLease(target, {
      url: 'http://127.0.0.1:3210',
      pid: 42,
      version: '0.1.0-rc.6',
      workspace: 'D:\\work',
    })
    await expect(readFile(target, 'utf8').then(value => JSON.parse(value))).resolves.toEqual({
      url: 'http://127.0.0.1:3210/',
      pid: 42,
      version: '0.1.0-rc.6',
      workspace: 'D:\\work',
    })
    await clearGatewayLease(target, 99)
    await expect(readFile(target, 'utf8')).resolves.toContain('"pid": 42')
    await clearGatewayLease(target, 42)
    await expect(readFile(target, 'utf8')).rejects.toThrow()
  })

  it('rejects a non-loopback endpoint', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'dedge-dsh-lease-'))
    temporaryDirectories.push(directory)
    await expect(writeGatewayLease(path.join(directory, 'lease.json'), {
      url: 'http://192.168.50.45:3210',
      pid: 42,
      version: '0.1.0-rc.6',
      workspace: 'D:\\work',
    })).rejects.toThrow('127.0.0.1')
  })
})

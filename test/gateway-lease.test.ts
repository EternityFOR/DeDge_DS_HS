import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  clearGatewayLease,
  defaultGatewayLeasePath,
  hasLiveGatewayClients,
  registerGatewayClient,
  readGatewayLease,
  tryAcquireGatewayStartupLock,
  writeGatewayLease,
  gatewayLeaseMatchesVersion,
} from '../src/runtime/gateway-lease.js'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
})

describe('Harness gateway lease', () => {
  it('requires an exact bundled runtime version before attaching', () => {
    expect(gatewayLeaseMatchesVersion({ version: '0.1.2-alpha.3' }, '0.1.2-alpha.3')).toBe(true)
    expect(gatewayLeaseMatchesVersion({ version: '0.1.1-rc.2' }, '0.1.2-alpha.3')).toBe(false)
  })
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

  it('reads and validates a normalized gateway lease', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'dedge-dsh-lease-'))
    temporaryDirectories.push(directory)
    const target = path.join(directory, 'gateway-lease.json')
    await writeGatewayLease(target, {
      url: 'http://127.0.0.1:4321/api/ignored?value=1',
      pid: 77,
      version: '0.1.0-rc.6',
      workspace: 'D:\\work',
    })
    await expect(readGatewayLease(target)).resolves.toEqual({
      url: 'http://127.0.0.1:4321/',
      pid: 77,
      version: '0.1.0-rc.6',
      workspace: 'D:\\work',
    })
    await writeGatewayLease(target, {
      url: 'http://127.0.0.1:4322',
      pid: 78,
      version: '0.1.0-rc.6',
      workspace: 'D:\\other',
    })
    await expect(readGatewayLease(target)).resolves.toMatchObject({ url: 'http://127.0.0.1:4322/', pid: 78 })
    await writeGatewayLease(target, {
      url: 'http://127.0.0.1:4323/?token=launch-token&ignored=value',
      pid: 79,
      version: '0.1.2-alpha.3',
      workspace: 'D:\\other',
    })
    await expect(readGatewayLease(target)).resolves.toMatchObject({ url: 'http://127.0.0.1:4323/?token=launch-token', pid: 79 })
  })

  it('serializes startup across VS Code extension hosts and recovers a stale owner', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'dedge-dsh-lease-'))
    temporaryDirectories.push(directory)
    const target = path.join(directory, 'gateway-lease.json')
    const first = await tryAcquireGatewayStartupLock(target, 101, () => false)
    expect(first).toBeDefined()
    await expect(tryAcquireGatewayStartupLock(target, 202, pid => pid === 101)).resolves.toBeUndefined()

    const replacement = await tryAcquireGatewayStartupLock(target, 202, () => false)
    expect(replacement).toBeDefined()
    await first?.release()
    await expect(tryAcquireGatewayStartupLock(target, 303, pid => pid === 202)).resolves.toBeUndefined()
    await replacement?.release()
    await expect(tryAcquireGatewayStartupLock(target, 303, () => false)).resolves.toBeDefined()
  })

  it('keeps a shared runtime alive while another extension host is registered', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'dedge-dsh-lease-'))
    temporaryDirectories.push(directory)
    const target = path.join(directory, 'gateway-lease.json')
    const first = await registerGatewayClient(target, 101)
    const second = await registerGatewayClient(target, 202)

    await expect(hasLiveGatewayClients(target, 101, pid => pid === 101 || pid === 202)).resolves.toBe(true)
    await first.release()
    await expect(hasLiveGatewayClients(target, 999, pid => pid === 202)).resolves.toBe(true)
    await second.release()
    await expect(hasLiveGatewayClients(target, 999, pid => pid === 202)).resolves.toBe(false)
  })

  it('removes registrations for extension hosts that no longer exist', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'dedge-dsh-lease-'))
    temporaryDirectories.push(directory)
    const target = path.join(directory, 'gateway-lease.json')
    const stale = await registerGatewayClient(target, 303)

    await expect(hasLiveGatewayClients(target, 999, () => false)).resolves.toBe(false)
    await stale.release()
  })
})

import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { RuntimeManager } from '../src/runtime/runtime-manager.js'
import { BUNDLED_RUNTIME_REVISION, writeGatewayLease } from '../src/runtime/gateway-lease.js'

vi.mock('vscode', () => ({ EventEmitter: class {
  event = () => ({ dispose() {} })
  fire() {}
  dispose() {}
} }))

describe('shared Host patch compatibility', () => {
  it('refuses a live unpatched same-version Host, leaves it alive, and accepts the matching patch', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'dedge-runtime-revision-'))
    const server = createServer((_request, response) => { response.end('Synthetic Host') })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Synthetic Host failed to bind')
    const target = path.join(directory, 'lease.json')
    const lease = { url: 'http://127.0.0.1:' + address.port + '/', pid: process.pid, version: '0.2.1-alpha.4', workspace: directory }
    let runtimeMode = 'bundled'
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    type Args = ConstructorParameters<typeof RuntimeManager>
    const manager = new RuntimeManager({ get: () => ({ runtimeMode }) } as unknown as Args[0], {} as Args[1], {} as Args[2], {} as Args[3], logger as unknown as Args[4])
    Object.assign(manager, { primaryGatewayLease: target, unscopedRuntimeLease: path.join(directory, 'missing-a'), legacyGatewayLease: path.join(directory, 'missing-b'), currentWorkspace: directory })
    const internal = manager as unknown as { readLiveGatewayLease(): Promise<unknown>; waitForSharedRuntimeOrLock(ms: number): Promise<unknown> }
    try {
      await writeGatewayLease(target, lease)
      await expect(internal.readLiveGatewayLease()).rejects.toThrow('no duplicate Host was started')
      expect(manager.state.phase).toBe('error')
      expect(server.listening).toBe(true)
      expect(process.kill(process.pid, 0)).toBe(true)
      await writeGatewayLease(target, { ...lease, runtimeRevision: BUNDLED_RUNTIME_REVISION })
      await expect(internal.readLiveGatewayLease()).resolves.toMatchObject({ runtimeRevision: BUNDLED_RUNTIME_REVISION })
      await expect(internal.waitForSharedRuntimeOrLock(1000)).resolves.toHaveProperty('lease')
      runtimeMode = 'external'
      await writeGatewayLease(target, lease)
      await expect(internal.readLiveGatewayLease()).resolves.toMatchObject(lease)
    } finally {
      server.closeAllConnections()
      await new Promise<void>(resolve => server.close(() => resolve()))
      await rm(directory, { recursive: true, force: true })
    }
  })
})

import { describe, expect, it } from 'vitest'
import {
  patchPermissionSandboxTerminalCloseSource,
  patchPersistentShellCacheRecoverySource,
  patchScheduleCancelCommandAlpha2Source,
  patchScheduleCancelCommandRc1Source,
} from '../scripts/runtime-patches.mjs'

const RC1_SHAPE = [
  'const inject = [',
  '\t"agents",',
  '\t"sessions",',
  '\t"tools",',
  '\t"sessionPersistence"',
  '];',
  'function apply(ctx) {',
  '\tctx.inject(["sessionProjections"], (projectionCtx) => {',
  '\t\tprojectionCtx.sessionProjections.register(scheduleProjectionDefinition);',
  '\t});',
  '}',
].join('\n')

describe('bundled runtime source patches', () => {
  it('adds the schedule-cancel command to the 0.1.5-rc.1 plugin shape', () => {
    const patched = patchScheduleCancelCommandRc1Source(RC1_SHAPE)
    expect(patched).toContain('"commands",')
    expect(patched).toContain('name: "schedule-cancel"')
    expect(patched).toContain('runScheduleTransaction(invocation.agent')
    expect(patched.match(/name: "schedule-cancel"/gu)).toHaveLength(1)
  })

  it('adds the schedule-cancel command to the alpha.2 plugin shape', () => {
    const source = RC1_SHAPE.replace(
      '  "agents",',
      '  "agents",',
    ).replaceAll('\t\t', '\t\t')
    const patched = patchScheduleCancelCommandAlpha2Source(source)
    expect(patched).toContain('"commands",')
    expect(patched).toContain('name: "schedule-cancel"')
  })

  it('closes owner persistent terminals before switching the sandbox mode', () => {
    const source = [
      'ctx.inject(["commands"], (commandCtx) => {',
      '  commandCtx.commands.register({',
      '    name: "permission",',
      '    handler: ({ agent, rawInput }) => {',
      '      const name = rawInput.trim();',
      '      if (!this.names.includes(name)) return {};',
      '      this.apply(agent.session, name, (policy) => {});',
      '    }',
      '  });',
      '});',
    ].join('\n')
    const patched = patchPermissionSandboxTerminalCloseSource(source)
    expect(patched).toContain('handler: async ({ agent, rawInput }) => {')
    expect(patched).toContain('await terminals.abortAndClose(agent')
    expect(patched).toContain('this.apply(agent.session, name, (policy) => {')
  })

  it('drops a stale persistent shell cache entry after the PTY is closed', () => {
    const source = [
      'function persistentShells(ctx, config) {',
      '  const pending = new WeakMap();',
      '  const live = new Map();',
      '  const get = (owner, signal) => {',
      '    const existing = pending.get(owner);',
      '    return existing;',
      '  };',
      '  return { get };',
      '}',
    ].join('\n')
    const patched = patchPersistentShellCacheRecoverySource(source, 'pwsh')
    expect(patched).toContain('const liveId = live.get(owner);')
    expect(patched).toContain('live.delete(owner);')
    expect(patched).toContain('const existing = pending.get(owner);')
  })
  it('refuses unknown compiled plugin shapes instead of emitting a half patch', () => {
    expect(() => patchScheduleCancelCommandRc1Source('export const unrelated = true\n')).toThrow('Unexpected 0.1.5-rc.1')
    expect(() => patchScheduleCancelCommandAlpha2Source('export const unrelated = true\n')).toThrow('Unexpected alpha.2')
  })
})
# DeDge DeepSeek Harness 0.1.96

Updates the bundled official runtime from `0.2.0-rc.2` to `0.2.1-alpha.4`. This is an explicitly pinned upstream pre-release, not an automatic update channel. Node remains `22.22.3`; pnpm remains `11.21.0`.

## Changes

- Use the built-in Host Schedule service and preset-owned schedule tools without mounting a second service. The schedule setting still disables the Host service and its model tools.
- Keep guarded local credential filtering, idle approval-policy handling, permission-switch terminal cleanup and persistent-shell recovery patches.
- Clearly report a normally completed model response that contains only reasoning and no answer. The received content stays in Reasoning; the extension does not invent an answer, guess a FINAL delimiter or resend automatically.
- Native and custom-provider routing, attachments, queues, foreground steering, approvals and local Orbit leases retain their existing contracts.
- Official alpha.4 inspector/SDK payloads increase the Windows package size. Keep full dependencies under a bounded 100 MiB compressed / 288 MiB unpacked ceiling; all other package safety and license checks remain enabled.

## Upgrade boundaries

Install the matching platform VSIX and reload VS Code when current tasks have finished. This workflow does not automatically install, restart VS Code, terminate old Hosts, change permissions or deploy NAS services.

The new runtime uses its own versioned home and lease. Missing sessions, storages and attachments are recovered without overwriting existing target data or copying credentials. Different alpha builds are not assumed protocol-compatible. Existing Orbit lease discovery scans versioned workspace leases; a Bridge reconnect may be needed to discover the new Host after the user reloads VS Code.

The upstream idle-stream and session-continuation fixes are included, but this does not guarantee the model will never emit reasoning-only responses. That separate case now has an explicit diagnostic.

## Verification

- 199 Vitest tests, type checking, production build, dependency peer check, documentation audit and release-content audit passed.
- Both the staged runtime and the extracted final win32-x64 VSIX passed the isolated mock-model smoke. Final packaged steering latency was queue=69 ms / direct=66 ms, retaining the other ten queued messages.
- Ten package files, including compiled UI/extension/steering and the five guarded upstream patches, matched the tested build byte for byte.
- Synthetic 240/320/420 px sidebar checks covered the settled diagnostic, long reasoning expansion, folding and repeated toggling without page errors or horizontal overflow. Real VS Code installation and real-provider inference were intentionally not performed.
- Final VSIX: 12,797 files, 93.5 MiB compressed / 279.8 MiB unpacked. SHA-256: `C1754288B42E113B6EF177D65BBCDE8F089DE4BD3E2A5A9FF3A97914FEE9F8D5`.
- No paid inference, private session, running application, NAS service or live trading workspace was used for verification.

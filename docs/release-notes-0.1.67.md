# DeDge DeepSeek Harness v0.1.67

## Changed

- Queue delivery remains available while a Goal continuation or background task is active, matching the Codex-style inbox workflow; Steer keeps its running-turn guard.
- Autonomous status and cancellation now distinguish Goal continuations from background jobs, with a real Pause path for the current session's work.

## Fixed

- Pause invokes the official `/goal pause` command before cancelling and removing autonomous queue items, preventing a paused Goal from immediately rearming itself.
- The packaged runtime adds a session-scoped `/stop-jobs` command for background jobs started by the current Agent. Other sessions and unowned jobs are never targeted.
- Successfully removed autonomous queue items are reflected locally immediately, so stale queue state cannot keep the composer disabled while Gateway events catch up.

## Compatibility

- Bundled DeepSeek Harness: 0.1.2-alpha.3
- Node.js: 22.22.3
- pnpm: 11.21.0
- Verified target: Windows x64 (`win32-x64`)

## Verification

- 130 Vitest tests
- TypeScript typecheck and production build
- Authenticated alpha.3 runtime smoke, including `/stop-jobs`
- Runtime, documentation, privacy, and VSIX audits

## Release Asset

| Asset | Target | Size | SHA-256 |
| --- | --- | ---: | --- |
| `dedge-deepseek-harness-vscode-0.1.67-win32-x64.vsix` | `win32-x64` | `76,051,899 bytes (72.53 MiB)` | `73619E3EE10B36A412CC69261463C35DE58B5EEAC8D54C81632C8FCD4CB65854` |

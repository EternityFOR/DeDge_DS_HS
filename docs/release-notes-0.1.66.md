# DeDge DeepSeek Harness v0.1.66

## Changed

- Agent Preset changes are locked after the first prompt, matching the official Harness session boundary. The extension no longer attempts a hot switch or creates an automatic handoff session.
- Model and reasoning selection remains available while a response or autonomous continuation is active. The official Harness selection applies to the next request.

## Fixed

- Session-owned Agent Preset projections are restored from session-list projections, history, live projection frames, and preset events. Returning from another session no longer makes the original session appear to use the wrong mode.
- Autonomous wait status identifies queued goal continuations and running background jobs instead of showing a generic preparation message.

## Compatibility

- Bundled DeepSeek Harness: 0.1.2-alpha.3
- Node.js: 22.22.3
- pnpm: 11.21.0
- Verified target: Windows x64 (`win32-x64`)

## Verification

- 130 Vitest tests
- TypeScript typecheck and production build
- Authenticated alpha.3 runtime smoke
- Runtime and package privacy audits
- Windows x64 VSIX audit

## Release Asset

| Asset | Target | Size | SHA-256 |
| --- | --- | ---: | --- |
| `dedge-deepseek-harness-vscode-0.1.66-win32-x64.vsix` | `win32-x64` | `76,050,953 bytes (72.53 MiB)` | `BCADBE64BEB927E8FE8E040257F2BF08824434B814145FD429AB01F61B36D90B` |

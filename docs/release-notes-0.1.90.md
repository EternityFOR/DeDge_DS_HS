# DeDge DeepSeek Harness v0.1.90

## Fixed

- Changing to a preset that changes the approval policy while the agent is idle no longer leaves an unconsumed plugin notice in the inbox. Previously this surfaced as a permanent "Autonomous continuation is queued" status, disabled the permission menu, and only a window restart recovered the session.
- The live approval-switch notice is now injected only during an active turn. An idle agent receives the changed policy through the system-prompt context on its next request instead.
- Focusing a VS Code window now reconciles the session list, archived-session registry, active conversation history, permission projection, and schedule projection. This heals tabs and conversation state after a deletion in another window or a missed event frame.

## Compatibility

- Bundled DeepSeek Harness: `0.1.5-rc.1`
- Node.js: `22.22.3`
- pnpm: `11.21.0`
- Verified target: Windows x64 (`win32-x64`)

## Verification

- TypeScript typecheck
- Vitest regression suite
- Production build
- Documentation, privacy, and VSIX audits

## Release Asset

| Asset | Target | Size | SHA-256 |
| --- | --- | ---: | --- |
| `dedge-deepseek-harness-vscode-0.1.90-win32-x64.vsix` | `win32-x64` | `73,408,857 bytes (70.01 MiB)` | `278AEE333C782D0A13ED6524E8D8B45A452635A32D0AF636AC78760A8A34AD0C` |

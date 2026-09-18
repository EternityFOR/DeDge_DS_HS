# DeDge DeepSeek Harness v0.1.89

## Fixed

- Changing the permission preset no longer fails with `cannot change sandbox mode from "workspace-write" to "danger-full-access" while persistent terminal sessions are open or being created`. The runtime bridge closes the target session's persistent pwsh/bash PTY sessions before appending the sandbox-mode event.
- Persistent shell tools now detect a terminal session that was closed by that permission switch and start a fresh shell on the next pwsh/bash call instead of failing once on a stale terminal id.
- Added regression coverage for the permission and shell-cache runtime patches.

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
| `dedge-deepseek-harness-vscode-0.1.89-win32-x64.vsix` | `win32-x64` | `73,408,239 bytes (70.01 MiB)` | `B3A9BD470D398DF7A5B83EA0FF1C40167D42255D19727468E0ADC703968817F7` |

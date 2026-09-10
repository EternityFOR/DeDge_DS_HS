# DeDge DeepSeek Harness v0.1.80

## Changed

- Bundled official DeepSeek Harness upgraded to `0.1.5-rc.1`.
- Added the upstream stable `deepseek-flash` / `DeepSeek-V41-Flash` native text-and-image route.
- Retained the extension's duplicate-send protection, chronological task rendering, and Windows lease compatibility.

## Fixed

- Uses the upstream RC's queue/Steer send-state, reconnect recovery, and long-session continuation fixes.
- Keeps reasoning and command/tool rows aligned in task folds.

## Compatibility

- Bundled DeepSeek Harness: `0.1.5-rc.1`
- Node.js: `22.22.3`
- pnpm: `11.21.0`
- Verified target: Windows x64 (`win32-x64`)

## Verification

- TypeScript typecheck
- Vitest test suite (140 tests)
- Production build
- Authenticated RC.1 runtime smoke
- Documentation, privacy, and VSIX audits

## Release Asset

| Asset | Target | Size | SHA-256 |
| --- | --- | ---: | --- |
| `dedge-deepseek-harness-vscode-0.1.80-win32-x64.vsix` | `win32-x64` | `73,402,290 bytes (70.00 MiB)` | `ED79502EB29FBD097E508071389DEF1B498D714741268A9B07A95DB5D58C84D9` |

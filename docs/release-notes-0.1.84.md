# DeDge DeepSeek Harness v0.1.84

## Fixed

- Empty Codex and Claude Code sessions are now rejected before handoff with a normal warning instead of a red command error.
- Empty current Harness sessions use the same guard, so no empty handoff draft or target session is created.
- Added regression coverage for whitespace-only and empty handoff sources.

## Compatibility

- Bundled DeepSeek Harness: `0.1.5-rc.1`
- Node.js: `22.22.3`
- pnpm: `11.21.0`
- Verified target: Windows x64 (`win32-x64`)

## Verification

- TypeScript typecheck
- Vitest test suite
- Production build
- Authenticated RC.1 runtime smoke
- Documentation, privacy, and VSIX audits

## Release Asset

| Asset | Target | Size | SHA-256 |
| --- | --- | ---: | --- |
| `dedge-deepseek-harness-vscode-0.1.84-win32-x64.vsix` | `win32-x64` | `73,404,564 bytes (70.00 MiB)` | `03B8562E299E5A85B86BB4AA51DF2B775AEE4ADD6C37B9A7B2877F0FF9092F97` |

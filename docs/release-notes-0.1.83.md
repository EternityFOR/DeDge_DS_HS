# DeDge DeepSeek Harness v0.1.83

## Fixed

- Runtime-home migration now honors `session-trash` deletion manifests, preventing deleted sessions from being restored from an older versioned Harness home after a runtime restart.
- A newly inserted user prompt now remains before all reasoning and tool events that follow it, even when the loaded history page begins inside a running turn.
- Added regression coverage for deletion tombstones and preserved chronological task rendering.

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
| `dedge-deepseek-harness-vscode-0.1.83-win32-x64.vsix` | `win32-x64` | `73,404,288 bytes (70.00 MiB)` | `19380AD1D9C66E49CB2A964DB4103134E58AB3189A05C0BF419EBF71B34670CA` |

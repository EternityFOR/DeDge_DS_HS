# DeDge DeepSeek Harness v0.1.86

## Fixed

- Codex handoffs now parse the current official `response_item` message transcript format in addition to legacy `event_msg` records, so recent Codex sessions no longer stop with "no readable user/assistant text".
- Standalone Codex `environment_context` wrapper records are ignored instead of being imported as chat turns or session titles.
- Codex JSONL fallback discovery now derives session titles from `response_item` user messages when the official app-server list is unavailable.
- Added regression coverage for the current Codex rollout format.

## Compatibility

- Bundled DeepSeek Harness: `0.1.5-rc.1`
- Node.js: `22.22.3`
- pnpm: `11.21.0`
- Verified target: Windows x64 (`win32-x64`)

## Verification

- TypeScript typecheck
- Vitest test suite (147 tests)
- Production build
- Read-only parser check against the reported real Codex rollout
- Documentation, release, and VSIX audits

## Release Asset

| Asset | Target | Size | SHA-256 |
| --- | --- | ---: | --- |
| `dedge-deepseek-harness-vscode-0.1.86-win32-x64.vsix` | `win32-x64` | `73,405,093 bytes (70.00 MiB)` | `9F1727FB4A6D022440D18D591E73161C237AFCDAFC7E8FBDD245BF405A0902E7` |

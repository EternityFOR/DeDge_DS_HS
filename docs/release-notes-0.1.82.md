# DeDge DeepSeek Harness v0.1.82

## Fixed

- Shared Harness runtime leases are now scoped by bundled Harness version and normalized workspace. A ToyFlow, AI Stock, or DeDge_DS_HS window can no longer reuse a live runtime launched for another workspace.
- Older unscoped leases remain compatible only when their recorded workspace matches the current VS Code workspace.
- Interrupted or partial runtime-home migrations now merge missing `sessions` and `storages` records from prior versioned homes without overwriting current files or copying credentials.
- Added regression tests for workspace lease isolation and existing-home migration recovery.

## Compatibility

- Bundled DeepSeek Harness: `0.1.5-rc.1`
- Node.js: `22.22.3`
- pnpm: `11.21.0`
- Verified target: Windows x64 (`win32-x64`)

## Verification

- TypeScript typecheck
- 143 Vitest tests
- Production build
- Authenticated RC.1 runtime smoke
- Documentation, privacy, and VSIX audits

## Release Asset

| Asset | Target | Size | SHA-256 |
| --- | --- | ---: | --- |
| `dedge-deepseek-harness-vscode-0.1.82-win32-x64.vsix` | `win32-x64` | `73,403,619 bytes (70.00 MiB)` | `3EAA27C97E07EF9EEC7F45B8291499DF9BD85D82D31B9AFDD8F54E6BAF9BE955` |

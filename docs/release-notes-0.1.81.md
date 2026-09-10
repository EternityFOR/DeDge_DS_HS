# DeDge DeepSeek Harness v0.1.81

## Fixed

- New installations now use the official Harness RC default `deepseek-flash` / `DeepSeek-V41-Flash` instead of the older V4 Flash alias.
- Windows diagnostics make the PowerShell 5.1 fallback and its per-command startup cost explicit.
- Permission menu descriptions expose the security/performance trade-off between Windows ACL `workspace-write` and explicitly selected Full access.

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
| `dedge-deepseek-harness-vscode-0.1.81-win32-x64.vsix` | `win32-x64` | `73,403,187 bytes (70.00 MiB)` | `34C78883C18B4C5E94EB1A575E1133417A36686D26F6982F8796FC490CE0EAC5` |

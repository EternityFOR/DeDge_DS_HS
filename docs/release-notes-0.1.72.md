# DeDge DeepSeek Harness v0.1.72

## Fixed

- Patched the alpha.2 v0→v1 session migration to ignore the historical `permission/preset.data.origin` field emitted by alpha.3.
- Existing copied migration homes now start successfully after upgrading; the original source session artifact remains unchanged.
- Added a migration fixture smoke check covering the previously failing legacy session shape.

## Compatibility

- Bundled DeepSeek Harness: `0.1.3-alpha.2`
- Node.js: `22.22.3`
- pnpm: `11.21.0`
- Verified target: Windows x64 (`win32-x64`)

## Verification

- TypeScript typecheck
- Vitest test suite
- Production build
- Authenticated alpha.2 runtime smoke
- Legacy v0 session migration fixture smoke
- Documentation, privacy, and VSIX audits

## Release Asset

| Asset | Target | Size | SHA-256 |
| --- | --- | ---: | --- |
| `dedge-deepseek-harness-vscode-0.1.72-win32-x64.vsix` | `win32-x64` | `77,817,793 bytes (74.21 MiB)` | `FD317AC11E069948CE2090FD8B27D07E9B2A550EA52C99136E54E93E9521AAD1` |

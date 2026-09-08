# DeDge DeepSeek Harness v0.1.75

## Fixed

- A session that retained an unsupported or expired model no longer dead-locks the composer.
- The model picker remains available when the upstream catalog is unroutable or only partially returned.
- Stable DeepSeek recovery models are added to partial/failed catalogs, and sending can switch the current session to a recovery route before submitting.

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
- Model recovery and interaction-readiness tests
- Documentation, privacy, and VSIX audits

## Release Asset

| Asset | Target | Size | SHA-256 |
| --- | --- | ---: | --- |
| `dedge-deepseek-harness-vscode-0.1.75-win32-x64.vsix` | `win32-x64` | `77,819,181 bytes (74.21 MiB)` | `E918CFDB935A187D3AA0E4A9106970699A19FE61CE50685F79D607E620CAE087` |

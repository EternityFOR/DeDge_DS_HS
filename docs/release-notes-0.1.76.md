# DeDge DeepSeek Harness v0.1.76

## Fixed

- Compatible alpha.2 runtimes from older extension hosts are reused through the legacy lease path, preventing duplicate Harness writers for one session.
- Model selection automatically reconnects once after a `SessionAlreadyOwnedError` and retries against the compatible runtime.
- The 0.1.75 model recovery path remains active for unsupported and expired routes.

## Compatibility

- Bundled DeepSeek Harness: `0.1.3-alpha.2`
- Node.js: `22.22.3`
- pnpm: `11.21.0`
- Verified target: Windows x64 (`win32-x64`)

## Verification

- TypeScript typecheck
- Vitest test suite (139 tests)
- Production build
- Authenticated alpha.2 runtime smoke
- Documentation, privacy, and VSIX audits

## Release Asset

| Asset | Target | Size | SHA-256 |
| --- | --- | ---: | --- |
| `dedge-deepseek-harness-vscode-0.1.76-win32-x64.vsix` | `win32-x64` | `77,819,597 bytes (74.21 MiB)` | `ED9BA9894276E1F8FCA724EBDCCD64B449446A5C8E1DBE9AC858C320E85E8E0B` |

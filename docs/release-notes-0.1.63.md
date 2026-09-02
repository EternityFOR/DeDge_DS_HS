# DeDge DeepSeek Harness v0.1.63

## Fixed

- A new VS Code host repairs missing content-addressed attachment objects before attaching to an already-running shared Harness.
- Installing an update while another VS Code window still owns the Harness no longer leaves historical image turns unusable.
- Attachment recovery merges only absent objects from prior versioned homes and never overwrites current session data.

## Compatibility

- Bundled DeepSeek Harness: 0.1.2-alpha.3
- Node.js: 22.22.3
- pnpm: 11.21.0
- Verified target: Windows x64 (win32-x64)

## Verification

- 124 Vitest tests
- TypeScript typecheck and production build
- Authenticated alpha.3 Gateway/runtime smoke
- Attachment recovery regression test
- Documentation, privacy, and VSIX audits

## Release Asset

| Asset | Target | Size | SHA-256 |
| --- | --- | ---: | --- |
| `dedge-deepseek-harness-vscode-0.1.63-win32-x64.vsix` | `win32-x64` | `76,049,516 bytes (72.5 MiB)` | `94C97FE5C6D1DD6EB95D91BB3B11E0B608330089C708199919C8FA1BA3E2278E` |

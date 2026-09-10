# DeDge DeepSeek Harness v0.1.79

## Fixed

- Durable user messages retire their optimistic send preview reliably, preventing apparent duplicate messages.
- Duplicate Webview send events are ignored while one prompt is in flight, and the composer unlocks only after the host acknowledgement.
- Reasoning and command/tool details align to the same task-level left edge.

## Compatibility

- Bundled DeepSeek Harness: `0.1.3-alpha.2`
- Node.js: `22.22.3`
- pnpm: `11.21.0`
- Verified target: Windows x64 (`win32-x64`)

## Verification

- TypeScript typecheck
- Vitest test suite (140 tests)
- Production build
- Authenticated alpha.2 runtime smoke
- Documentation, privacy, and VSIX audits

## Release Asset

The final VSIX filename, size, and SHA-256 are recorded here after packaging.

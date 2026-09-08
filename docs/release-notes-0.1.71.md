# DeDge DeepSeek Harness v0.1.71

## Changed

- Bundled official DeepSeek Harness upgraded from `0.1.2-alpha.3` to `0.1.3-alpha.2`.
- Updated the Gateway command envelope to the new `submittedAttachments` field used by the upgraded Harness.
- Updated schedule cancellation to fold the new Harness session-owned event stream correctly.
- Preserved the Windows-safe SSE, background-job stop, and schedule-cancel runtime patches against the new dependency closure.

## Compatibility

- Bundled DeepSeek Harness: `0.1.3-alpha.2`
- Node.js: `22.22.3`
- pnpm: `11.21.0`
- Verified target: Windows x64 (`win32-x64`)

## Verification

- TypeScript typecheck
- Vitest test suite
- Production build
- Authenticated alpha.2 runtime smoke, including command execution and `/schedule-cancel`
- Documentation, privacy, and VSIX audits

## Release Asset

| Asset | Target | Size | SHA-256 |
| --- | --- | ---: | --- |
| `dedge-deepseek-harness-vscode-0.1.71-win32-x64.vsix` | `win32-x64` | `77,817,556 bytes (74.21 MiB)` | `D1A311C8D395B9F9B3F1F1303F2ABF29A924E27DF976603ED11D4D9474C74B20` |

# DeDge DeepSeek Harness v0.1.69

## Fixed

- Sending now renders the user's message and clears the composer immediately, before any Vision/model-list lookup or provider network wait.
- The sending card stays visible with an animated submitting/waiting state until Harness acknowledges the prompt, so a delayed request no longer appears to jump straight to an AI response.
- Image-send confirmation remains asynchronous and restores the draft and attachments when auxiliary Vision is declined.

## Compatibility

- Bundled DeepSeek Harness: `0.1.2-alpha.3`
- Node.js: `22.22.3`
- pnpm: `11.21.0`
- Verified target: Windows x64 (`win32-x64`)

## Verification

- TypeScript typecheck
- Vitest test suite
- Production build
- Authenticated alpha.3 runtime smoke
- Documentation, privacy, and VSIX audits

## Release Asset

| Asset | Target | Size | SHA-256 |
| --- | --- | ---: | --- |
| `dedge-deepseek-harness-vscode-0.1.69-win32-x64.vsix` | `win32-x64` | `76,052,609 bytes (72.53 MiB)` | `CFF0B80041BD78709572500A3F2C3AF540D851CF63AD09B6F6509B93E92291C4` |

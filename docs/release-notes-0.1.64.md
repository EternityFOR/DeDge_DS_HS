# DeDge DeepSeek Harness v0.1.64

## Fixed

- Intermediate and queued user prompts now refresh their Edit and Steer actions after live Harness state changes instead of only when the card is first rendered.
- The newest user prompt shows a compact animated Waiting state until assistant, reasoning, or tool output follows it.
- The conversation shows an explicit Waiting for Harness response status during the gap before the next output.
- Added state-matrix tests covering active, queued, inserted, settled, autonomous, and unavailable user messages.

## Compatibility

- Bundled DeepSeek Harness: 0.1.2-alpha.3
- Node.js: 22.22.3
- pnpm: 11.21.0
- Verified target: Windows x64 (win32-x64)

## Verification

- 127 Vitest tests
- TypeScript typecheck and production build
- Playwright preview verification for actions and waiting states
- Authenticated alpha.3 Gateway/runtime smoke
- Documentation, privacy, and VSIX audits

## Release Asset

| Asset | Target | Size | SHA-256 |
| --- | --- | ---: | --- |
| `dedge-deepseek-harness-vscode-0.1.64-win32-x64.vsix` | `win32-x64` | `76,049,971 bytes (72.5 MiB)` | `D9BB3BAFBD253CE97FA5657CDC85FD5901860B38714565C2E7D4EE5FF9BE5167` |

# DeDge DeepSeek Harness v0.1.65

## Fixed

- Restored conversation history now opens at the newest tail after VS Code restart or session switching.
- A short initial tail anchor keeps the view at the bottom while delayed historical image attachments hydrate. User upward scrolling immediately releases the anchor.
- Waiting indicators cover first-token latency, reasoning/tool transitions, accepted prompts before their history event arrives, and active Harness processing gaps.

## Compatibility

- Bundled DeepSeek Harness: 0.1.2-alpha.3
- Node.js: 22.22.3
- pnpm: 11.21.0
- Verified target: Windows x64 (win32-x64)

## Verification

- 129 Vitest tests
- TypeScript typecheck and production build
- Playwright UI verification for restart scroll and processing states
- Authenticated alpha.3 Gateway/runtime smoke
- Documentation, privacy, and VSIX audits

## Release Asset

| Asset | Target | Size | SHA-256 |
| --- | --- | ---: | --- |
| `dedge-deepseek-harness-vscode-0.1.65-win32-x64.vsix` | `win32-x64` | `76,050,518 bytes (72.5 MiB)` | `58E18F3A790BE42AB91D18CA9DFDAEBC1246FE8A9DB43E508ED2FF7E32D8CC80` |

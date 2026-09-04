# DeDge DeepSeek Harness v0.1.68

## Fixed

- Alpha.3 queued user prompts are recognized from the official queue-row `rpcId` even when `message.source` is redacted. Queued messages remain visible with Remove, Edit, and Steer controls.
- Queue rows created by the current send are no longer hidden during the short idle/admission window, so an accepted prompt can be cancelled immediately.
- A queued prompt exposes a compact `Cancel` action on its sending card as soon as Harness confirms the inbox item.
- Pause remains in its cancelling state until the Agent, autonomous inbox, and owned background jobs settle, preventing a stale Pause button from blocking the composer.

## Compatibility

- Bundled DeepSeek Harness: 0.1.2-alpha.3
- Node.js: 22.22.3
- pnpm: 11.21.0
- Verified target: Windows x64 (`win32-x64`)

## Verification

- 131 Vitest tests
- TypeScript typecheck and production build
- Playwright UI verification for queue display, sending, and cancellation
- Authenticated alpha.3 runtime smoke
- Documentation, privacy, and VSIX audits

## Release Asset

| Asset | Target | Size | SHA-256 |
| --- | --- | ---: | --- |
| `dedge-deepseek-harness-vscode-0.1.68-win32-x64.vsix` | `win32-x64` | `76,052,385 bytes (72.53 MiB)` | `0BC9B6DFE8B472A5C8FB77A0604BD7F69390197D90BCB051ACFF4ED5A60BA5C9` |

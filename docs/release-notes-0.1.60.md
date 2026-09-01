# DeDge DeepSeek Harness v0.1.60

## What changed

- Bundled upstream DeepSeek Harness remains pinned to the official `0.1.2-alpha.3` release; all `@deepseek-ai/dsh-*` packages in the runtime closure stay locked to the same alpha.3 release.
- The bundled provider now receives a slash-free endpoint internally, matching alpha.3's direct `/chat/completions` join and preventing double-slash stream failures while preserving the user's configured URL.
- The Webview stays on a centered loading animation while Harness is resolving, starting, or stopping. The workbench appears only after the Gateway is connected; explicit error and stopped states remain actionable.

## Compatibility

- Bundled DeepSeek Harness: `0.1.2-alpha.3`
- Node.js: `22.22.3`
- pnpm: `11.21.0`
- Verified target: Windows x64 (`win32-x64`)

## Verification

- `pnpm install --frozen-lockfile`
- TypeScript typecheck
- 121 Vitest tests
- Extension build
- Bundled runtime preparation
- Authenticated alpha.3 runtime smoke and native image prompt smoke
- VSIX package, document, and privacy audits

## Privacy

No API keys, local Codex or Claude sessions, logs, private workspace files, machine-specific credentials, or process tokens are included in source, `dist`, `out`, or the VSIX. The provider URL normalization is in-memory only; credentials remain in VS Code SecretStorage.

## Release Asset

- `dedge-deepseek-harness-vscode-0.1.60-win32-x64.vsix`
- Size: `76,048,343 bytes (72.5 MiB)` compressed
- SHA-256: `28C6F79D3B05CD049DC4D29BE625885A51987873435B1DD71447D07C2EE98B05`

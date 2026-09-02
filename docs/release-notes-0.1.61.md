# DeDge DeepSeek Harness v0.1.61

## What changed

- The generated official DeepSeek route now includes the configured endpoint and DEEPSEEK_API_KEY reference in the same alpha.3 overlay generation. A shared runtime therefore cannot reuse a stale endpoint after a window restart or cross-window attach.
- The bundled alpha.3 provider requests Accept-Encoding: identity for SSE. This avoids compressed event-stream truncation in some Windows gateways, VPNs, and endpoint-security proxies.
- Transport errors expose a short redacted cause diagnostic. The diagnostic contains only an error class/message prefix and never response bodies, API keys, prompts, or session data.

## Compatibility

- Bundled DeepSeek Harness: 0.1.2-alpha.3
- Node.js: 22.22.3
- pnpm: 11.21.0
- Verified target: Windows x64 (win32-x64)

## Verification

- pnpm run typecheck
- pnpm test (122 tests)
- Extension build
- Bundled runtime preparation with the pinned alpha.3 transport patch
- Local OpenAI-compatible SSE text-stream smoke through the real Harness Gateway
- Authenticated runtime smoke, Playwright UI checks, VSIX package, documentation, and privacy audits

## Privacy

No API keys, local Codex or Claude sessions, logs, private workspace files, machine-specific credentials, or process tokens are included in source, dist, out, or the VSIX. Error diagnostics are redacted and bounded; provider response bodies are never persisted.

## Release Asset

| Asset | Target | Size | SHA-256 |
| --- | --- | ---: | --- |
| `dedge-deepseek-harness-vscode-0.1.61-win32-x64.vsix` | `win32-x64` | `76,048,866 bytes (72.5 MiB)` | `89DCD072106811851C6FEAE280D7ACEDE0762A111D2C7EB33CBA40B45F9040E6` |

# DeDge DeepSeek Harness v0.1.59

## What changed

- Bundled upstream DeepSeek Harness is upgraded to the official `0.1.2-alpha.3` release; all `@deepseek-ai/dsh-*` packages in the runtime closure are locked to the same alpha.3 release.
- The extension now exchanges alpha.3's local process token for a session cookie before opening HTTP RPC and RemoteStreamMux connections. Session lists, history, queue state, approvals, scheduling, model selection, and image attachments use the new protocol projection.
- Packed alpha.3 history chunk rows are expanded losslessly before the existing workbench projection, keeping reasoning, tool output, folding, and pagination compatible.
- The Webview stays on a centered loading animation while Harness is resolving, starting, or stopping. The workbench appears only after the Gateway is connected; explicit error and stopped states remain actionable.

## Compatibility

- Bundled DeepSeek Harness: `0.1.2-alpha.3`
- Node.js: `22.22.3`
- pnpm: `11.21.0`
- Verified target: Windows x64 (`win32-x64`)
- Existing session data is copied into the versioned Harness home according to the extension's migration policy; the source home is not modified in place.

## Verification

- `pnpm install --frozen-lockfile`
- TypeScript typecheck
- 121 Vitest tests
- Extension build
- Bundled runtime preparation
- Runtime smoke with authenticated Client RPC/streams, schedule tools, `/compact`, native image prompt, durable image references, and `session.attachment`
- Playwright loading/connected UI smoke
- Documentation and release privacy audits

## Privacy

No API keys, local Codex or Claude sessions, logs, private workspace files, machine-specific credentials, or process tokens are included in source, `dist`, `out`, or the VSIX. The alpha.3 process token is used only in memory to obtain a local cookie; credentials remain in VS Code SecretStorage.

## Release Asset

- `dedge-deepseek-harness-vscode-0.1.59-win32-x64.vsix`
- Size: `76,048,245 bytes (72.5 MiB)` compressed
- SHA-256: `28E57109F0340A1E61F696A85E33E43AF6F661ADFF4A958EC2BBB9B61ABC8C6C`

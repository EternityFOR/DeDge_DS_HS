# DeDge DeepSeek Harness v0.1.52

## What changed

- Historical Harness image attachments are restored from their durable session references and rendered inside the original user message. The extension fetches image bytes through the authenticated `session.attachment` endpoint only for the selected history page; image bytes are not written to logs or source-session data.
- Session management always lists Rename, Archive, and Delete. While an agent turn, autonomous queue, or background job is active, the removal entries explain why they must wait instead of disappearing from the menu.
- Queued user messages expose an inline Remove action backed by the native Harness queue mutation. Per-item busy locking prevents duplicate cancellation requests while the queue projection catches up.
- Runtime smoke waits for append-only history persistence before validating the durable image attachment contract.

## Verification

- TypeScript typecheck
- Automated Vitest suite
- Extension build
- Bundled runtime preparation and smoke test
- Documentation and release safety audits
- Windows x64 VSIX package audit
- Playwright Webview preview with a historical image attachment fixture

## Artifact

- `dedge-deepseek-harness-vscode-0.1.52-win32-x64.vsix`
- SHA-256: `4518BD8A00F9DDA32BE8658D991D60F7EE84B9B04402AFEF1E2CD484EE0C5354`

## Privacy

No API keys, local Codex or Claude sessions, logs, private workspace files, or machine-specific credentials are included in source, `dist`, or the VSIX. Credentials remain in VS Code SecretStorage; historical image bytes are fetched only from the selected local Harness session at runtime and are not committed.

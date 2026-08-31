# DeDge DeepSeek Harness v0.1.53

## What changed

- History projection now follows Harness inbox semantics: only a message claimed from `next-step` is shown as `You · Steer`.
- Official `goal` continuation prompts remain visible as `Agent · Goal`, so an autonomous round that resumes days later is not mistaken for a user steering message or an unexplained continuation of an older task.
- Recovered and paginated histories close a dangling task when a later turn boundary appears, preventing subsequent turns from being folded into the earlier task.
- Compaction surface replacements are excluded from the human transcript, avoiding duplicate prompt and response rows.
- Shared Harness runtime leases now track live VS Code extension hosts with local PID/nonce markers. Closing one window releases only that host; another window keeps the shared runtime alive and controllable. A disconnected window clears stale activity controls before reconnecting.

## Verification

- TypeScript typecheck
- 111 Vitest tests
- Extension build
- Bundled runtime preparation and runtime smoke
- Documentation, release-boundary, and VSIX privacy audits
- Synthetic Playwright preview

## Privacy

No API keys, local Codex or Claude sessions, logs, private workspace files, or machine-specific credentials are included in source, `dist`, `out`, or the VSIX. Shared-runtime markers contain only local extension-host PIDs and random nonces under the user's local application data directory. Credentials remain in VS Code SecretStorage.

## Release Asset

- `dedge-deepseek-harness-vscode-0.1.53-win32-x64.vsix`

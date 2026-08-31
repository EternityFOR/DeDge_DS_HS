# DeDge DeepSeek Harness v0.1.54

## What changed

- Stopped/interrupted historical task output is now treated as settled for interaction readiness. A restarted session no longer shows a stale Pause button or blocks new messages because an old fold still carries `taskComplete: false`.
- Official `dsh-schedule` follow-up messages are retained as `Agent · Schedule`; official `goal` rounds remain `Agent · Goal`. Neither is presented as `You · Steer`.
- Pause, model, compaction, archive, delete, and send readiness now share the same interrupted-task interpretation.

## Verification

- TypeScript typecheck
- 113 Vitest tests
- Extension build
- Bundled runtime preparation and runtime smoke
- Documentation, release-boundary, and VSIX privacy audits
- Synthetic Playwright preview

## Privacy

No API keys, local Codex or Claude sessions, logs, private workspace files, or machine-specific credentials are included in source, `dist`, `out`, or the VSIX. Shared-runtime markers contain only local extension-host PIDs and random nonces under the user's local application data directory. Credentials remain in VS Code SecretStorage.

## Release Asset

- `dedge-deepseek-harness-vscode-0.1.54-win32-x64.vsix`

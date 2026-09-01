# DeDge DeepSeek Harness v0.1.57

## What changed

- Steer is now accepted while a running Harness response also owns autonomous jobs or queued continuation work. The prompt enters the official next-step inbox without being blocked by the ordinary queue guard.
- Gateway reconnects now refresh authoritative session state, queue/job baselines, recent history, permissions, and context pressure. Earlier history pages remain loaded, and an idle session with an unfinished persisted turn is marked stopped instead of leaving a dead Pause button.
- Idle sends no longer flash as a queued row while the Harness receipt is settling.
- The official `@deepseek-ai/dsh-schedule` mount defaults to enabled for new installations. The first prompt in a session receives concise guidance to use `schedule_create`, `schedule_list`, and `schedule_delete` instead of `pwsh`/`bash` sleep loops.
- Built-in schedule guidance is visible in Prompt Inspector and is classified separately from ordinary file attachments.

## Verification

- TypeScript typecheck
- 117 Vitest tests
- Extension build
- Bundled runtime preparation and runtime smoke with schedule tools enabled
- Documentation, release-boundary, and VSIX privacy audits

## Compatibility

- Bundled DeepSeek Harness `0.1.1-rc.1`
- Node.js `22.22.3`
- Windows x64 target: `win32-x64`
- A running `pwsh Start-Sleep` command is not forcibly killed by Steer; Harness admits the steer at the next step boundary. Stop remains the control for cancelling the active command.

## Privacy

No API keys, local Codex or Claude sessions, logs, private workspace files, or machine-specific credentials are included in source, `dist`, `out`, or the VSIX. Credentials remain in VS Code SecretStorage, and generated runtime state remains outside the repository.

## Release Asset

- `dedge-deepseek-harness-vscode-0.1.57-win32-x64.vsix`
- SHA-256: `390AD98505911AC490E38EC74FF11BEBA8A5712CAA8BEE203D0129DD5395AEB5`

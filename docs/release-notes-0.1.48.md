# DeDge DeepSeek Harness v0.1.48

## What changed

- Steer messages now render in the active task timeline while Harness is admitting them into the next-step inbox. New reasoning and tool output stays below the inserted prompt instead of continuing above it inside the earlier fold.
- The temporary `You · Steer` preview survives task-group rerenders and is replaced by the durable Harness `user/message` event without duplicate entries.
- Added the opt-in official `@deepseek-ai/dsh-schedule` mount. The calendar-clock control and Automation setting restart the local runtime only while the active session is idle.
- Scheduled follow-ups are session-local and use the upstream `schedule_create`, `schedule_list`, and `schedule_delete` tools. The setting is disabled by default.

## Verification

- TypeScript typecheck
- 99 automated tests
- Extension build
- Bundled runtime preparation and smoke test
- Documentation, release-boundary, and VSIX privacy audits
- Synthetic Playwright preview covering pending steer, post-steer output, and durable-history replacement

## Privacy

No API keys, local Codex or Claude sessions, logs, private workspace files, or machine-specific credentials are included in source, `dist`, or the VSIX. Credentials remain in VS Code SecretStorage; generated runtime state remains outside the repository.

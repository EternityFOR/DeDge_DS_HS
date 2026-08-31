# DeDge DeepSeek Harness v0.1.56

## What changed

- Added an animated response-waiting row to the conversation. It appears when Harness is active but no new streaming output has arrived yet, then disappears as soon as Assistant or reasoning output starts.
- Autonomous continuation gaps use a separate `Agent is preparing the next step...` status so user-controlled responses and agent-controlled continuation are distinguishable.
- Added animated sending dots and a pulsing active status indicator for clearer progress feedback.

## Verification

- TypeScript typecheck
- 113 Vitest tests
- Extension build
- Bundled runtime preparation and runtime smoke
- Documentation, release-boundary, and VSIX privacy audits
- Synthetic Playwright preview covering wait-indicator appearance and removal on streaming output

## Privacy

No API keys, local Codex or Claude sessions, logs, private workspace files, or machine-specific credentials are included in source, `dist`, `out`, or the VSIX. The wait animation has no network behavior and stores no transcript data.

## Release Asset

- `dedge-deepseek-harness-vscode-0.1.56-win32-x64.vsix`

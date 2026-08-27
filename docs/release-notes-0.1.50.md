# DeDge DeepSeek Harness v0.1.50

## What changed

- History pages that begin in the middle of a Harness turn now recover a foldable task group from event `turn` metadata when the page does not contain `turn/start`.
- Recovered groups use a stable turn-based ID and converge with the official boundary after earlier history is loaded, preserving folding state across pagination and session reopening.
- Short single-message slices remain unchanged; synthetic groups are created only when the page contains enough distinct work to represent an intermediate task.

## Verification

- TypeScript typecheck
- Automated Vitest suite
- Extension build
- Real-session projection check against a paginated Harness history page
- Documentation and release-boundary audits
- Windows x64 VSIX package audit

## Privacy

No API keys, local Codex or Claude sessions, logs, private workspace files, or machine-specific credentials are included in source, `dist`, or the VSIX. Credentials remain in VS Code SecretStorage; generated runtime state remains outside the repository.

# DeDge DeepSeek Harness v0.1.51

## What changed

- Session tabs can now be renamed from the tab management menu. Renaming writes only a Harness title event, so the transcript, files, model context, and handoff source remain unchanged. Active responses can be renamed; archive and delete remain unavailable until the task settles.
- History pages that begin in the middle of a Harness turn no longer use the first visible tool output as a fake task start. Intermediate tool and reasoning output stays inside the fold while the final answer remains visible.
- Recovered task groups use stable turn-based IDs, preserving folding state when earlier history is loaded or an older session is reopened.

## Verification

- TypeScript typecheck
- Automated Vitest suite
- Extension build
- Runtime preparation and smoke test
- Documentation and release-boundary audits
- Windows x64 VSIX package audit

## Artifact

- `dedge-deepseek-harness-vscode-0.1.51-win32-x64.vsix`
- SHA-256: `AA731C270E40A58E44FDD9F8055E77EE5451AF37DF901D02C8A41FB69723DBD8`

## Privacy

No API keys, local Codex or Claude sessions, logs, private workspace files, or machine-specific credentials are included in source, `dist`, or the VSIX. Credentials remain in VS Code SecretStorage; generated runtime state remains outside the repository.

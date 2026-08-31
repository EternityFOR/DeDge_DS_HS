# DeDge DeepSeek Harness v0.1.55

## What changed

- Added `Auto-fold running task`, a persistent workbench switch that is off by default. Live messages now appear one by one and remain expanded as they arrive, matching the Codex-style reading flow.
- When enabled, only the currently running task folds its intermediate reasoning and tool details. Completed or stopped tasks remain open unless the user manually folds them.
- Top fold/expand toolbar buttons now operate on running tasks only, and individual task fold buttons remain available for precise history control.
- Streaming reasoning and tool cards open incrementally by default; their compact summaries retain character counts for quick scanning.

## Verification

- TypeScript typecheck
- 113 Vitest tests
- Extension build
- Bundled runtime preparation and runtime smoke
- Documentation, release-boundary, and VSIX privacy audits
- Synthetic Playwright preview covering default-expanded and opt-in running-task folding

## Privacy

No API keys, local Codex or Claude sessions, logs, private workspace files, or machine-specific credentials are included in source, `dist`, `out`, or the VSIX. The folding preference is stored only in the Webview state for the current VS Code profile.

## Release Asset

- `dedge-deepseek-harness-vscode-0.1.55-win32-x64.vsix`

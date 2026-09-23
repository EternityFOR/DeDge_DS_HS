# DeDge DeepSeek Harness v0.1.91

## Changed

- Bundled official DeepSeek Harness upgraded to `0.1.5-rc.3`.
- Existing local runtime patching remains deterministic and runs after every staged upstream install; it does not overwrite extension source code.
- Workspace hooks are explicitly mounted only when a supported config file exists: `.claude/hooks.json`, `.claude/settings.json`, root `hooks.json`, or `.codex/hooks.json`.

## Fixed

- Claude Code and Codex command hooks can now be used by the bundled Harness through their official bridge packages instead of being silently ignored as unregistered workspace files.
- RC schedule cancellation, permission-switch terminal cleanup, idle approval-policy handling, and persistent-shell recovery patches remain applied after the rc.3 refresh.

## Compatibility

- Bundled DeepSeek Harness: `0.1.5-rc.3`
- Node.js: `22.22.3`
- pnpm: `11.21.0`
- Verified target: Windows x64 (`win32-x64`)

## Verification

- TypeScript typecheck
- Vitest test suite
- Production build
- Authenticated RC.3 runtime smoke
- Runtime patch shape checks
- Documentation, privacy, and VSIX audits

## Release Asset

| Asset | Target | Size | SHA-256 |
| --- | --- | ---: | --- |
| `dedge-deepseek-harness-vscode-0.1.91-win32-x64.vsix` | `win32-x64` | `73,427,057 bytes (70.02 MiB)` | `B5E42808036185CC5E879818EBF92736F46D5A8ED7DBE5699FB651F2E9D85DC6` |

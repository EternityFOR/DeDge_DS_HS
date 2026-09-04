# DeDge DeepSeek Harness v0.1.70

## Fixed

- Active reminders from the official alpha.3 `schedule` projection now keep the session visibly marked as autonomous until they fire or are cancelled.
- The right-side Pause control is available for an armed scheduled reminder and clearly reports the number of reminders it will cancel.
- Pause now cancels current-session reminders through a persistence-checked `/schedule-cancel` bridge, without touching schedules in other sessions.
- Schedule state is restored from history and the live control stream after session switching or VS Code restart.

## Compatibility

- Bundled DeepSeek Harness: `0.1.2-alpha.3`
- Node.js: `22.22.3`
- pnpm: `11.21.0`
- Verified target: Windows x64 (`win32-x64`)

## Verification

- TypeScript typecheck
- 134 Vitest tests
- Production build
- Authenticated alpha.3 runtime smoke, including `/schedule-cancel`
- Documentation, privacy, and VSIX audits

## Release Asset

| Asset | Target | Size | SHA-256 |
| --- | --- | ---: | --- |
| `dedge-deepseek-harness-vscode-0.1.70-win32-x64.vsix` | `win32-x64` | `76,053,800 bytes (72.53 MiB)` | `F08A7CC76604A5043A0D44076C8402CA84D89E47E656C3D39314CC35CE0F8F2C` |

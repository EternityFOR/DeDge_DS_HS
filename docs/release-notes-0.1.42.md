# DeDge DeepSeek Harness v0.1.42 test build

## Fixed

- Preserves non-empty history tabs when Harness replays session-added frames after the initial session list.
- Avoids deleting an open managed attachment file underneath the VS Code editor.

## Changed

- Selection chips use labels such as `main.c (111-220)` and contain only the selected lines plus source metadata.
- The composer File action expands into workspace and system file-picker choices.
- Earlier history supports loading or hiding one page or all pages.
- The bottom toolbar stays on one line and hides secondary controls as the view narrows.

## Verification

- TypeScript typecheck and automated tests
- 520 px and 360 px Webview screenshots and interaction checks
- Bundled runtime, documentation, privacy, and VSIX audits

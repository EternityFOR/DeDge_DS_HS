# DeDge DeepSeek Harness v0.1.32

## Fixed

- Search result arrow navigation no longer freezes the Webview. The text highlighter now advances through matches correctly instead of repeatedly processing the same match.
- The fix was exercised through the real preview browser: searching for `task`, clicking `Next match`, expanding the target task, and confirming the page remained responsive.

## Verification

- TypeScript typecheck
- Production build
- Unit test suite
- VSIX package audit and privacy scan
- Windows x64 VSIX package generation

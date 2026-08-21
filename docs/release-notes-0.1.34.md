# DeDge DeepSeek Harness v0.1.34

## Fixed

- Search navigation now scrolls to the exact highlighted text range instead of the containing long message.
- Result positioning accounts for the floating search panel so the highlighted word remains visible below it.

## Verification

- Real Chromium preview at a 310 x 950 sidebar viewport
- Confirmed the highlighted range was registered and visible inside the conversation viewport
- Confirmed the result was below the search panel and only the matched word was highlighted
- TypeScript, unit tests, build, documentation, release privacy, and VSIX package audits

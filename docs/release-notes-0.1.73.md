# DeDge DeepSeek Harness v0.1.73

## Fixed

- Added the then-current `deepseek-v4.1-flash-expires-0901` route to the DeepSeek model catalog (superseded by the 0910 internal-beta route in 0.1.74).
- Marked that route as native multimodal so the auxiliary Vision switch defaults off and native image input is used.
- Kept the alpha.2 legacy-session migration fix from `0.1.72` in this model-list update.

## Compatibility

- Bundled DeepSeek Harness: `0.1.3-alpha.2`
- Node.js: `22.22.3`
- pnpm: `11.21.0`
- Verified target: Windows x64 (`win32-x64`)

## Verification

- TypeScript typecheck
- Vitest test suite
- Production build
- Authenticated alpha.2 runtime smoke, including the V4.1 route
- Legacy v0 session migration fixture smoke
- Documentation, privacy, and VSIX audits

## Release Asset

| Asset | Target | Size | SHA-256 |
| --- | --- | ---: | --- |
| `dedge-deepseek-harness-vscode-0.1.73-win32-x64.vsix` | `win32-x64` | `77,818,002 bytes (74.21 MiB)` | `AB25E92CF182B4A2F88E58F146857EDA215FE94CDCADE8C3EFA050B72342BA42` |

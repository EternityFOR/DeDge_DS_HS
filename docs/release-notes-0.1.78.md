# DeDge DeepSeek Harness v0.1.78

## Changed

- Retired the expired `deepseek-v4.1-flash-expires-on-0910` internal preview from selectable routes.
- Continued using the official stable DeepSeek aliases; the service can route `deepseek-v4-pro` to the newest Flash backend without a client-side undocumented model ID.
- Existing preview settings migrate to a stable route without changing or deleting session history.

## Compatibility

- Bundled DeepSeek Harness: `0.1.3-alpha.2`
- Node.js: `22.22.3`
- pnpm: `11.21.0`
- Verified target: Windows x64 (`win32-x64`)

## Verification

- TypeScript typecheck
- Vitest test suite (140 tests)
- Production build
- Authenticated alpha.2 runtime smoke
- Documentation, privacy, and VSIX audits

## Release Asset

| Asset | Target | Size | SHA-256 |
| --- | --- | ---: | --- |
| `dedge-deepseek-harness-vscode-0.1.78-win32-x64.vsix` | `win32-x64` | `77,819,925 bytes (74.21 MiB)` | `295756FA07A398A6E977F783157CE33C99F903B238F2584CBB2A3A036E18D04B` |

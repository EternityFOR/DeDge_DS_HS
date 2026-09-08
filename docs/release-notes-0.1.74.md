# DeDge DeepSeek Harness v0.1.74

## Fixed

- Bundled Harness leases are now stored under a version-specific directory, so old extension hosts cannot discover and terminate a newer Harness process.
- Incompatible legacy leases are ignored and left for their owning old host; the current extension starts its own isolated runtime.
- Replaced the expired `deepseek-v4.1-flash-expires-0901` route with the current `deepseek-v4.1-flash-expires-on-0910` internal-beta route.
- The V4.1 entry is explicitly labeled internal beta and expiry-bound because the stable DeepSeek API catalog does not guarantee it.
- Existing VS Code settings that still contain the expired `0901` id are normalized to the current route on load, including the optional compaction model.
- At the expiry boundary the internal-beta option is hidden and selected settings fall back to stable `deepseek-v4-flash`; future preview names still require an explicit route-table update because the public catalog does not guarantee internal endpoints.

## Compatibility

- Bundled DeepSeek Harness: `0.1.3-alpha.2`
- Node.js: `22.22.3`
- pnpm: `11.21.0`
- Verified target: Windows x64 (`win32-x64`)

## Verification

- TypeScript typecheck
- Vitest test suite
- Production build
- Authenticated alpha.2 runtime smoke
- Version-isolated lease tests
- Documentation, privacy, and VSIX audits

## Release Asset

| Asset | Target | Size | SHA-256 |
| --- | --- | ---: | --- |
| `dedge-deepseek-harness-vscode-0.1.74-win32-x64.vsix` | `win32-x64` | `77,818,532 bytes (74.21 MiB)` | `7BA0AA0A1AFA1A322B8C784915E0B4B7590B448BA86FCF6A896AE7DC62E6F360` |

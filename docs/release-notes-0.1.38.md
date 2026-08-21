# DeDge DeepSeek Harness v0.1.38 test build

## Fixed

- Bundled mode now requires the shared runtime lease to match bundled Harness `0.1.1-rc.1` exactly.
- A stale RC7 lease is cleared and only its recorded DeDge-owned process tree is stopped before the current runtime starts.
- This prevents `deepseek-v4-flash-vision-exp` image prompts from reaching the old text-only RC7 adapter.

## Expected result

After installing this build and reloading VS Code, the Workbench footer reports `0.1.1-rc.1`. With auxiliary vision off, Vision Exp receives the original image through the native Harness image-content path.

## Verification

- Exact shared-runtime version-gate test
- TypeScript typecheck and 89 automated tests
- Bundled runtime startup, `/compact`, model catalog, and native image prompt smoke tests
- Documentation, release privacy, and VSIX package audits

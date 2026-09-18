# DeDge DeepSeek Harness v0.1.85

## Fixed

- Official Harness success RPC responses may omit `value`; the extension now accepts `{ ok: true }` acknowledgements instead of reporting `Malformed Harness RPC result`.
- Question, approval, and other no-payload interaction acknowledgements now remain usable.
- Added protocol regression coverage for payload-less success responses.

## Compatibility

- Bundled DeepSeek Harness: `0.1.5-rc.1`
- Node.js: `22.22.3`
- pnpm: `11.21.0`
- Verified target: Windows x64 (`win32-x64`)

## Verification

- TypeScript typecheck
- Vitest test suite
- Production build
- Authenticated RC.1 runtime smoke
- Documentation, privacy, and VSIX audits

## Release Asset

| Asset | Target | Size | SHA-256 |
| --- | --- | ---: | --- |
| `dedge-deepseek-harness-vscode-0.1.85-win32-x64.vsix` | `win32-x64` | `73,404,653 bytes (70.00 MiB)` | `C903219AA2BE67CDB768F65DA80263FAE0ECA7FC40FBD4DA5D4187608DEC9A84` |

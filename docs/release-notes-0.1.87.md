# DeDge DeepSeek Harness v0.1.87

## Fixed

- A canceled queue item no longer leaves an optimistic composer receipt with a dead delete button behind it; queue rows disappear from the dock as soon as Remove is requested.
- Delivered inserted/steering prompts no longer keep live Edit/Steer buttons after the model has started reasoning or running tools in response to them.
- Inserted/steering prompts now get their own fold summary, so work produced after the insertion is folded under that message while the task is running.
- Added regression coverage for prompt action state after output starts.

## Compatibility

- Bundled DeepSeek Harness: `0.1.5-rc.1`
- Node.js: `22.22.3`
- pnpm: `11.21.0`
- Verified target: Windows x64 (`win32-x64`)

## Verification

- TypeScript typecheck
- Vitest test suite (147 tests)
- Production build
- Documentation, release, and VSIX audits
- Includes the Codex `response_item` handoff fix from v0.1.86

## Release Asset

| Asset | Target | Size | SHA-256 |
| --- | --- | ---: | --- |
| `dedge-deepseek-harness-vscode-0.1.87-win32-x64.vsix` | `win32-x64` | `73,405,623 bytes (70.01 MiB)` | `7B8B6955F393387EB6CE44E3708543B91AD2098FD0A66EC25C25D755E6F5302D` |

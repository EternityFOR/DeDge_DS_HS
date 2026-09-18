# DeDge DeepSeek Harness v0.1.88

## Fixed

- Pause now cancels scheduled reminders on the bundled `0.1.5-rc.1` runtime through a generated `/schedule-cancel` bridge. The upstream release ships the model-facing `schedule_*` tools but no human cancellation command, so the previous Pause path failed with a reinstall message whenever a reminder was armed.
- Session lists are scoped to the workspace bound to the local Harness runtime. With several VS Code windows open, a window can no longer select or prompt a session that belongs to another project runtime, which removes the `SessionAlreadyOwnedError` prompt failures and the stale disabled Send button that only recovered after a restart.
- A prompt that still encounters an ownership conflict now restarts/reconnects once and retries. If another window still owns the session, the workbench reports that explicitly instead of leaving the composer blocked.
- Session deletion now tries to move a cold session directory into recovery storage without restarting Harness. If the session is still loaded, the runtime stops to release the session lock, the file move completes, and the runtime reconnects in the background so the delete spinner no longer waits for a full startup.
- Session tabs are horizontally scrollable with a visible thin scrollbar and mouse-wheel support, and tabs can be drag-reordered. The order is persisted per workspace.
- Explicit Steer mode now falls back to queue delivery when the session has no active turn. An armed scheduled reminder can no longer leave the Send button greyed out while the agent is idle.

## Compatibility

- Bundled DeepSeek Harness: `0.1.5-rc.1`
- Node.js: `22.22.3`
- pnpm: `11.21.0`
- Verified target: Windows x64 (`win32-x64`)

## Verification

- TypeScript typecheck
- Vitest regression suite
- Production build
- Authenticated RC.1 runtime smoke
- Documentation, privacy, and VSIX audits

## Release Asset

| Asset | Target | Size | SHA-256 |
| --- | --- | ---: | --- |
| `dedge-deepseek-harness-vscode-0.1.88-win32-x64.vsix` | `win32-x64` | `73,407,885 bytes (70.01 MiB)` | `9436A477FB5D9FBB040DB8A0FF9DE6E3093D9671E169D95144CD42A7BF50BD49` |

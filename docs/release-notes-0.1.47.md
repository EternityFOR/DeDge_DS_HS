# DeDge DeepSeek Harness v0.1.47

## Fixed

- Waiting gaps between autonomous Harness turns now keep a visible Pause control.
- The workbench consumes official `session/queue` and `session/jobs` frames, distinguishes user-owned queued prompts from agent-owned goal/plugin work, and labels the active tab accordingly.
- Pause sends the native Harness cancel request and removes agent-owned queued prompts so a goal round does not immediately wake itself again. User queued messages are preserved.
- User-stopped turns are projected as settled, interrupted tasks. Their intermediate output is folded after stopping, with a stopped-task label and a manual expand control that remains stable across subsequent renders.
- Added an opt-in calendar-clock control for the official `@deepseek-ai/dsh-schedule` plugin. The setting mounts the plugin through a generated user patch and restarts Harness only when the active task is idle.
- Active inserted prompts are kept as the tail boundary of an unfinished task, so new reasoning and tool output appears below the inserted message instead of inside the earlier collapsed region.

## Verification

- TypeScript typecheck
- 99 automated tests
- Extension build, runtime smoke, release audit, and VSIX package audit
- Synthetic UI preview with `running=false` plus official queue/job state

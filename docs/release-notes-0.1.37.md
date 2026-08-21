# DeDge DeepSeek Harness v0.1.37 test build

## Images

- Bundled Harness is upgraded to `0.1.1-rc.1` and accepts native image prompt blocks for image-capable main models.
- The composer image control now means **auxiliary vision model**, not general image support. It is off by default.
- When an image-capable main model and auxiliary vision are both selected, sending asks for confirmation because preprocessing adds another request, latency, and token cost.
- Text-only main models can use the separately configured auxiliary Vision URL, key, model, and reasoning effort.

## Composer

- Send and Auto/Steer/Queue are one split control.
- Compaction, task folding, context pressure, compaction model, and context settings are grouped into one split control.
- The permanent Git toolbar button and Prompt Inspector were removed.

## Change review

- A completed task can show a Codex-style file/addition/deletion summary.
- DeDge Diff groups changes into collapsible files and supports unified vertical and side-by-side layouts.
- Every file can still be opened in VS Code's native diff editor.

## Verification

- TypeScript typecheck and automated tests
- Bundled-runtime startup, model catalog, `/compact`, and native image prompt smoke checks
- Narrow composer browser preview
- Documentation, release privacy, and VSIX package audits

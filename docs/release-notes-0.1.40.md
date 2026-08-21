# DeDge DeepSeek Harness v0.1.40 test build

## Changed

- Existing non-empty history sessions remain available as top tabs. Only blank `New session` records are excluded from startup tabs.
- The automatic change-summary bar is removed because Harness does not provide reliable turn-level file ownership. Workspace review remains available from the context menu without claiming it belongs to the last turn.
- When a live turn completes, its first-level task shell opens automatically so the final answer is visible. Nested reasoning, tools, process output, and Vision details remain folded.

## Verification

- TypeScript typecheck and automated tests
- Bundled runtime and native image smoke checks
- Documentation, release privacy, and VSIX audits

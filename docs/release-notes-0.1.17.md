# DeDge DeepSeek Harness v0.1.17 test build

- Fixes task ordering so the user prompt always appears before reasoning and tool activity.
- The stable task hierarchy is now `YOU`, nested intermediate process, then final `ASSISTANT` output.
- Verified with a synthetic history where a reasoning event precedes the user projection.

Bundled DeepSeek Harness: `0.1.0-rc.7`.

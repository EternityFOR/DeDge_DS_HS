# DeDge DeepSeek Harness v0.1.13 test build

- Vision model is empty by default; configure a compatible model explicitly.
- Saving Vision URL and key populates a separate model selector from `/models` while preserving manual model entry.
- Obvious image-generation and review-only models are hidden by default; the composer menu can reveal the complete endpoint list.
- Optional Vision reasoning effort is sent only when explicitly configured.
- Vision 401/403/502 failures now include actionable endpoint and upstream-access guidance.
- Delivery mode has a hover explanation for Clipboard and CLI behavior.
- The active session tab remains visible while runtime metadata is temporarily blank.
- Unsupported manual compaction reports a capability error without changing context.

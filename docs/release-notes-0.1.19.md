# DeDge DeepSeek Harness v0.1.19 test build

- Manual context compaction now uses the official Harness rc.7 `commands/execute` route and parses the runtime's actual command response.
- The bundled runtime smoke test executes `/compact` in an isolated empty session without calling a model.
- Repeated earlier-history loads accumulate above the current task, preserve order, and remain recursively collapsed.
- The history loader locks while active, and inserted user messages are labeled `YOU · STEER`.

Bundled DeepSeek Harness: `0.1.0-rc.7`.

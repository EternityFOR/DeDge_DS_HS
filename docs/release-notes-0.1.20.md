# DeDge DeepSeek Harness v0.1.20 test build

- Earlier-history paging now advances from raw Harness event sequence numbers and skips internal-only pages until a visible older task is added.
- Context compaction exposes a locked `compacting` session state with a spinner and status text until the transaction settles.
- Duplicate compaction requests are coalesced instead of invoking `/compact` concurrently.
- Pending text and Vision messages remain below existing history while they are being submitted.
- Informational completion notices no longer use the error appearance.

Bundled DeepSeek Harness: `0.1.0-rc.7`.

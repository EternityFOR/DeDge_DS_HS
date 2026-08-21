# DeDge DeepSeek Harness v0.1.43 test build

## Fixed

- `Hide All` leaves the latest complete task visible and keeps older history available to load again.
- The bundled Harness starts with its official `--no-open` option and no longer opens the standalone browser UI during VS Code activation.
- Top tabs use persistent projected session titles immediately instead of waiting for a history load.

## Verification

- TypeScript typecheck and 92 automated tests
- Bundled runtime smoke with `--no-open`
- Documentation, release privacy, and VSIX audits

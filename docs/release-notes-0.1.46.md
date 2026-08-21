# DeDge DeepSeek Harness v0.1.46

## Fixed

- Session management selects the target tab before archive/delete actions.
- Delete keeps its local tombstone through runtime restart and cleans the Harness session index afterward, preventing deleted non-active sessions from reappearing.

## Verification

- TypeScript typecheck and 92 automated tests
- Windows x64 VSIX package audit

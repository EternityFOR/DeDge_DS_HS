# DeDge DeepSeek Harness v0.1.39 test build

## Fixed

- Cancelling the auxiliary-vision confirmation now sends an explicit rejected result back to the Webview, restoring the Send button and keeping the draft and image attachment.
- Startup no longer creates an empty `New session` tab. A session is created only on the first real send or an explicit New Session command.

## Verification

- TypeScript typecheck and automated tests
- Bundled runtime and native image smoke checks
- Release documentation, privacy, and VSIX audits

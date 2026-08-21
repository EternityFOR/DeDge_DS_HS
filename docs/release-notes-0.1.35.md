# DeDge DeepSeek Harness v0.1.35 test build

## Fixed

- Restored `deepseek-v4-pro` in the Harness model selector.
- Added the official `deepseek-v4-flash-vision-exp` model to the Harness and Vision catalogs.
- Vision endpoint discovery now retains up to 1,000 unique models instead of truncating the first 100.
- Multimodal models containing `image` in their name are no longer mistaken for image-generation-only routes.

## Verification

- Real bundled Harness `session.models` smoke check for Flash, Pro, and Vision Exp
- TypeScript typecheck and production build
- 84 automated tests
- Documentation, release privacy, and VSIX package audits

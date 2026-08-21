# DeDge DeepSeek Harness v0.1.36 test build

## Added

- The image control is now a per-model toggle. Known vision-capable models start enabled; text-only models start disabled and can be explicitly overridden.
- The image split menu keeps dedicated Vision endpoint configuration available without crowding the composer.
- The compaction split button can use the conversation model or a separately selected provider/model.

## Compatibility

- Bundled Harness `0.1.0-rc.7` still exposes a text-only DeepSeek adapter. Auto vision therefore reuses the selected model endpoint to describe the image, then sends that description to Harness as text. Dedicated mode keeps the separate OpenAI-compatible Vision endpoint.
- Changing the compaction model is allowed only while sessions are idle and restarts the extension-managed runtime so the agent overlay is applied consistently.

## Verification

- TypeScript typecheck, automated tests, production build, bundled-runtime smoke test
- Narrow sidebar UI preview and interaction checks
- Documentation, release privacy, and VSIX package audits

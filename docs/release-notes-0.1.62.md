# DeDge DeepSeek Harness v0.1.62

## What changed

- Harness home upgrades now carry the durable content-addressed attachments tree together with sessions and storage metadata.
- Existing alpha.3 homes repair missing attachment objects from the newest prior versioned home without overwriting current files. This recovers image references created before the alpha.3 migration and prevents Attachment object is missing on later turns.
- The 0.1.61 endpoint and SSE transport hardening remains included.

## Compatibility

- Bundled DeepSeek Harness: 0.1.2-alpha.3
- Node.js: 22.22.3
- pnpm: 11.21.0
- Verified target: Windows x64 (win32-x64)

## Verification

- pnpm run typecheck
- pnpm test (124 tests)
- Extension build
- Bundled runtime preparation with the pinned alpha.3 transport patch
- Attachment migration regression test
- Authenticated runtime smoke, documentation, and privacy audits

## Privacy

The repair copies only local content-addressed objects between the user's versioned Harness homes. No session logs, API keys, or private files are added to the repository or VSIX.

## Release Asset

- dedge-deepseek-harness-vscode-0.1.62-win32-x64.vsix

# DeDge DeepSeek Harness v0.1.49

## What changed

- Added a compact QueueDock for user-owned Harness inbox items with inline Edit, Steer, and Remove actions. Queue previews are intentionally text-only and never expose image Base64 or attachment bodies.
- Added queue and autonomous-job projections with ownership-aware labels, keeping user-controlled prompts distinct from agent-controlled background work.
- Running-session Steer uses the native Harness queue update path. For a paused session, text-only queued prompts are removed and reintroduced with a steer prompt so the active task can resume without duplicate history entries.
- Queue mutations are serialized and freeze the affected controls until the authoritative Harness queue frame arrives, preventing repeated delete or steer requests.
- Mixed or image-bearing queued prompts remain protected while paused; the workbench asks the user to resume before attempting an attachment rebuild.

## Verification

- TypeScript typecheck
- Automated Vitest suite
- Extension build
- Bundled runtime preparation and smoke test
- Documentation, release-boundary, and VSIX privacy audits
- Windows x64 VSIX package audit

## Privacy

No API keys, local Codex or Claude sessions, logs, private workspace files, or machine-specific credentials are included in source, `dist`, or the VSIX. Credentials remain in VS Code SecretStorage; generated runtime state remains outside the repository.

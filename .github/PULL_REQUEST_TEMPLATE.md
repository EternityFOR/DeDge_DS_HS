## Summary

Describe the user-visible outcome and the ownership boundary changed.

## Validation

- [ ] pnpm run audit:release
- [ ] pnpm run typecheck
- [ ] pnpm test
- [ ] pnpm run build
- [ ] Runtime smoke/package audit, when runtime or packaging changed
- [ ] Narrow-width UI verification, when UI changed

## Privacy and compatibility

- [ ] No credentials, personal paths, session dumps, private code, logs, or generated output were added.
- [ ] Windows arguments remain array-based and do not rely on shell string interpolation.
- [ ] Codex/Claude source sessions remain read-only, when handoff behavior changed.
- [ ] README/CHANGELOG/docs were updated for user-visible behavior.

## Remaining risk

List unverified platforms, upstream assumptions, migrations, or follow-up work.

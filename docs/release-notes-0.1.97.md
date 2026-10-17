# DeDge DeepSeek Harness 0.1.97

Fixes reasoning-only completion and the optional hook dependency omissions in the pinned official Harness 0.2.1-alpha.4 runtime. This is a new extension version, not a change to the upstream version or home format.

## Response recovery

- A settled normal stop requires nonblank text or a tool call; thinking alone is not an answer. Whitespace-only replies fail the same check. Token-limit, tool-call and interrupted-stream outcomes remain distinct.
- Record usage and original thinking before failing with EMPTY_RESPONSE. Retry only the current request, at most once, retaining earlier tool results. There is no user-message resubmission, tool replay, heuristic FINAL splitting or thinking-to-answer conversion.
- Respect explicitly disabled/excluded retries. Even an always-retry policy cannot loop indefinitely on empty replies. Other error policies remain unchanged.
- Keep the failed reasoning visible and label recovery. If the second request also has no answer, show an error and allow a follow-up instead of leaving a spinner or declaring success.
- A recovery request is an additional model request and can incur provider charges. Synthetic release tests incur none. This prevents a false success but cannot force a provider to return a correct answer.

## Hook packaging

Pin the official Claude Code and Codex hook bridges directly to 0.2.1-alpha.4, retain their licenses, verify both are present and version-matched, and test actual command-hook execution. No user hook config/script is included in the VSIX; existing workspace detection and trust boundaries are unchanged.

## Upgrade

Install this platform's VSIX and reload VS Code after active tasks finish. The runtime home remains 0.2.1-alpha.4; no original session or credential is overwritten and no current Host is restarted by this build workflow. Existing history is not rewritten; older reasoning-only responses keep their diagnostic.

Close or reload every VS Code window still using the older extension after its tasks have finished. Shared leases now include a local patch revision: this extension refuses to silently reuse an unpatched same-version Host, without killing it or starting a duplicate against its home. A visible diagnostic explains the required reload.

## Verification

- 207 tests in 27 Vitest files, TypeScript checking, production build, dependency peer checks, documentation audit and release safety audit passed.
- The shipped adapter passed 11 synthetic SSE cases, including reasoning-only, blank text, missing terminal, tool use, token limit and fragmented UTF-8. Failed empty replies retain usage and reasoning without a successful finish.
- Actual retry-plugin checks cover normal/always policies, explicit zero/exclusions, unchanged server-error policy and per-step reset.
- Both staged and extracted final runtimes passed full mock-model smoke: recovery, exhausted recovery, cancellation, continuation after failure, one execution of a real synthetic tool side effect, retained prior tool results, actual Claude/Codex command hooks, native images, schedules, custom gateways and foreground steering with ten retained queued messages.
- Final extracted-package steering timing: queue 1844 ms / direct 1960 ms with both synthetic command-hook bridges enabled. Fourteen packaged runtime/extension files matched the tested staging byte for byte.
- Final win32-x64 VSIX: 12,806 files, 98,108,208 bytes (93.6 MiB compressed / 279.9 MiB unpacked). SHA-256: `4A3147F7655D4088F07FF4552DB8373C52655EF4636B2064B23E3976D0024D2D`.
- Shared-Host regression checks used a synthetic local HTTP server and temporary lease: unpatched same-version Hosts are refused but remain alive; matching patches and explicitly external runtime mode retain their behavior.
- No paid inference, real-session resend, installed-extension replacement, user Host restart, NAS service or trading workspace was used. Real VS Code installation and real-provider behavior remain outside these synthetic checks.

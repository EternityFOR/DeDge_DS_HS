# DeDge DeepSeek Harness 0.1.92

## Security and reliability

- Local authenticated Gateway bootstrap, RPC, readiness checks, and WebSocket streaming now use an explicit direct loopback transport. Requests remain restricted to numeric `127.0.0.1`; RPC redirects are rejected so a Gateway cookie cannot be forwarded to another destination.
- The bundled Harness child-process environment scrub also filters variable names containing `PASSPHRASE` and `CREDENTIAL`, which the upstream name-based heuristic did not cover.
- Privacy documentation now describes the upstream `.env` fallback behavior and its trust boundary. Workspace `.env` files are not a security boundary against an Agent that has workspace tool access.
- The runtime smoke test now uses its own temporary workspace so it cannot accidentally load `.env` or write session data in the developer's checkout.

## Validation

- TypeScript typecheck, Vitest suite, Windows x64 runtime preparation and smoke test, release documentation audit, release-content audit, VSIX package audit, and package-content privacy scan.

## Upgrade note

The bundled Harness remains `0.1.5-rc.3`; this is an extension patch release. The update does not read or migrate user credentials, local `.env` files, or Codex/Claude transcripts.

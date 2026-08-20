# DeDge DeepSeek Harness for VS Code

[Chinese](README.md)

A self-contained DeepSeek Harness workbench for VS Code. Platform-specific VSIX packages bundle pinned versions of DeepSeek Harness, Node.js, and pnpm. Installation does not run `npm install`, `npx`, `pip`, or `git clone`, and the extension does not depend on the user's global Node.js installation, default shell, or PowerShell profile.

[Marketplace](https://marketplace.visualstudio.com/items?itemName=diractive-edge.dedge-deepseek-harness-vscode) | [GitHub Releases](https://github.com/EternityFOR/DeDge_DS_HS/releases) | [Changelog](CHANGELOG.md) | [Privacy](PRIVACY.md) | [Security](SECURITY.md) | [Support](SUPPORT.md)

> The current version is `0.1.5`. Release artifacts are primarily verified on Windows 10/11 x64. DeepSeek Harness remains a developer preview, so review the changelog and known limitations before upgrading.

## Highlights

- Native VS Code sidebar with multiple sessions, streaming answers, reasoning, tool calls, approvals, questions, cancellation, and context compaction.
- Dynamic model, reasoning-effort, and agent-preset catalogs supplied by the active Harness runtime.
- Attach files from Explorer, editors, tabs, drag-and-drop, paste, selections, diagnostics, or Git workspace changes.
- Session tabs, history, archive and delete actions, attachment chips, and a responsive two-row composer toolbar.
- Read-only Codex and Claude Code session discovery with isolated text handoffs between all three tools.
- Windows-safe process spawning with argument arrays and `shell: false`, avoiding a second PowerShell or cmd parsing pass.
- API keys stored only in VS Code SecretStorage. The local gateway listens on a random `127.0.0.1` port.

## Install

Search for **DeDge DeepSeek Harness** in VS Code Extensions and verify the publisher is `diractive-edge`.

For a pinned build, download the package matching the extension host platform from [GitHub Releases](https://github.com/EternityFOR/DeDge_DS_HS/releases), then choose **Extensions: Install from VSIX...**.

```powershell
code --install-extension .\dedge-deepseek-harness-vscode-0.1.5-win32-x64.vsix
```

Remote SSH, WSL, and Dev Containers use the remote extension host platform and architecture, not the local UI platform. Platform VSIX packages are not interchangeable.

## First Run

1. Open a trusted VS Code workspace backed by a real filesystem.
2. Run **DeepSeek Harness: Configure API Connection**.
3. Confirm the API base URL. The default is `https://api.deepseek.com/`; OpenAI-compatible or private sub2 endpoints are also supported.
4. Enter the API key. It is written to VS Code SecretStorage, not `settings.json`, the workspace, or extension logs.
5. Open **DeepSeek Harness** from the Activity Bar, create a session, and send a message.

The default permission mode is `workspace-write`. Use `danger-full-access` only when its wider filesystem and process authority is understood and required.

## Codex and Claude Handoffs

Cross-agent handoff is an isolated, read-only text workflow, not a bidirectional synchronization format:

```text
Codex / Claude / DeepSeek source session (read-only)
                         |
                         v
          handoff.json + handoff.md (extension storage)
                         |
                         v
        new unsent draft or new target CLI session
```

Loading a Codex or Claude session never writes to the source JSONL, index, configuration, or credentials. A new DeepSeek Harness session and unsent draft are created. The model receives that text only after the user reviews it and presses **Send**. Handoffs back to Codex or Claude start a new target CLI session and do not rewrite the original session format.

See [Session handoff](docs/session-handoff.md) for the full boundary.

## Supported Runtime

| Component | Pinned version |
| --- | --- |
| DeepSeek Harness | `0.1.0-rc.6` |
| Node.js | `22.22.3` |
| pnpm | `11.21.0` |

`0.1.0-rc.6` is the bundled upstream DeepSeek Harness version; it is separate from the extension version `0.1.5`.

The source and CI support native Windows x64, Linux x64, and macOS runners. Only packages explicitly attached to a GitHub Release or published to Marketplace are release artifacts.

## Privacy and Local Data

The extension does not implement analytics or telemetry. Prompts, attachments, and tool results are sent to the base URL selected by the user according to Harness behavior. Agent tools may independently access the network.

Release and VSIX audits reject common API-key and token formats, credential-bearing URLs, session dumps, machine-local paths, private keys, and other private build artifacts. API keys remain in VS Code SecretStorage and are not bundled into source, `dist`, or VSIX packages.

Persistent extension data lives under VS Code `globalStorage`, including isolated Harness homes, generated runtime overlays, logs, temporary compatibility probes, snapshots, and handoff packages. Use **DeepSeek Harness: Clear API Key** to remove the SecretStorage entry.

See [PRIVACY.md](PRIVACY.md) for retention and cleanup details.

## Windows Notes

Harness processes are launched with `spawn(..., { shell: false, windowsHide: true })`. The extension does not compose a PowerShell command line. If startup, Unicode paths, long paths, or shutdown fail:

1. Run **DeepSeek Harness: Diagnose Environment**.
2. Open **Output > DeepSeek Harness**.
3. Confirm that the installed VSIX target matches the extension host.
4. Check whether endpoint, proxy, certificate, or endpoint-security policy blocks the bundled Node.js process.
5. Remove workspace paths, file contents, session text, and other private data before filing an issue.

See [Compatibility](docs/compatibility.md) and [Support](SUPPORT.md).

## Development

```powershell
corepack pnpm@11.21.0 install --frozen-lockfile
corepack pnpm@11.21.0 run audit:release
corepack pnpm@11.21.0 run typecheck
corepack pnpm@11.21.0 test
corepack pnpm@11.21.0 run build
corepack pnpm@11.21.0 run prepare:runtime
corepack pnpm@11.21.0 run smoke:runtime
corepack pnpm@11.21.0 run package:platform
```

Do not commit `dist/`, `out/`, runtime staging, logs, local sessions, handoff payloads, `.env` files, `.npmrc`, credentials, or private user data. See [CONTRIBUTING.md](CONTRIBUTING.md) and [Release process](docs/RELEASING.md).

## License

The extension source is licensed under MIT. Bundled third-party components retain their own licenses. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) and `licenses/`.

DeepSeek Harness, DeepSeek, Codex, OpenAI, Claude, and Anthropic are third-party products or marks. This project is an independent integration and is not an official extension from those providers.

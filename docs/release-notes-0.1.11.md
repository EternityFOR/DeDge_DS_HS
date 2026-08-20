# DeDge DeepSeek Harness v0.1.11

This release improves the composer layout and makes long sessions easier to browse without exposing credentials or local session data.

## Highlights

- Inline settings for DeepSeek and Vision URL, model, and API keys. Secrets stay in VS Code SecretStorage.
- Small Vision model picker beside the active Harness model, with OpenAI-compatible `/models` discovery when available.
- Older history pages load as the conversation is scrolled to the top, preserving scroll position.
- Horizontal input resize handle with upward drag semantics.
- Task-level folding keeps the first user prompt and final response visible while grouping reasoning, tool calls, and inserted messages.
- Dedicated Git working-tree change review button.
- Default long-paste file threshold reduced to 4 KiB.

## Compatibility

- Bundled DeepSeek Harness: `0.1.0-rc.7`
- Primary verification target: Windows 10/11 x64
- No API keys, local Codex/Claude sessions, logs, or private files are included in the VSIX.

## Release Asset

| Asset | Target | Size | SHA-256 |
| --- | --- | ---: | --- |
| `dedge-deepseek-harness-vscode-0.1.11-win32-x64.vsix` | `win32-x64` | `76,820,835 bytes (73.3 MiB)` | `4AA5BA96673A45EEED408B5F875246BF8FFFC086C2DC8252717FF5DDF238A905` |

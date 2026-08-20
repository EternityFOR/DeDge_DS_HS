# DeDge DeepSeek Harness v0.1.9

0.1.9 插队发送增加"排队中"提示条，交接文案改为剪贴板优先。

## Highlights

- 插队（steer）发送后，输入框正上方显示提示条：`Steer message queued - it will be delivered after the current reasoning or tool step finishes.`；消息真正进入会话历史后自动消失，也可手动关闭。
- 交接目标菜单和历史菜单的 handoff 文案更新：`Copy a take-over prompt to the clipboard, or launch the CLI`，并说明原会话不受影响。

## Verification

- 71 automated tests
- TypeScript typecheck
- Production bundle
- Documentation and release safety audits
- Playwright：提示条显示、位置、投递后自动消失全部通过

## Release Asset

| Asset | Target | Size | SHA-256 |
| --- | --- | ---: | --- |
| `dedge-deepseek-harness-vscode-0.1.9-win32-x64.vsix` | `win32-x64` | `76,815,140 bytes (73.3 MiB)` | `FCAB1150FB3272155EEAA6568AA25B6231E30D547E1D324C5938FC410CD097F1` |

# DeDge DeepSeek Harness v0.1.3

0.1.3 修复权限切换、停止响应和跨平台 handoff 在 VS Code 重启后丢失的问题。

## Highlights

- 当前权限以 Harness session 的官方 `permissions` projection 为准，切换后会重新读取并校验。
- 停止请求等待真实 idle 状态，并在事件丢失时主动查询，避免 UI 卡在停止中。
- Codex/Claude 导入的未发送草稿和 handoff 附件持久化到 VS Code workspace state，重启后自动恢复。
- Full access 增加风险确认；workspace-write 说明 Windows 外部工具可能需要一次性审批升级。

## Verification

- 69 automated tests
- TypeScript typecheck
- Production bundle
- Documentation and release safety audits
- Playwright UI preview verification

## Release Asset

| Asset | Target | Size | SHA-256 |
| --- | --- | ---: | --- |
| `dedge-deepseek-harness-vscode-0.1.3-win32-x64.vsix` | `win32-x64` | `77,255,100 bytes (73.7 MiB)` | `FDAE5468DE0AA11FA8A587970041C2FBBAA79F1CDF363EA46D4068820FB4530E` |

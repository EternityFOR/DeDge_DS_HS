# DeDge DeepSeek Harness v0.1.1

0.1.1 是首个公开预览版本，重点解决“安装后仍要在用户电脑上临时装 Harness”以及 Windows/PowerShell 不稳定的问题。Windows 10/11 x64 是本次完整验证目标。

## Highlights

- 自包含 win32-x64 VSIX：固定 DeepSeek Harness、Node.js 和 pnpm，激活时不下载依赖。
- 原生 VS Code 侧边栏：多会话、流式回复、reasoning、工具、审批、附件、取消和上下文压缩。
- Windows 安全启动：参数数组、shell: false、隐藏子进程、PowerShell/UTF-8/Unicode/长路径诊断和进程树清理。
- Codex / Claude Code 只读交接：导入只生成新的 Harness 会话和未发送草稿，不修改源平台 session。
- 顶部 session tabs、窄窗口双行工具栏、视口内菜单、紧凑交接附件，以及删除/归档/停止互斥。
- API Base URL 可配置，默认 DeepSeek 官方地址；Key 只进入 VS Code SecretStorage。

## Install

下载并安装：

~~~text
dedge-deepseek-harness-vscode-0.1.1-win32-x64.vsix
~~~

在 VS Code 扩展视图选择 **Install from VSIX...**。Remote SSH、WSL 或 Dev Container 用户需要与远端 extension host 匹配的独立 target 产物。

## Isolation Guarantee

载入 Codex/Claude 会话不会向原始 JSONL、索引或配置写入内容，也不会自动开始 reasoning。只有用户检查未发送草稿并按 **Send** 后，交接文本才会发往当前配置的模型 endpoint。返回原平台时可恢复原会话，或另建一次交接携带处理结果。

## Known Limitations

- DeepSeek Harness 上游仍处于 developer preview。
- 本次完整发布验证只覆盖 Windows x64；其他 target 必须使用原生 runner 单独构建和验证。
- 自定义 endpoint/preset 可能不提供完整的模型目录、token pressure 或压缩能力。
- Claude Code 会话发现依赖只读本地格式；Codex 的 JSONL 路径仅在官方 app-server 不可用时作为回退。
- 升级 DSH 版本会使用新的隔离 home，不自动迁移旧版本会话。

## Verification

- Release safety audit
- TypeScript typecheck
- 55 automated tests
- Production bundle
- Bundled runtime smoke
- VSIX native/runtime/license/content audit
- 240px、320px、420px 和常规宽度 UI verification

## Release Asset

| Asset | Target | Size | SHA-256 |
| --- | --- | ---: | --- |
| `dedge-deepseek-harness-vscode-0.1.1-win32-x64.vsix` | `win32-x64` | 77,273,690 bytes (73.7 MiB) | `978A430BACBD86A12264565459047D78F476C482E58299F02587162B3E173D86` |

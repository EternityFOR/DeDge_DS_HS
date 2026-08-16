# Changelog

本文档遵循 [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)，版本号遵循 [Semantic Versioning](https://semver.org/spec/v2.0.0.html)。

## [Unreleased]

- 暂无未发布变更。

## [0.1.1] - 2026-08-16

首个公开预览版本，面向 VS Code 的 DeepSeek Harness 原生工作台。上游 Harness 仍处于 developer preview，本版本优先保证可重复安装、Windows 进程边界和跨平台交接的数据隔离。

### Added

- 原生侧边栏工作台：多会话、流式回复、reasoning、工具状态、审批、问题表单、取消、归档和删除。
- 平台专用 VSIX，固定 `@deepseek-ai/dsh@0.1.0-rc.6`、Node.js `22.22.3` 和 pnpm `11.21.0`；激活阶段不安装依赖。
- `SecretStorage` API Key、版本隔离的 `DSH_HOME`、随机 loopback Gateway 端口和进程树清理。
- 编辑器选区、文件、诊断、Git change review，以及 Explorer/编辑器/标签页右键文件附件和输入框拖放/粘贴。
- Host 驱动的模型、reasoning effort、Agent Preset 目录和按 `rpcId` 原子提交的问题表单。
- 上下文占用环、悬停 token 明细、默认 1M 且可配置的上下文窗口、空闲手动压缩和固定 preset 的自动压缩策略。
- Codex、Claude Code 与 DeepSeek Harness 之间的只读、独立文本交接包；外部会话导入只生成新的未发送草稿。
- 标题栏会话 tabs、完整历史选择器、模型菜单视口定位、小尺寸 Lucide 图标和窄窗口稳定的双行工具栏。
- DeepSeek 官方 Base URL、自定义 OpenAI-compatible/sub2 endpoint，以及不依赖 PowerShell/cmd 拼接的 Windows 启动与诊断。
- Node.js 官方完整许可证固定副本、VSIX native binary/许可证审计、跨平台单元测试、CI 和发布维护文档。

### Changed

- 公开发布边界改为固定版本运行时、显式 external 路径和集中式临时目录；不再依赖 PATH、全局 npm 或自动下载。
- Codex 会话发现优先使用官方 app-server 的当前 provider、Active 根会话和官方重命名/recency；只读 JSONL 仅作为严格过滤的回退。
- 历史中的交接正文和 editor context 改为紧凑附件条；完整恢复路径写入输出日志，界面只显示短状态。
- 上下文配置按钮同时说明容量与自动压缩基数，手动压缩按钮仅在代理空闲且能力可用时启用。

### Fixed

- 构建不再清空已准备好的 `dist/runtime`，避免 Windows 大文件或硬链接删除争用。
- 相同 question id 出现在不同请求批次时不再互相覆盖。
- 删除、归档和停止操作增加会话级互斥与即时忙碌状态，防止延迟期间重复提交。
- Codex/Claude 载入不再自动启动 reasoning；停止响应必须收到官方 `{ accepted: true }` 确认。
- Codex rollout 不再跨 session ID 合并，并排除 archived、subagent、guardian、exec、MCP 和未知内部来源。
- 420px 及以下输入区不再让权限、压缩、模型和发送控件互相覆盖；模型/思考深度菜单保持在可视区域内。
- 扩展版本提升到 `0.1.1`，避免同版本 VSIX 缓存更新难以判断。

### Security

- API Key 不进入设置、日志、工作区、交接包或生成 overlay，只通过 VS Code `SecretStorage` 注入本地进程。
- Gateway 固定监听随机 `127.0.0.1`，子进程使用参数数组、`shell: false` 和 `windowsHide: true`。
- 发布审计拒绝 session dump、私钥、常见 provider token、绝对本机路径、Mojibake 和开发期文件进入公开源或 VSIX。

[Unreleased]: https://github.com/EternityFOR/DeDge_DS_HS/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/EternityFOR/DeDge_DS_HS/releases/tag/v0.1.1

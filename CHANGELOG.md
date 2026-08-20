# Changelog

本文档遵循 [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)，版本号遵循 [Semantic Versioning](https://semver.org/spec/v2.0.0.html)。

## [Unreleased]

## [0.1.4] - 2026-08-20

### Fixed

- 修复长时间思考或大量输出导致的 Webview 卡死、UI 变形和输出期间无法调整窗口大小的问题：
  - 会话消息改为增量渲染：只重建实际变化的单条消息，不再在每次流式更新时重绘整段对话并重新解析全部 Markdown。
  - 流式输出中的消息以纯文本渲染（带光标指示），仅在完成后执行一次 Markdown 渲染，避免输出长度增长带来的二次方解析开销。
  - 渲染按动画帧合并，扩展宿主与控制器对状态推送做节流，减少高频流式事件下的 IPC 与快照开销。
  - 流式期间保留用户手动展开/折叠的 Reasoning/Tool 区块；Reasoning 流结束后仍会自动收起。
  - 动态图标改为直接创建 SVG，不再在每次渲染时全文档扫描重建图标。
- 滚动条不再跟随输出：输出过程中可以自由向上翻阅历史，只有停留在底部时才自动跟随；滚离底部时显示「跳到底部」按钮。
- 每条消息（用户/助手/系统）新增折叠按钮，折叠后只保留一行预览；Reasoning/Tool 区块显示旋转箭头，手动折叠状态在流式更新期间保持不变。
- 点击发送后输入框焦点不再丢失，光标和删除键在输出过程中保持可用。
- 输入框支持按 ↑/↓ 浏览之前发送过的内容（空输入或正在浏览历史时生效），重新编辑会自动退出历史浏览。

## [0.1.3] - 2026-08-20

### Fixed

- 权限菜单读取当前 Harness session 的官方 `permissions` projection，切换后重新校验实际生效值，并在切换期间锁定相关控件。
- 停止请求等待 Harness 的实际 idle 状态；事件丢失时主动回查，避免按钮永久停留在“停止中”。
- Codex/Claude 导入的未发送草稿和 handoff 附件保存到 VS Code workspace state，重启窗口后自动恢复。
- Full access 切换增加确认；workspace-write 在 Windows 下明确提示外部工具可能需要一次性 sandbox approval。

## [0.1.2] - 2026-08-17

### Added

- 发布本机 loopback Gateway lease，供 DeDge Orbit 在不读取 API Key 的前提下连接现有 DeepSeek Harness 运行时。

### Changed

- Runtime 停止或异常退出时按进程所有权清理 lease，避免多窗口清理掉其他仍存活实例的地址。
- 平台运行时打包会整体移除 `.bin` 开发 shim，避免无效 Node 启动器进入 VSIX。

### Fixed

- 模型目录加载期间禁用模型、思考深度和发送控件；运行时、活动会话或模型目录未就绪时，前端与扩展宿主都会拒绝提交。
- 移除运行时就绪后自动补发旧草稿的行为，避免选择模型或思考深度后意外发送输入框内容。
- 草稿和附件仅在 Gateway 明确接受请求后清空；拒绝或失败时保留，便于检查后重试。

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

- Model and reasoning controls remain disabled while their catalog loads; prompt submission is rejected until the runtime, active session, and model catalog are ready.
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

[Unreleased]: https://github.com/EternityFOR/DeDge_DS_HS/compare/v0.1.3...HEAD
[0.1.3]: https://github.com/EternityFOR/DeDge_DS_HS/releases/tag/v0.1.3
[0.1.2]: https://github.com/EternityFOR/DeDge_DS_HS/releases/tag/v0.1.2
[0.1.1]: https://github.com/EternityFOR/DeDge_DS_HS/releases/tag/v0.1.1

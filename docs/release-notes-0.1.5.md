# DeDge DeepSeek Harness v0.1.5

0.1.5 修复底部图标显示问题，新增 Skill 引用、图片识别、思考紧凑模式、按轮次折叠、插队发送与剪贴板交接。

## Highlights

- 修复静态按钮图标（发送、附加、权限、模型、压缩等）不显示的问题。
- 输入框输入 `@` 弹出 Skill 列表：目录可配置（默认 `~/.codex/skills`），发送时自动附带 SKILL.md 正文。
- 图片附件发送前调用可配置的 OpenAI 兼容视觉模型生成描述，DeepSeek 纯文本模型因此可以"看见"图片。
- 思考过程紧凑模式：Reasoning/Tool 默认折叠为摘要行（如 `Reasoning · 12K chars`），流式期间不自动展开。
- 按轮次折叠：用户消息头部可折叠整轮回复，流式更新期间保持折叠状态。
- 回复进行中可插队发送（官方 `session.prompt` 的 steer 模式），模型立即处理新指令。
- 交接到 Codex/Claude 默认不再启动 CLI：接手 prompt 复制到剪贴板，在 VS Code 扩展里新建会话粘贴即可。
- 从 Codex/Claude 导入的会话自动命名为 `平台: 原会话名`。
- 会话列表为空时等待运行时恢复历史会话，避免每次重启都出现新的 `New session`。

## 官方行为确认

- `agentPreset.select` 在会话开始后返回 `agent-preset-locked`：同一会话不能切换 Agent Preset 是官方协议行为。
- `session.prompt` 支持 `mode: queue | steer`；`session.rename` 可重命名会话；`session.cancel` 停止当前回复。

## Verification

- 71 automated tests
- TypeScript typecheck
- Production bundle
- Documentation and release safety audits
- Playwright UI verification：图标、按轮折叠、紧凑模式、Skill 弹层、插队发送、滚动行为全部通过

## Release Asset

| Asset | Target | Size | SHA-256 |
| --- | --- | ---: | --- |
| `dedge-deepseek-harness-vscode-0.1.5-win32-x64.vsix` | `win32-x64` | `77,264,023 bytes (73.7 MiB)` | `6A3EDE78ABF5E6CA68AB1945F8C52E3AB5CAFF1AC5D22D76648FD8E0BDEB8E77` |

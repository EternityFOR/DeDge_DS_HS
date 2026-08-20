# DeDge DeepSeek Harness v0.1.10

0.1.10 修复长 reasoning 输出造成的 Webview 卡顿、任务折叠、rc.7 版本误报、空会话占位和图片粘贴配置时机问题。

## Highlights

- 完成任务默认保留首条用户消息和最终答复；中间 reasoning、工具、阶段性回复和插队消息统一折叠，可随时展开。
- 流式快照合并刷新、惰性详情渲染和有界可视投影降低长思考期间的 DOM 与主线程压力；输入框支持手动纵向调整。
- 内置 Harness 版本校验与实际依赖统一为官方 `0.1.0-rc.7`。
- 已开始会话切换 Agent Preset 时创建隔离的新会话并附带有长度上限的文本交接，不修改原会话。
- 图片粘贴或拖入时立即检查 Vision endpoint、model 和 SecretStorage key；无活动会话时直接发送会自动创建会话。

## Verification

- 74 automated tests
- TypeScript typecheck
- Production bundle
- Documentation and release safety audits
- Playwright responsive layout and task-fold verification

## Release Asset

| Asset | Target | Size | SHA-256 |
| --- | --- | ---: | --- |
| `dedge-deepseek-harness-vscode-0.1.10-win32-x64.vsix` | `win32-x64` | `76,816,843 bytes (73.3 MiB)` | `B62168FE32DE4D67827D13A50A887079310D726B70BDDC7C0F68A7F9C3E634B4` |

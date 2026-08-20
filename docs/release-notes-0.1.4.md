# DeDge DeepSeek Harness v0.1.4

0.1.4 修复长时间思考或大量输出导致的 Webview 卡死与 UI 变形，并改进输出期间的阅读体验和输入体验。

## Highlights

- 会话消息增量渲染：流式更新只重建实际变化的单条消息，不再整段重绘并重新解析全部 Markdown。
- 流式输出以纯文本渲染（带光标指示），完成后才执行一次 Markdown 渲染；渲染按动画帧合并，宿主与控制器节流推送。
- 滚动条不再跟随输出：输出过程中可自由翻阅历史，仅在停留在底部时自动跟随；滚离底部时显示「跳到底部」按钮。
- 每条消息（用户/助手/系统）可折叠为单行预览；Reasoning/Tool 区块带旋转箭头，手动折叠状态在流式更新期间保留。
- 点击发送后输入框焦点不丢失，光标与删除键在输出过程中保持可用。
- 输入框支持 ↑/↓ 浏览之前发送过的内容，重新编辑自动退出历史浏览。

## Verification

- 69 automated tests
- TypeScript typecheck
- Production bundle
- Documentation and release safety audits
- Playwright UI verification：400 次流式更新约 73ms 处理、最大帧间隔 33ms；滚动、折叠、焦点、输入历史全部通过；270KB Markdown 完成渲染一次性约 430ms

## Release Asset

| Asset | Target | Size | SHA-256 |
| --- | --- | ---: | --- |
| `dedge-deepseek-harness-vscode-0.1.4-win32-x64.vsix` | `win32-x64` | `77,258,347 bytes (73.7 MiB)` | `3B2F17B065A630FE6B15CAB5F8FF3C4E06F881A6BB8F60B3041DF8E1F67CFA92` |

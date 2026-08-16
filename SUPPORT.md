# Support

## Before Opening an Issue

1. 确认 VS Code 版本不低于 1.96.0。
2. 确认 VSIX target 与实际 extension host 匹配。Remote SSH、WSL 和 Dev Container 看远端平台。
3. 运行 **DeepSeek Harness: Diagnose Environment**。
4. 打开 **Output > DeepSeek Harness**，记录最短的相关错误段。
5. 检查 [已知限制](README.md#已知限制) 和 [兼容性说明](docs/compatibility.md)。
6. 在最小、非敏感工作区中复现。

## Common Problems

### Workbench does not start

- 打开受信任且有真实文件系统的工作区。
- 保持 dedgeDeepSeekHarness.runtime.mode=bundled，除非明确维护 external runtime。
- 确认安装了正确平台的 VSIX。
- Windows 上检查 endpoint protection 是否阻止 VSIX 内置 Node 子进程。

### API request fails

- 运行 **DeepSeek Harness: Configure API Connection**，先确认 Base URL，再重新输入 Key。
- DeepSeek 官方地址使用 https://api.deepseek.com/。
- 自定义 endpoint 必须与当前 Harness provider adapter 兼容；反向代理、证书和模型名由 endpoint 运营者负责。
- 不要把 Key 放进 issue、截图、日志或 settings.json。

### PowerShell or path warning

Harness 启动本身不依赖 PowerShell 拼接。探针警告表示后续代理工具可能遇到 PowerShell 语言模式、编码、长路径或 junction 限制。优先安装 PowerShell 7，并用更短的非同步盘路径做最小复现。

### Codex / Claude session is missing

- 会话列表只在用户打开选择器时刷新，不做后台轮询。
- Codex 默认只显示当前 provider 的 Active 交互式根会话，不显示 archived、subagent 或内部会话。
- 检查 handoff.codexHome / handoff.claudeHome，自定义 CLI 在 Windows 上必须是绝对原生 .exe。
- 载入后只创建未发送草稿，不会自动回复；这是隔离设计。

### Stop or delete appears delayed

会话和停止操作有互斥锁。按钮进入忙碌状态后不要重复触发。仍未完成时打开输出日志，记录操作类型和错误码，不要附带完整会话内容。

## Opening an Issue

使用 [Bug report](https://github.com/EternityFOR/DeDge_DS_HS/issues/new/choose)，并提供：

- 扩展版本、VS Code 版本、操作系统和架构；
- local / SSH / WSL / Dev Container 环境；
- bundled 或 external runtime；
- 可复现的最小步骤；
- 已脱敏的诊断摘要和相关错误码；
- 是否能在空工作区复现。

不要附加 API Key、环境变量、完整日志、会话 JSONL、交接包、工作区源码、用户目录截图或内部 URL。安全问题请改用 [私密漏洞报告](SECURITY.md)。

功能建议使用 [Feature request](https://github.com/EternityFOR/DeDge_DS_HS/issues/new/choose)。上游 Harness 行为问题可能会被转交到 [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)。

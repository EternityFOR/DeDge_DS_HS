# Privacy

本说明适用于 DeDge DeepSeek Harness VS Code 扩展本身。VS Code、DeepSeek Harness、用户选择的模型 endpoint、Codex、Claude Code 以及代理调用的外部工具有各自的隐私政策和数据处理边界。

## 数据流

| 数据 | 存放或发送位置 | 何时发生 |
| --- | --- | --- |
| DeepSeek API Key | VS Code SecretStorage | 用户配置连接时 |
| API Base URL | VS Code machine-scoped settings | 用户确认或修改连接时 |
| 提示词、附件、模型回复、工具结果 | 版本隔离的本地 Harness 状态；按 Harness 协议发送到所选 Base URL | 用户主动发送消息或批准工具操作时 |
| Harness 会话 | globalStorage/harness-homes/&lt;version&gt;/ | 创建或继续 Harness 会话时 |
| 诊断日志 | 扩展输出通道及 globalStorage/logs/ | 运行、诊断或失败时 |
| Git diff 基线 | globalStorage/snapshots/ | 用户请求 workspace change review 时 |
| Codex / Claude 会话文本副本 | globalStorage/handoffs/&lt;handoff-id&gt;/ | 用户主动创建或载入交接时 |
| 一次性兼容性探针 | globalStorage/tmp/ | 启动前诊断时 |

扩展不把 API Key 写入 settings.json、工作区、日志、交接包或生成配置。Key 仅在启动本地 Harness 子进程时作为进程环境注入。

## 模型请求

用户按 **Send** 后，提示词、选中的附件、交接文本和对话上下文会发送到 dedgeDeepSeekHarness.baseUrl 指向的服务。默认是 https://api.deepseek.com/，用户也可配置自建 OpenAI-compatible/sub2 endpoint。

扩展无法控制自定义 endpoint 如何存储或使用请求内容。使用第三方 endpoint 前，应确认其运营者、日志策略、传输安全和数据保留政策。代理执行的命令、MCP 或其他工具也可能访问网络或读取工作区文件，具体行为受当前权限和用户审批约束。

## Codex 与 Claude Code

外部会话发现是按用户操作触发的只读流程：

- Codex 优先调用官方 codex app-server --stdio 的列表请求；不可用时才读取严格过滤的本地 JSONL。
- Claude Code 只读扫描其本地项目会话文件。
- 只提取有长度上限的顶层 user/assistant 可见文本；Key、Token、环境变量、thinking、工具内部状态和配置不会进入交接包。
- 源平台文件不会被修改。载入 DeepSeek Harness 后创建独立会话和未发送草稿。

用户发送载入的草稿后，交接文本会进入当前模型请求。请在发送前检查交接附件。

## 遥测

本扩展代码不实现产品分析、广告标识、崩溃上传或自定义遥测服务。VS Code、本地 Harness、所选模型服务和外部工具可能具有各自的遥测行为，本说明不代表这些第三方组件。

## 日志与问题报告

扩展日志设计上不记录 API Key 或 Authorization header，但可能包含：

- 工作区路径和文件名；
- runtime 版本、平台和退出码；
- 会话 ID、模型名和状态；
- 经过边界处理的错误信息。

公开提交问题前，请删除用户名、绝对路径、文件内容、会话文本、内部 URL、主机名和任何凭据。不要上传完整的 .codex、.claude、Harness home、globalStorage 或 VS Code profile。

## 删除数据

1. 运行 **DeepSeek Harness: Stop Runtime**。
2. 运行 **DeepSeek Harness: Clear API Key** 清除 SecretStorage 凭据。
3. 按需删除扩展 globalStorage 中的 handoffs/、tmp/、snapshots/、logs/ 或 harness-homes/。
4. 卸载扩展。

删除 harness-homes/ 会永久移除对应版本的本地 Harness 会话。卸载扩展本身不保证 VS Code 自动删除所有 global storage。

## 发布包隐私门禁

源码发布和 VSIX 打包前执行 pnpm run audit:release 与 pnpm run audit:package。门禁会拒绝常见私钥/Token、session dump、个人绝对路径、临时目录和开发期文件，并且只报告命中的文件与规则，不回显疑似秘密。

隐私或安全问题请使用 [GitHub 私密漏洞报告](https://github.com/EternityFOR/DeDge_DS_HS/security/advisories/new)，不要在公开 issue 中提供敏感材料。

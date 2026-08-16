# 隔离会话交接

## 目标

扩展允许 DeepSeek Harness、Codex 和 Claude Code 各自保持独立会话，同时把一个会话的可见文本交给另一个平台新建会话继续处理。该能力不是原生会话同步器，也不会把一种平台的 JSONL、数据库或配置写进另一种平台的数据目录。

```text
Codex / Claude local session (read-only)
                 |
                 v
       Canonical handoff package
       handoff.json + handoff.md
                 |
                 v
DeepSeek Harness unsent draft / Codex / Claude new session
```

交接包统一存放在 VS Code 分配给本扩展的 `globalStorage/handoffs/<handoff-id>/`。DeepSeek Harness 会创建新的 Harness session，把交接 Markdown 作为附件装入输入区，并填入一段未发送草稿；只有用户检查后主动按 Send 才开始模型 turn。Codex 和 Claude Code 使用原生可执行文件在新的 VS Code terminal 中启动。源会话始终保持只读。

## 支持的路径

- 当前 DeepSeek Harness 会话 -> 新 Codex 会话或新 Claude Code 会话。
- 本机 Codex 会话 -> 新 DeepSeek Harness 会话或新 Claude Code 会话。
- 本机 Claude Code 会话 -> 新 DeepSeek Harness 会话或新 Codex 会话。
- 从目标平台返回时，再把该平台的会话作为新源执行一次交接；不会回写最初的会话历史。

标题栏 `Select DeepSeek Harness session` 列表分为 `DeepSeek Harness sessions` 与 `Load or hand off` 两组，可直接载入 Codex/Claude，或把当前 DSH 会话交给另一端。输入区“添加上下文”菜单中的 `Load or hand off session` 和命令 `DeepSeek Harness: Hand Off Session` 保留完整的任意源/目标流程。首次载入 Codex 或 Claude Code 时会显示只读隔离确认。会话列表只在用户打开时刷新，不做后台轮询，也不会长期占用三个 CLI 进程。

载入外部会话后不会自动生成 reasoning 或回复。用户按 Send 后，完整交接文本仍作为模型上下文提交，但工作台历史只显示紧凑的交接附件条和用户指令，不再展开整份 transcript；旧版本已经写入历史的交接正文也会按同一规则折叠显示。后续回复和工具记录只写入新建的 DeepSeek Harness session。原 Codex/Claude JSONL、索引和配置从不写入。临时处理结束后有两种返回方式：

- 在原生 Codex 使用 `/resume`（或 `codex resume`）、在 Claude Code 使用 `--resume`，可回到完全未改动的原会话；工作区文件变更仍会由原生 agent 重新检查。
- 若需要把 DeepSeek 阶段的对话摘要一并带回，重新执行交接并选择 Codex 或 Claude Code；扩展会启动一个新的目标会话，仍不回写最初会话。

## 数据边界

只提取顶层 user/assistant 文本：

- Codex：优先直接启动官方原生 `codex app-server --stdio`，用与官方 VS Code 历史页一致的 `thread/list` 参数读取当前 provider、Active、交互式根会话，并采用 app-server 返回的最新名称和 `recency_at` 顺序。该查询不经过 PowerShell，也不调用 archive、resume 或写入接口。若官方二进制或协议不可用，才只读扫描 `sessions/**/*.jsonl`；回退路径明确排除 `archived_sessions/`、subagent、guardian、exec、MCP 和未知内部来源，并用 `session_index.jsonl` 的最新重命名。
- Claude Code：读取 `projects/**/*.jsonl` 中非 sidechain 的 user/assistant 文本块；忽略 thinking 和工具结果。
- DeepSeek Harness：使用当前工作台已经投影出的 user/assistant 消息，不复制 reasoning 或工具记录。

一个原生 session 本来就包含多轮对话；交接会保留该 session 最近的多轮 user/assistant 文本，而不是把每一轮误判为独立会话。同一 Codex rollout 可重复记录相同 ID 的 `session_meta`；若检测到不同 ID，导入会拒绝合并。读取超大 rollout 时最多扫描末尾 32 MiB，交接文本上限仍为 64 KiB 并优先保留最近内容。Key、Token、环境变量、原生配置和内部状态不进入交接包。交接包属于用户主动生成的持久上下文，可在停止运行时后删除整个 `globalStorage/handoffs/` 清理。

## 配置

| 设置 | 默认值 | 说明 |
| --- | --- | --- |
| `dedgeDeepSeekHarness.handoff.codexHome` | `${userHome}/.codex` | Codex 会话只读发现目录；Windows 通常解析为 `C:\Users\<you>\.codex` |
| `dedgeDeepSeekHarness.handoff.claudeHome` | `${userHome}/.claude` | Claude Code 会话只读发现目录 |
| `dedgeDeepSeekHarness.handoff.codexCommand` | 空 | 可选的 Codex 原生可执行文件绝对路径 |
| `dedgeDeepSeekHarness.handoff.claudeCommand` | 空 | 可选的 Claude Code 原生可执行文件绝对路径 |
| `dedgeDeepSeekHarness.handoff.maxBytes` | `65536` | 交接文本 UTF-8 字节上限 |

Windows 自动发现优先使用已安装的官方 VS Code 扩展原生二进制，其次查找官方 npm 包中的原生二进制和 PATH 中的 `.exe`。历史查询通过 Node `spawn` 直接调用 `codex app-server --stdio`；交接目标通过 `createTerminal` 的 `shellPath` 和参数数组启动。两条路径都不拼接 PowerShell/cmd 命令，Windows 自定义命令必须指向 `.exe`。

## 兼容边界

DeepSeek 官方 Codex 集成使用 Responses API，官方 provider 示例的 `base_url` 为 `https://api.deepseek.com/`；Claude Code 集成的 Anthropic-compatible 地址为 `https://api.deepseek.com/anthropic`。这些模型接入方式不是跨产品会话协议：

- [DeepSeek API: Codex](https://api-docs.deepseek.com/quick_start/agent_integrations/codex/)
- [DeepSeek API: Claude Code](https://api-docs.deepseek.com/quick_start/agent_integrations/claude_code)

OpenAI 官方文档说明 `/rename` 更新保存名称但不改变 transcript，`/resume` 重载原 transcript，`/fork` 则以新 ID 克隆并保留原会话：[Codex developer commands](https://learn.chatgpt.com/docs/developer-commands?surface=cli#cli-codex-resume)。2026-08-16 本机验证的 Codex CLI `0.145.0` 支持新会话、`resume` 和 `fork`，Claude Code `2.1.233` 支持 `--resume` 与 `--fork-session`。本实现只用官方 app-server 的列表请求和新会话入口；本地 JSONL 与 `session_index.jsonl` 仅是防御性只读回退，不视为稳定公开 API。升级上游后必须运行 handoff parser 测试并做真实只读发现验证。

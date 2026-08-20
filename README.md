# DeDge DeepSeek Harness for VS Code

[English](README.en.md)

一个自包含的 DeepSeek Harness VS Code 工作台。扩展把固定版本的 Harness、Node.js 和 pnpm 一起放进平台专用 VSIX，安装后不会再运行 `npm install`、`npx`、`pip` 或 `git clone`，也不依赖用户的全局 Node、默认 shell 或 PowerShell profile。

[Marketplace](https://marketplace.visualstudio.com/items?itemName=diractive-edge.dedge-deepseek-harness-vscode) · [GitHub Releases](https://github.com/EternityFOR/DeDge_DS_HS/releases) · [Changelog](CHANGELOG.md) · [隐私](PRIVACY.md) · [安全](SECURITY.md) · [支持](SUPPORT.md)

> 当前版本为 `0.1.5`。发布产物优先验证 Windows 10/11 x64；DeepSeek Harness 上游仍处于 developer preview，升级前请阅读变更日志和已知限制。

## 主要能力

- 在原生 VS Code 侧边栏中完成多会话聊天、流式回复、reasoning、工具调用、审批、问题表单、取消和压缩。
- 模型、reasoning effort 和 Agent Preset 从当前 Harness 动态读取，不维护容易失效的硬编码模型清单。
- 支持从 Explorer、编辑器正文、标签页右键菜单、拖放或粘贴附加文件，也可附加选区、诊断和 Git 工作区变更。
- 顶部会话 tabs、会话归档/删除、紧凑附件展示，以及窄侧边栏下稳定的双行输入工具栏。
- 上下文占用由 Harness 的 `contextPressure` 数据驱动；支持查看 token 压力、调整上下文容量和在空闲时手动压缩。
- 只读载入本机 Codex、Claude Code 会话，并通过隔离文本交接在三个平台之间继续工作。
- Windows 进程使用参数数组和 `shell: false` 启动，避免把路径、参数或提示词交给 PowerShell/cmd 二次解析。
- API Key 只保存在 VS Code `SecretStorage`；Gateway 只监听随机的 `127.0.0.1` 端口。
- Runtime 就绪时发布不含凭据的本机 lease，供 DeDge Orbit 复用同一个 Gateway；退出时只清理属于当前进程的 lease。

## 安装

### 从 Marketplace 安装

在 VS Code 扩展视图搜索 **DeDge DeepSeek Harness**，确认 publisher 为 `diractive-edge` 后安装。Marketplace 尚未上架或需要固定版本时，请使用 GitHub Release 中的 VSIX。

### 从 VSIX 安装

1. 从 [GitHub Releases](https://github.com/EternityFOR/DeDge_DS_HS/releases) 下载与 extension host 匹配的文件，例如 `dedge-deepseek-harness-vscode-0.1.5-win32-x64.vsix`。
2. 在 VS Code 扩展视图右上角菜单选择 **Install from VSIX...**。
3. 安装完成后按 VS Code 提示重新加载窗口。

也可以显式安装：

```powershell
code --install-extension .\dedge-deepseek-harness-vscode-0.1.5-win32-x64.vsix
```

Remote SSH、WSL 和 Dev Container 使用远端 extension host 的操作系统与架构，不是本地 UI 的平台。平台 VSIX 不能混用。

## 首次使用

1. 使用 VS Code 打开一个受信任、具有真实文件系统的工作区。
2. 运行 `DeepSeek Harness: Configure API Connection`。
3. 确认 API Base URL。默认值为 DeepSeek 官方 `https://api.deepseek.com/`，也可填写自建的 OpenAI-compatible/sub2 endpoint。
4. 输入 API Key。Key 只写入 VS Code `SecretStorage`，不会写入 `settings.json`、工作区或日志。
5. 打开活动栏中的 **DeepSeek Harness**，新建会话并发送消息。

默认权限为 `workspace-write`：允许在工作区和临时目录内写入，超出边界时要求审批。`danger-full-access` 会显著扩大代理权限，只应在明确理解风险时使用。

## DeDge Orbit 接入

扩展运行时就绪后会原子写入
`%LOCALAPPDATA%\DeDge\DeepSeekHarness\gateway-lease.json`。文件只包含
`127.0.0.1` Gateway 地址、进程号、运行时版本和工作区路径，不包含 API Key
或其他凭据。Orbit Bridge 会校验 loopback 地址和进程存活状态后连接；扩展停止、
异常退出或被新实例替换时，陈旧 lease 不会被当作在线运行时。

## 日常工作流

### 添加上下文

- 在 Explorer、编辑器正文或编辑器标签页右键选择 **Add File to DeepSeek Harness**。
- 选中文字后运行 **Add Selection to DeepSeek Harness**。
- 可把文件拖入输入框，或直接粘贴 VS Code 提供的文件对象。
- 输入区的添加菜单还可附加诊断、Git 变更或载入跨平台会话。

附件按 UTF-8 字节预算截断；二进制内容不会作为任意文件上传。发送前可在输入区移除附件。

### 会话与上下文压缩

顶部 tabs 用于快速切换当前 Harness 会话，标题栏历史按钮可访问完整列表以及 Codex/Claude 载入入口。归档和删除操作有会话级互斥，提交后会立即进入忙碌状态，避免延迟期间重复操作。

上下文占用环只在 Harness 返回真实 provider usage 后出现。固定的 Standard、Code 和 Cordis preset 默认在容量的 80% 自动压缩；旁边的配置按钮同时设置上下文容量和自动压缩阈值基数。手动压缩不要求达到自动阈值，但只能在支持压缩且代理空闲时执行。Minimal preset 不支持压缩，对应按钮会禁用。

## Codex / Claude 隔离交接

跨平台功能是“只读文本交接”，不是三种私有会话格式之间的同步器：

```text
Codex / Claude / DeepSeek source session (read-only)
                         |
                         v
          handoff.json + handoff.md (extension storage)
                         |
                         v
        new unsent draft or new target CLI session
```

- 载入 Codex 或 Claude Code 时，只提取有长度上限的顶层 user/assistant 文本；不会写入源平台的 JSONL、索引、配置或凭据。
- 载入 DeepSeek Harness 后会创建独立的新 Harness 会话和未发送草稿。只有用户检查附件并按 **Send** 后，才会开始模型 turn。
- 交给 Codex 或 Claude Code 时会启动一个新的目标 CLI 会话，不会把 DeepSeek 格式写回原会话。
- 临时处理完成后，可在原生 Codex 使用 `/resume`、在 Claude Code 使用 `--resume` 返回完全未改动的原会话；如需带回处理结果，再创建一次新的交接。
- 用户按 **Send** 后，交接文本会作为提示上下文发送到当前配置的模型 endpoint。发送前应检查其中是否包含不希望交给该服务的数据。

完整边界见 [会话交接说明](docs/session-handoff.md)。

## 支持范围

最低要求为 VS Code `1.96.0`。VSIX 包含 native binary，必须在目标平台的原生环境中构建并验证。

| Extension host | VSIX target | 当前状态 |
| --- | --- | --- |
| Windows 10/11 x64 | `win32-x64` | `0.1.5` 完整验证目标 |
| Linux x64 | `linux-x64` | 源码支持；发布前需要原生 runner 验证 |
| macOS Apple Silicon | `darwin-arm64` | 源码支持；发布前需要原生 runner 验证 |
| Windows ARM64 / Linux ARM64 / macOS Intel | 对应 target | 需要对应原生 runner 或设备验证 |

内置运行时版本固定为：

| 组件 | 版本 |
| --- | --- |
| DeepSeek Harness | `0.1.0-rc.6` |
| Node.js | `22.22.3` |
| pnpm | `11.21.0` |

详细支持边界见 [兼容性文档](docs/compatibility.md)。

## 关键设置

| 设置 | 默认值 | 说明 |
| --- | --- | --- |
| `dedgeDeepSeekHarness.runtime.mode` | `bundled` | 使用 VSIX 内置运行时；推荐终端用户保持此值 |
| `dedgeDeepSeekHarness.runtime.command` | 空 | external 模式的绝对 DSH 可执行文件或 JavaScript 入口 |
| `dedgeDeepSeekHarness.runtime.nodePath` | 空 | external JavaScript 入口使用的绝对 Node 路径 |
| `dedgeDeepSeekHarness.baseUrl` | `https://api.deepseek.com/` | DeepSeek 官方或自定义 OpenAI-compatible endpoint |
| `dedgeDeepSeekHarness.model` | `deepseek-v4-flash` | 新会话默认模型 |
| `dedgeDeepSeekHarness.reasoningEffort` | `high` | 新会话默认 reasoning；实际选项由模型 adapter 返回 |
| `dedgeDeepSeekHarness.agentPreset` | `standard` | 新会话默认 Agent Preset |
| `dedgeDeepSeekHarness.permissionMode` | `workspace-write` | 初始文件系统权限 |
| `dedgeDeepSeekHarness.context.maxBytes` | `32768` | 单次编辑器上下文 UTF-8 字节预算 |
| `dedgeDeepSeekHarness.context.windowTokens` | `1000000` | 上下文容量，也是自动压缩百分比的计算基数 |
| `dedgeDeepSeekHarness.handoff.codexHome` | `${userHome}/.codex` | Codex 会话只读发现目录 |
| `dedgeDeepSeekHarness.handoff.claudeHome` | `${userHome}/.claude` | Claude Code 会话只读发现目录 |
| `dedgeDeepSeekHarness.handoff.maxBytes` | `65536` | 隔离交接文本 UTF-8 字节上限 |

external 模式不会自动搜索、安装或升级软件。配置的 runtime 和 Node 必须使用绝对路径，并通过固定版本探针。

## 数据、隐私与清理

扩展自身不实现分析或遥测。模型提示、附件和工具结果会按 Harness 行为发送到用户选择的 Base URL；代理执行的工具也可能访问网络。VS Code、本地 Harness、所选 endpoint 及外部工具各自受其服务条款和隐私策略约束。详细说明见 [PRIVACY.md](PRIVACY.md)。

持久数据位于 VS Code 为本扩展分配的 `globalStorage`：

```text
harness-homes/<dsh-version>/  # 版本隔离的 Harness 会话状态
runtime-bin/                  # 可重建的本地命令包装器
generated/<dsh-version>/      # 可重建的配置 overlay
logs/                         # 诊断日志
tmp/                          # 一次性兼容性探针
snapshots/                    # Git diff 只读基线
handoffs/<handoff-id>/        # 用户主动创建的 JSON/Markdown 交接包
```

先停止运行时，再清理 `tmp/`、`generated/`、`snapshots/` 或 `handoffs/`。删除 `harness-homes/` 会清除对应 Harness 版本的本地会话。API Key 位于 `SecretStorage`，应通过命令 **DeepSeek Harness: Clear API Key** 删除。

卸载扩展不会保证自动删除 VS Code 保留的 `globalStorage` 或 SecretStorage 项；卸载前先停止运行时并按需清理。

## Windows 排查

扩展启动 Harness 时不拼接 PowerShell 命令，而是使用 `spawn(..., { shell: false, windowsHide: true })`。PowerShell 仅用于非阻塞兼容性探针，因为代理后续工具调用仍可能遇到用户机器上的 PowerShell 环境。

遇到启动、中文路径、长路径或停止异常时：

1. 运行 `DeepSeek Harness: Diagnose Environment`。
2. 打开 **Output > DeepSeek Harness**。
3. 确认安装的是 extension host 对应平台的 VSIX。
4. 优先使用 PowerShell 7，并确认企业防护软件没有阻止内置 Node 子进程。
5. 提交问题前删除日志中的工作区路径、文件内容、会话文本和其他私人信息。

更多步骤和已知退出码见 [SUPPORT.md](SUPPORT.md) 与 [兼容性文档](docs/compatibility.md)。

## 已知限制

- DeepSeek Harness Gateway 与 session event 仍可能随上游 RC 变化。
- 自定义 preset 不提供 `contextPressure` 时，占用环会隐藏，不会显示猜测值。
- Codex 优先通过官方 app-server 只读列出 Active 根会话；不可用时才使用严格过滤的 JSONL 回退。Claude Code 会话发现目前使用只读本地 JSONL。
- 跨平台交接保留最近的可见文本，不复制 reasoning、工具内部状态、凭据或完整私有会话结构。
- 当前没有跨 DSH 版本迁移 `DSH_HOME`；升级使用新的版本隔离目录。
- 系统工具调用仍受本机软件、代理、证书、企业策略和 endpoint 能力影响。

## 开发

要求 Git、带 Corepack 的受支持 Node.js 22，以及 VS Code 1.96 或更高版本：

```powershell
corepack pnpm@11.21.0 install --frozen-lockfile
corepack pnpm@11.21.0 run audit:release
corepack pnpm@11.21.0 run typecheck
corepack pnpm@11.21.0 test
corepack pnpm@11.21.0 run build
corepack pnpm@11.21.0 run prepare:runtime
corepack pnpm@11.21.0 run smoke:runtime
corepack pnpm@11.21.0 run package:platform
```

临时、测试和浏览器输出统一进入 `.tmp/`、`.playwright-cli/`、`coverage/`、`output/` 或 `test-results/`，使用 `pnpm run clean` 清理。`dist/` 与 `out/` 是生成产物；使用 `pnpm run clean:build` 一并清除。不要把本机 session、Key、日志、附件或运行时状态加入仓库。

仓库边界：

```text
src/       extension host、runtime、gateway、session、handoff 与 UI 模块
test/      与核心模块对应的单元/协议测试
scripts/   构建、运行时准备、审计、打包和清理工具
docs/      架构、兼容性、交接和发布维护文档
media/     扩展图标与公开媒体资源
licenses/  必须随 VSIX 分发的固定许可证文本
.github/   CI、issue、PR 与 Release 配置
```

贡献说明见 [CONTRIBUTING.md](CONTRIBUTING.md)，发布流程见 [docs/RELEASING.md](docs/RELEASING.md)。

## 许可证与声明

本项目使用 [MIT License](LICENSE)。第三方组件与固定版本见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

DeepSeek、DeepSeek Harness、OpenAI、Codex、Anthropic、Claude 和 Visual Studio Code 的名称、标识与产品属于各自权利人。本项目是独立的社区项目，不是 DeepSeek、OpenAI、Anthropic 或 Microsoft 的官方产品，也不包含 Codex 或 Claude Code 源码。

# 兼容性

## 支持范围

VS Code 最低版本为 `1.96.0`。VSIX 是平台相关产物，必须匹配 extension host 的操作系统和架构。

| Extension host | VSIX target | 支持级别 | 发布要求 |
| --- | --- | --- | --- |
| Windows 10/11 x64 | `win32-x64` | Tier 1 | 原生构建、单测、打包和运行时冒烟 |
| Windows 11 ARM64 | `win32-arm64` | Tier 2 | 原生 ARM64 runner 或设备验证 |
| Linux x64 | `linux-x64` | Tier 1 | 原生构建、单测、打包和运行时冒烟 |
| Linux ARM64 | `linux-arm64` | Tier 2 | 原生 ARM64 runner 或设备验证 |
| macOS Intel | `darwin-x64` | Tier 2 | 原生 Intel runner 验证 |
| macOS Apple Silicon | `darwin-arm64` | Tier 1 | 原生构建、单测、打包和运行时冒烟 |

Tier 表示发布验证优先级，不表示尚未运行发布门禁的构建已经获得认证。Remote SSH、WSL 和 Dev Container 使用远端 extension host 的 target。

## 运行时版本

| 组件 | 内置版本 | 规则 |
| --- | --- | --- |
| DeepSeek Harness | `0.1.1-rc.1` | 原生图片附件与当前 Gateway 协议验证目标 |
| Node.js | `22.22.3` | VSIX 内置，不依赖系统 Node |
| pnpm | `11.21.0` | 只供 Harness 内部工具链使用 |

external JavaScript runtime 接受 Node `22.19+` 或 `24+`；Node 23 不在当前上游支持范围。external DSH 可使用同一 `0.1.0-rc.x` 系列，RC 修订不同会记录警告；基础协议版本不同仍会阻止启动。扩展不会从 PATH 猜测版本，也不会自动升级。

## Windows 与 PowerShell

扩展本身不通过 PowerShell 启动 Harness：`spawn` 使用参数数组、`shell: false` 和隐藏窗口。PowerShell 仅用于启动前的兼容性探针，因为 Harness 的工具调用最终仍可能遇到用户机器上的 PowerShell 环境。PowerShell 缺失、受限或探针失败会产生警告，但不会阻止非 PowerShell 功能启动。

Codex/Claude 会话交接同样不拼接 shell 字符串。Windows 自动发现并直接启动官方原生 `.exe`；Codex 历史通过同一二进制的 app-server stdio 协议只读列出，自定义 CLI 路径也必须是绝对 `.exe`。进程与交接参数均通过数组传递，带空格、Unicode 和较长工作区路径不会经过 PowerShell/cmd 再解释。

Windows 探针检查：

- 优先 PowerShell 7，回退到 Windows PowerShell 5.1。
- PowerShell `LanguageMode`，包括企业策略常见的 `ConstrainedLanguage`。
- 控制台与管道 UTF-8 输出。
- 含空格和非 ASCII 路径的参数往返。
- 目录 junction 的真实跨链接读回。
- 长度达到 220 字符的工作区路径。
- 工作区路径中的非 ASCII 字符。

含空格和 Unicode 路径属于设计支持范围，但第三方 CLI 仍可能使用旧代码页。出现警告时，优先安装 PowerShell 7、启用 Windows long paths，并把仓库移动到更短的路径；不要通过关闭引号或改成拼接 shell 字符串绕过问题。

### 已知 Windows 启动码

| 退出码 | 诊断 |
| --- | --- |
| `0xC0000142` | DLL 初始化失败；常见于 endpoint protection 或受限 token 阻止子进程 |
| `0xE0434352` | .NET/PowerShell 启动失败；常见于不兼容的受限 token |

先运行 `DeepSeek Harness: Diagnose Environment` 并查看 `DeepSeek Harness` 输出通道。诊断不应包含 API Key。

## 文件系统与 Git

- 工作区必须受信任才能启动代理。
- `workspace-write` 允许工作区和临时目录写入，工作区外操作应触发审批。
- Git change review 使用 `git status --porcelain=v1 -z`，因此支持空格和大多数 Unicode 文件名。
- Windows junction 探针失败不代表所有功能立即不可用；插件不会因此改用未经转义的 PowerShell/cmd 字符串。
- `globalStorage` 和工作区应位于本机或语义兼容的文件系统；网络盘、FUSE 或同步盘必须单独验证原子 rename 和 junction 行为。

## 已知限制

- DeepSeek Harness 是 developer preview，Gateway 事件可能在后续 RC 中变化。
- 上下文占用依赖可选的 `contextPressure` projection；不提供 token-meter 的自定义 preset 会隐藏占用环，而不是显示伪造估算。
- Codex 历史优先使用官方 app-server 的当前 provider、Active 交互式根会话列表；不可用时才扫描 Codex `sessions/`。Claude 只扫描 `projects/` 的 Active 顶层会话；Codex `archived_sessions/` 永不进入回退扫描。Codex rollout 文本读取限制为末尾 32 MiB，避免超大 JSONL 在 Windows 上阻塞 extension host。
- 当前没有跨版本会话目录迁移；升级使用新的版本化 `DSH_HOME`。
- VSIX 不能在一个平台上交叉生成另一个平台的内置 Node 产物。
- 系统级工具调用仍受用户安装的软件、企业防护策略、代理和证书配置影响。
- 扩展避免 Python Harness runtime，因此不依赖当前缺失的 Windows Python wheel。

## 发布门禁

每个目标 VSIX 至少需要：

```text
corepack pnpm@11.21.0 install --frozen-lockfile
corepack pnpm@11.21.0 run typecheck
corepack pnpm@11.21.0 test
corepack pnpm@11.21.0 run build
corepack pnpm@11.21.0 run prepare:runtime
node node_modules/@vscode/vsce/vsce ls --no-dependencies
corepack pnpm@11.21.0 run package:platform
```

随后在干净 VS Code profile 中完成：安装对应 VSIX、无下载激活、无密钥诊断、配置密钥后的本地启动、会话流式事件、审批/取消、停止以及无残留子进程检查。

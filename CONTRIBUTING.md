# Contributing

感谢参与 DeDge DeepSeek Harness。提交前请先确认问题属于扩展、打包或兼容层，而不是自定义 endpoint、工作区脚本或未修改的上游 Harness 行为。

## Development Environment

- Git
- VS Code 1.96.0+
- 带 Corepack 的受支持 Node.js 22
- 固定 pnpm 11.21.0

~~~powershell
corepack pnpm@11.21.0 install --frozen-lockfile
corepack pnpm@11.21.0 run typecheck
corepack pnpm@11.21.0 test
corepack pnpm@11.21.0 run build
~~~

依赖和上游 runtime 版本必须在 package.json 与 pnpm-lock.yaml 中固定。扩展激活代码不得运行包管理器、克隆仓库或修改全局环境。

## Repository Boundaries

- src/config：设置读取与校验。
- src/security：SecretStorage 凭据。
- src/platform：存储布局和结构化日志。
- src/runtime：运行时解析、启动、诊断和停止。
- src/gateway：HTTP/WebSocket 协议边界。
- src/session：会话状态与事件投影。
- src/context：有界编辑器上下文。
- src/handoff：只读发现与隔离交接。
- src/ui：Webview 协议和界面。
- test：对应核心边界的测试。
- scripts：构建、审计、打包和清理。

新增抽象应落在已有所有权边界内。不要把 shell 字符串生成、凭据持久化或外部会话写入塞进 UI 模块。

## Privacy and Test Data

所有测试夹具必须使用合成名称、路径、会话和 Token。禁止提交：

- .env、.npmrc、私钥、证书容器或真实 endpoint 凭据；
- .codex、.claude、Harness home、JSONL、日志或交接包；
- 本机用户名、绝对工作区路径、内部主机名、真实会话内容；
- node_modules、dist、out、.tmp、Playwright 或测试输出。

发布审计只报告匹配规则与文件路径，不要修改它去打印命中内容。

## Change Checklist

~~~powershell
corepack pnpm@11.21.0 run audit:release
corepack pnpm@11.21.0 run typecheck
corepack pnpm@11.21.0 test
corepack pnpm@11.21.0 run build
~~~

涉及 bundled runtime、native binary、平台兼容或发布边界时还必须运行：

~~~powershell
corepack pnpm@11.21.0 run prepare:runtime
corepack pnpm@11.21.0 run smoke:runtime
corepack pnpm@11.21.0 run package:platform
~~~

UI 变化应在 240px、320px、420px 和常规侧边栏宽度验证，不得出现文字溢出、菜单越界或控件重叠。Windows 进程变化应覆盖空格、Unicode、长路径、PowerShell 5.1/7 和取消/停止。

## Pull Requests

- 一个 PR 只处理一个清晰问题。
- 行为变化需要测试，用户可见变化需要更新 README 或 CHANGELOG。
- 上游版本变化同时更新兼容性、参考来源、第三方许可和 runtime audit。
- 不提交打包后的 VSIX；Release 资产由发布流程上传。
- PR 描述中说明验证平台和未验证边界。

完整发布门禁见 [docs/RELEASING.md](docs/RELEASING.md)。

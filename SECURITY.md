# Security Policy

## Supported Versions

| Version | Support |
| --- | --- |
| 0.1.1 | Security fixes for confirmed extension-owned issues |
| < 0.1.1 | Unsupported |

DeepSeek Harness 仍处于 developer preview。上游协议或运行时问题会先确认影响范围，再决定固定新版本、增加缓解措施或记录为上游限制。

## Reporting a Vulnerability

请使用仓库的 [private vulnerability reporting](https://github.com/EternityFOR/DeDge_DS_HS/security/advisories/new)。不要公开提交以下内容：

- API Key、Token、私钥或带凭据的 URL；
- 本机用户名、绝对路径、内部主机名或网络拓扑；
- Codex、Claude Code、Harness 会话文件或完整日志；
- 未公开漏洞的可直接利用细节。

报告应包含受影响版本、平台/架构、VS Code 版本、最小复现步骤、预期影响和已经尝试的缓解方法。可以使用合成数据替代真实项目内容。维护者确认报告后会通过 Security Advisory 保持后续沟通。

## Security Boundaries

- API Key 只使用 VS Code SecretStorage，并只注入本地 Harness 子进程。
- 未受信任工作区不能启动 Harness。
- Gateway 绑定随机 127.0.0.1 端口，不提供外部监听配置。
- 子进程使用参数数组和 shell: false；用户值不经过 PowerShell/cmd 字符串插值。
- bundled runtime、Node 和 pnpm 使用固定版本，激活阶段禁止自动安装。
- Codex/Claude 会话发现只读；交接包与三个平台的原始数据目录隔离。
- 默认权限为 workspace-write，更高权限必须由用户显式选择。
- 诊断和发布审计不得输出匹配到的秘密值。

## Scope

扩展代码、打包脚本、bundled runtime 边界、Gateway 客户端、会话投影、Webview 处理和交接逻辑属于本项目处理范围。

DeepSeek API、DeepSeek Harness 上游、VS Code、Codex、Claude Code、自定义 endpoint、MCP server、用户脚本和系统工具的独立漏洞通常应同时报告给对应维护者。本项目仍会评估是否需要版本固定、禁用能力或增加防御性检查。

## Disclosure

请在修复或明确缓解措施发布前保持报告私密。确认的扩展漏洞会在修复版本发布时进入 CHANGELOG.md 和 GitHub Security Advisory；不会公开报告者不希望披露的个人信息。

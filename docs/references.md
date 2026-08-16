# 参考项目记录

记录日期：2026-08-16。以下仓库均克隆到被忽略的 `.tmp/`，只用于协议和产品行为研究，不参与构建或打包。提交固定值用于让后续维护者重现当时的判断。

## 官方参考

| 项目 | 固定提交 | 采用的参考点 |
| --- | --- | --- |
| [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) | `47f943859bef60e4160492346772ded9b24f765a` | DSH CLI、Web Gateway、session event、审批/问题和运行时约束 |
| [openai/codex](https://github.com/openai/codex) | `73abda8bfef6bd42eb11351be53980a027fd1feb` | `codex app-server` 的 `thread/list` 过滤、富客户端边界和进程管理思路 |
| [anthropics/claude-code](https://github.com/anthropics/claude-code) | `0fa8c19d50f70f9f383fb6ff5ce5209575267d21` | 原生二进制分发方向、Windows 修复记录和跨平台兼容性关注点 |

Codex 和 Claude Code 的公开仓库不包含其完整 VS Code 前端，因此本项目没有把不可见实现当作可复制来源。Claude Code 仓库许可为 Anthropic 保留权利的商业条款，本项目未复用其中代码或资产。

## 社区 DeepSeek Harness VS Code 参考

| 项目 | 固定提交 | 观察 |
| --- | --- | --- |
| [HarcoChen/dsh-vsc-integration](https://github.com/HarcoChen/dsh-vsc-integration) | `a12d5cc830aaebc61c1e761ccea59a72b09718e3` | 外部 DSH 集成与编辑器交互 |
| [MJ-Chang/dsh-vscode](https://github.com/MJ-Chang/dsh-vscode) | `43f8de86dff6a370bd313dafa9da357c7f038bec` | 轻量 extension host 集成 |
| [NEXTINDIE/DeepSeek-Harness-for-VS-Code](https://github.com/NEXTINDIE/DeepSeek-Harness-for-VS-Code) | `ccbf8fb5a1f6b920a68cdd8fb49b815f862bf1fe` | 自动安装路径及其失败面 |
| [skymecode/deepseek-harness-for-vscode](https://github.com/skymecode/deepseek-harness-for-vscode) | `cddd540cc6db7d7e5067e64ae27656bb112beadd` | 最清晰的确定性平台打包参考；凭据设置方式未采用 |
| [Vithrive/Deepseek-Harness-for-VS-Code](https://github.com/Vithrive/Deepseek-Harness-for-VS-Code) | `c656771612ad8d76aa6a55465d7bb3be3e6fda64` | Web 面板和全局安装路径的维护风险 |
| [weinibuliu/deepseek-harness-vsc-extension](https://github.com/weinibuliu/deepseek-harness-vsc-extension) | `5c3ba9dde7934550d158f7f62a4ef0516d90fbb8` | DSH Web UI 包装方式和生命周期处理 |

这些社区仓库都只作为行为对照。共同暴露的问题是激活时全局/非固定版本安装、PATH 与 shell 假设、Windows 失败恢复，以及把 API Key 写入普通 VS Code settings。本项目对应采用平台 VSIX、固定版本、`SecretStorage`、绝对路径 external mode 和无 shell 启动。

## 本地临时目录

```text
.tmp/upstream/deepseek-harness/
.tmp/references/codex/
.tmp/references/claude-code/
.tmp/references/community/<project>/
```

任何源码、测试、构建脚本和发布工作流都不得依赖这些目录。完成研究后可以整体删除 `.tmp/`；需要复核时按上表 URL 和提交重新获取。不要把参考克隆复制进 VSIX。

## 更新规则

升级上游前先新增一条带日期的记录，保留旧提交和结论；然后分别审查 CLI 参数、Gateway 方法、WebSocket frame、数据目录格式和许可证。仅查看最新分支而不记录 commit 的结论不可用于发布决策。

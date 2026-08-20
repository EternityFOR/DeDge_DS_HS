# DeDge DeepSeek Harness v0.1.7

0.1.7 升级官方运行时 rc.7，修复删除与消息归属问题，长文本粘贴自动落盘，交接支持选择交付方式。

## Highlights

- 内置 DeepSeek Harness 升级到官方 `0.1.0-rc.7`（latest 线），已实测兼容 rc.6 会话数据；升级后自动把旧版本 home 迁移到新目录，历史会话不丢。
- 长文本粘贴（默认超过 8 KB）自动写入插件存储目录，消息中只给文件路径，模型按需读取。
- 删除会话不再因"找不到磁盘数据"报错：无数据会话自动走官方归档移除。
- 插件注入消息（命令回显、系统快照、工具通知）不再伪装成 "You"，按轮次折叠边界正确。
- 交接到 Codex/Claude 时弹窗选择：复制接手 prompt 到剪贴板，或直接启动 CLI。

## Verification

- 71 automated tests
- TypeScript typecheck
- Production bundle
- Documentation and release safety audits
- Runtime smoke（rc.7 Gateway）
- rc.7 读取 rc.6 会话数据实测通过

## Release Asset

| Asset | Target | Size | SHA-256 |
| --- | --- | ---: | --- |
| `dedge-deepseek-harness-vscode-0.1.7-win32-x64.vsix` | `win32-x64` | `76,814,281 bytes (73.3 MiB)` | `E1BA0DB10D7587A5B7ADA3E23AB0DC0BBDE771624C5CB3ECC0C44BF0F5969608` |

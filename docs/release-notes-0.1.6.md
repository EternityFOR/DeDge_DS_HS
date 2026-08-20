# DeDge DeepSeek Harness v0.1.6

0.1.6 修复会话删除与图片附件问题，思考折叠改为默认开启，并新增统一设置面板。

## Highlights

- 思考折叠默认开启：Reasoning/Tool 开箱即用收起为一行摘要（`Reasoning · N chars`），按钮可随时切换。
- 图片粘贴：剪贴板截图/图片自动添加为附件，输入框上方显示可删除的缩略图。
- 统一设置面板：底部设置按钮分类管理 API Key、Vision Key、Vision 端点、Skill 目录、Handoff 与运行时选项。
- 删除/归档最后一个会话后不再自动新建，空状态提供 `Start new session` 按钮；删除后标签立即移除。
- 修复附件始终不显示的缺陷（状态渲染未同步附件数据），以及异常快照的渲染防御。

## Verification

- 71 automated tests
- TypeScript typecheck
- Production bundle
- Documentation and release safety audits
- Playwright UI verification：默认折叠、图片粘贴、缩略图删除、空状态、设置面板全部通过

## Release Asset

| Asset | Target | Size | SHA-256 |
| --- | --- | ---: | --- |
| `dedge-deepseek-harness-vscode-0.1.6-win32-x64.vsix` | `win32-x64` | `77,265,470 bytes (73.7 MiB)` | `07F23F88A39FA47596C5CBC30A620D8A5DB8F827838C677C8CC9FA0356333B0E` |

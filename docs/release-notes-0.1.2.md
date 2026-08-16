# DeDge DeepSeek Harness v0.1.2

0.1.2 是一次稳定性修复版本，重点解决侧边栏刚打开、模型目录仍在加载时，操作模型或思考深度控件可能延迟发送旧草稿的问题，并完善本机 Gateway 复用与发布包清理。

## Highlights

- 模型、思考深度和发送控件在运行时、活动会话与模型目录全部就绪前保持禁用。
- 前端与扩展宿主双重校验发送条件，不再等待运行时启动后自动补发旧草稿。
- Gateway 明确接受请求后才清空草稿和附件；失败或拒绝时保留输入内容。
- 发布不含凭据的本机 loopback Gateway lease，供 DeDge Orbit 复用当前运行时。
- lease 按进程所有权写入和清理，避免多个 VS Code 窗口互相删除仍有效的运行时地址。
- 平台运行时打包整体排除 `.bin` 开发 shim，减少无效启动器和跨平台包装文件。

## Compatibility

- 完整验证目标：Windows 10/11 x64、VS Code 1.96 或更高版本。
- 内置 DeepSeek Harness 仍为 `0.1.0-rc.6`；这是上游运行时版本，不是扩展版本。
- Remote SSH、WSL 和 Dev Container 必须安装与远端 extension host 平台匹配的 VSIX。

## Privacy

- API Key 只存放在 VS Code `SecretStorage`，不会进入仓库、日志、handoff、生成配置或 VSIX。
- Gateway lease 只包含 loopback 地址、进程与运行时元数据，不包含 API Key 或其他凭据。
- 发布前会审计常见 Key/Token、私钥、session dump、绝对本机路径、内部 URL 和开发临时文件。

## Verification

- Documentation and release safety audits
- TypeScript typecheck
- 63 automated tests
- Production bundle
- Bundled runtime smoke test
- VSIX native/runtime/license/content audit

## Release Asset

| Asset | Target | Size | SHA-256 |
| --- | --- | ---: | --- |
| `dedge-deepseek-harness-vscode-0.1.2-win32-x64.vsix` | `win32-x64` | 77,251,961 bytes (73.7 MiB) | `066F7D30BCA39E2A3B155952D31D63551F2B1BEFF46E05E2314B7B4B8E2BF258` |

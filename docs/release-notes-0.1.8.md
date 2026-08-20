# DeDge DeepSeek Harness v0.1.8

0.1.8 长文本粘贴体验改为"附件式"：不再直接塞进输入框，而是显示可删除的缩略 chip，发送时落盘为文件并以路径引用。

## Highlights

- 粘贴超过阈值（默认 8 KB，可配置）的文本时，自动转为附件：输入框上方出现带文件图标的缩略 chip（`xxx.txt · saved to file`），可点击 × 删除。
- 发送时才把内容写入插件存储目录，提示中只给文件路径，模型按需读取。
- 删除附件时同步清理落盘文件。

## Verification

- 71 automated tests
- TypeScript typecheck
- Production bundle
- Documentation and release safety audits
- Playwright：长文本拦截、短文本不拦截、缩略 chip、删除全部通过

## Release Asset

| Asset | Target | Size | SHA-256 |
| --- | --- | ---: | --- |
| `dedge-deepseek-harness-vscode-0.1.8-win32-x64.vsix` | `win32-x64` | `76,814,615 bytes (73.3 MiB)` | `6210F8939797839D7B99B726D701921BD0BC2D9643E1D97F38C3B9B8069D1D30` |

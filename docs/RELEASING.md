# Release Process

本流程用于公开 GitHub Release 和 VS Code Marketplace。VSIX 含平台相关 native binary，不能把一个平台的产物改名后发布到另一个 target。

## 1. Prepare

- 确认版本、日期、package.json、CHANGELOG.md 和 release notes 一致。
- 确认 bundled DSH、Node、pnpm 和许可证版本一致。
- 确认仓库 remote 是公开 HTTPS URL，工作树中没有无关改动。
- 确认 .gitignore 覆盖 session、日志、Key、环境文件、构建和临时目录。
- 不使用真实会话、真实 API Key 或私人工作区做发布测试。

~~~powershell
corepack pnpm@11.21.0 install --frozen-lockfile
corepack pnpm@11.21.0 run audit:release
corepack pnpm@11.21.0 run typecheck
corepack pnpm@11.21.0 test
corepack pnpm@11.21.0 run build
~~~

## 2. Prepare and Smoke the Runtime

~~~powershell
corepack pnpm@11.21.0 run prepare:runtime
corepack pnpm@11.21.0 run smoke:runtime
~~~

Smoke 必须验证固定版本、loopback 启动、Gateway 响应和停止后的进程树清理。不得在扩展激活阶段补装缺失依赖。

## 3. Package the Native Target

在目标原生 runner 上执行：

~~~powershell
corepack pnpm@11.21.0 run package:platform
~~~

脚本会生成：

~~~text
out/dedge-deepseek-harness-vscode-<version>-<platform>-<arch>.vsix
~~~

并自动审计：

- extension bundle、Node、DSH、pnpm、node-pty 和 ripgrep；
- target 与 runtime manifest 一致；
- Node 和第三方许可证存在且 hash 正确；
- 其他平台 native binary、源码、测试、锁文件和临时文件未进入 VSIX；
- 文件数、压缩/解压大小和大文件重复预算；
- 扩展自有文本不含常见 secret、本机绝对路径或 Mojibake。

## 4. Manual Smoke

使用干净 VS Code profile：

1. 安装目标 VSIX，确认激活时没有下载或包管理器进程。
2. 在无 Key 状态运行诊断。
3. 配置测试 endpoint 和临时 Key，完成流式回复、附件、审批、取消和停止。
4. 验证新建/切换/归档/删除及操作互斥。
5. 只用合成会话验证 Codex/Claude 载入生成未发送草稿，源文件 hash 不变。
6. 验证 240px、320px、420px 和常规宽度无溢出/重叠。
7. 停止扩展，确认没有残留 runtime 子进程。

## 5. Publish GitHub

提交并推送 release commit，创建带注释 tag：

~~~powershell
git tag -a v<version> -m "DeDge DeepSeek Harness v<version>"
git push origin main
git push origin v<version>
~~~

创建 GitHub Release 时：

- 标题使用 DeDge DeepSeek Harness v<version>；
- release body 使用对应 docs/release-notes-<version>.md；
- 上传每个已验证 target 的 VSIX；
- 在 Release 中列出每个资产的 SHA-256；
- preview 版本勾选 pre-release；
- 不上传日志、测试截图、runtime staging 目录或 workspace archive。

## 6. Publish Marketplace

确认 publisher、扩展 ID、版本和 target 后，使用本机安全提供的 VSCE_PAT。不要把 PAT 写进仓库、命令参数、日志或 CI 明文变量。

~~~powershell
node node_modules/@vscode/vsce/vsce publish --packagePath .\out\<asset>.vsix
~~~

发布后打开 Marketplace 页面，检查 README、CHANGELOG、许可证、图标、target、安装按钮和链接。不要通过自动安装 VSIX 的方式验证当前开发窗口；使用独立 VS Code profile。

## 7. Close the Release

- 更新 release notes 中的最终 SHA-256。
- 确认 GitHub tag、Release 资产与 Marketplace 版本一致。
- 运行 pnpm run clean 清理临时/测试输出；保留已发布的 out/*.vsix 直到 hash 复核完成。
- 在 workspace superproject 中更新 submodule gitlink 和内部 repositories register。
- 刷新 workspace tree/audit；不要把包含 Office 私有路径的生成树推到公开工具仓库。
- 将 CHANGELOG.md 的 Unreleased 保持为空白占位，后续变化从新条目开始。

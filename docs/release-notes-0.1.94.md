# DeDge DeepSeek Harness 0.1.94

本版是 0.1.93 的发布门禁修正，运行时功能保持一致：

- Steer 可取消本会话的前台 PowerShell/Bash 等协作式操作，让插队消息在下一步进入模型；其余队列、后台 jobs、timers 和 turn signal 保留。
- Steering 消息也可以编辑或取消。
- 官方 Harness 固定为 `0.2.0-rc.2`，包含新 Inbox、cursorless assistant stream、Host Schedule、Job 和 preset API 适配。
- Schedule 转圈等待提示显示下一次计划触发的本地时间、时区和剩余倒计时；每秒只更新界面标签，隐藏时停表，不增加模型/RPC 请求。
- 自定义 OpenAI/Sub2 root 保留 Chat Completions；官方 DeepSeek root 内部适配 Messages，不改 SecretStorage 的 URL key slots。

## 本次门禁修正

- runtime smoke 的每个场景独立检查请求顺序，避免前一场景的 backlog 污染直接 Steer 断言。
- Windows 体积预算不变；Linux/macOS 使用符合其官方 Node/native carrier 大小的平台预算，其余内容审计不变。

## 升级注意

安装后重新加载使用旧版本的 VS Code 窗口，不要混用 0.1.x Host 与 0.2.0 客户端。旧 session-log reminders 不能自动转换为新 Host reminders，需要明确用 `schedule_create` 和 `title` 重新创建。扩展保留旧版本 home，不复制凭据或覆盖原始旧 home。

VS Code 自有 UI 不提供上游浏览器 Office 转 PDF 文档预览；可选 LibreOffice 引擎不进入 VSIX，文件生成和原生图片输入保留。

## 验证

185 项 Vitest、类型检查、构建、真实前台睡眠的直接/队列 Steer、十条队列消息完整性、Host reminders 隔离删除、原生图片、自定义网关、合成 UI 和发布内容审计。复现使用临时工作区、本机模拟模型端点和假凭据，不使用用户会话/密钥或产生真实模型费用。

# DeDge DeepSeek Harness 0.1.93

## 本次修复

- 前台 PowerShell/Bash 处于 `Start-Sleep` / `sleep` 等长等待时，Steer 会取消当前的协作式 Shell 执行，让插队消息在下一步被模型接收。其余排队消息、后台 jobs、定时器和会话 turn 保留。
- Steering 消息也能编辑或取消，鼠标提示说明其真实行为。模型请求进行中时仍按官方下一步语义投递，不把“已受理插队”冒充“模型已经回答”。
- 内置 Schedule 等待提示显示最近的计划触发时间、客户端本地时区和每秒剩余倒计时；多个任务的详情可在提示中查看。倒计时只更新界面文本，不请求模型或轮询后端。
- 内置官方 Harness 更新到 `0.2.0-rc.2`，适配新版 Inbox、实时 assistant stream、Host Schedule、job 管理和 preset API。
- 实时文本/思考不写进持久事件游标；重连后从官方直播 baseline 恢复，已提交的消息会替换直播片段，避免重复和顺序污染。
- 官方 DeepSeek root 在内部转换为 Messages namespace；已配置的自定义 OpenAI/Sub2 root 继续使用 Chat Completions，不修改 URL 绑定的 SecretStorage key slots。

## 升级注意

- VS Code 自有工作台未使用上游新增的浏览器 Office 转 PDF 预览；本包禁用该预览服务并排除可选 LibreOffice 引擎，避免把约 190 MiB 的无关 native payload 带入 VSIX。普通文件生成和图片识别保留。
- 这是 Harness `0.1.5` 到 `0.2.0` 的协议升级。安装后按 VS Code 提示重新加载使用旧版本的窗口；不要混用旧 Host 和新客户端。
- 扩展仍使用版本化 Harness home，不覆盖原始旧 home，也不复制凭据。官方提供的 v3→v4 session reader 负责历史格式兼容。
- 上游重新设计了定时任务存储：旧 session-log reminders 不会自动成为新 Host reminders。需要继续运行的旧定时任务，请在升级后用 `schedule_create` 明确重新创建，并提供 `title`。
- 新 reminders 可在 Host 重启后恢复，但 Host 未运行期间不能触发。Steer 不会删除这些 reminders；Pause 才会取消当前会话的 active reminders 和 owned jobs。

## 验证范围

Windows x64：类型检查、185 项 Vitest、构建、官方 runtime 启动、RPC/事件流、原生图片、Host reminders 隔离删除、定制网关请求、直接/队列 Steer 的真实 Shell 打断、合成 UI 检查及 VSIX/隐私/文档审计。另从实际 VSIX 解包再次运行上述 runtime smoke，验证发布载荷的闭合依赖。

插队复现使用本机模拟 provider、临时工作区和假凭据，不产生真实模型费用，不读取用户会话或密钥。

## Windows x64 产物

- 文件：`dedge-deepseek-harness-vscode-0.1.93-win32-x64.vsix`
- 大小：`92,880,864` bytes，约 `88.6 MiB`
- SHA-256：`710b4d6cd9c4f5842b99bdc0e9b27ef389ae5ced9074357a32d81e32033dea59`

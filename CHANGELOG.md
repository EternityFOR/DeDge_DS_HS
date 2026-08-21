# Changelog

本文档遵循 [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)，版本号遵循 [Semantic Versioning](https://semver.org/spec/v2.0.0.html)。

## [Unreleased]

## [0.1.34] - 2026-08-21

### Fixed

- 搜索箭头现在按目标文字 `Range` 的实际屏幕坐标滚动，不再被后续的整消息滚动覆盖。
- 定位计算会避开搜索浮层，并将命中文字放在对话可见区域内。

## [0.1.33] - 2026-08-21

### Fixed

- 搜索输入和箭头定位不再给整个命中消息或任务添加黄色背景、边框和阴影；仅高亮当前目标文字。
- 更改搜索词时立即清理上一条词级高亮，避免旧结果残留。

## [0.1.32] - 2026-08-21

### Fixed

- 修复点击搜索结果箭头导致 Webview 卡死：文字高亮正则现在使用全局匹配，迭代会正确前进，不再无限处理同一个命中。
- 已使用真实浏览器预览流程验证搜索、下一条定位、任务展开与页面持续响应。

## [0.1.31] - 2026-08-21

### Fixed

- 搜索箭头导航不再触发整轮会话重渲染；只在现有 DOM 上展开目标任务、切换目标消息状态并进行 Range 定位，避免真实 Webview 点击箭头卡死。

## [0.1.30] - 2026-08-21

### Fixed

- 搜索导航使用 Chromium CSS Custom Highlight API 的 `Range` 高亮目标文字，不修改 DOM 文本节点；目标任务仍会展开并滚动定位，避免长消息点击箭头卡死。

## [0.1.29] - 2026-08-21

### Fixed

- 移除箭头导航期间的文字级 DOM 重写；长消息和折叠任务只使用当前消息强边框高亮、展开和滚动，避免点击箭头卡死 Webview。

## [0.1.28] - 2026-08-21

### Fixed

- 搜索输入期间不再创建或销毁文字级 `<mark>` DOM；输入只计算匹配消息候选，避免拼音输入和空格确认时 Webview 卡死。
- 只有点击上一条/下一条定位后，才对当前目标消息插入文字高亮标记。

## [0.1.27] - 2026-08-21

### Fixed

- 修复中文拼音输入时搜索面板卡死：IME composition 期间暂停搜索，输入完成后使用 160ms 防抖。
- 每次搜索前清理旧文字标记，避免重复输入导致 `<mark>` DOM 无限嵌套和性能退化。

## [0.1.26] - 2026-08-21

### Fixed

- “搜索选中文本”现在只设置消息范围，不会把选中文字复制进搜索框；搜索框中的词保持由用户输入。
- 搜索高亮改为命中文字级别的 `<mark>`，不再把整条消息铺成黄色；当前导航结果使用更强的橙色边框。

## [0.1.25] - 2026-08-21

### Added

- 搜索栏新增明确的“搜索选中文本”按钮；使用 `mousedown` 保留对话内容的文本选区，再填入搜索词并计算匹配。

## [0.1.24] - 2026-08-21

### Fixed

- 提高搜索命中对比度：普通命中使用琥珀色边框和底色，当前箭头定位命中使用高亮橙色边框、黄色正文底色和阴影。
- 当前命中会覆盖消息正文、折叠摘要以及 reasoning/tool 详情，重新输入搜索词会清理旧高亮。

## [0.1.23] - 2026-08-21

### Fixed

- 搜索面板改为覆盖在会话内容上方，不再改变对话区域高度。
- 输入搜索词时只更新匹配高亮和数量，不再自动跳到第一条。
- 上下箭头按钮扩大可点击区域；点击后才展开目标任务、详情并滚动到当前匹配。
- 打开搜索面板时会读取当前文本选区作为初始搜索词。

## [0.1.22] - 2026-08-21

### Fixed

- 搜索栏改为 VS Code 风格的深色输入框和外置 `Aa`、`Word`、`.*` 切换按钮，不再把复选框显示在输入框内部。
- 搜索结果的上一条/下一条会展开目标所属任务和详情，滚动到目标消息并使用当前匹配高亮。

## [0.1.21] - 2026-08-21

### Added

- 会话搜索面板：支持当前已加载历史的文本搜索、大小写、整词、正则、上一条/下一条定位。
- 新增 `Approve for me`：保持 `workspace-write` 沙箱，仅自动允许每个 Harness approval 一次，不启用 unrestricted/full access。

### Changed

- reasoning、tool、Vision 等所有详情折叠的可点击区域统一为整行，并保留键盘操作与嵌套按钮保护。

## [0.1.20] - 2026-08-21

### Fixed

- 历史分页游标改用最早的原始 Harness 事件序号；一页只有内部事件时会继续向前读取，直到出现新的可见任务或没有更多历史。
- 对没有推进游标的重复分页结果停止继续加载，避免连续点击反复替换同一段任务。
- 手动压缩现在投影为 `compacting` 会话操作：tab、历史分页、权限、模型、发送和压缩按钮在事务完成前锁定，压缩按钮显示旋转状态，底部显示 `Compacting context...`。
- 重复点击压缩会复用同一事务，不再向 Harness 并发提交第二个 `/compact`；成功通知使用普通信息样式，只有失败使用红色。
- 待发送（含 Vision 处理中）用户消息固定在已有历史之后，不再因历史 DOM 重排跑到旧任务上方。

## [0.1.19] - 2026-08-21

### Fixed

- 手动压缩改用 Harness rc.7 的官方 `commands/execute` RPC 路由，并兼容实际的直接 `CommandExecution` 返回格式与生成客户端可能保留的 `RemoteResult` 包装。
- bundled runtime smoke 现在会创建隔离空会话并真实执行 `/compact`，防止仅检查 Gateway 启动而遗漏压缩协议回归。
- 连续加载多页较早历史时，消息节点会在任务边界变化后重新挂载并按序重排，不再出现旧任务替换、消失或跑到当前任务下方。
- 历史加载按钮在请求期间立即锁定并显示加载动画；插队消息使用紧凑的 `YOU · STEER` 样式与任务起始消息区分。

## [0.1.18] - 2026-08-21

### Fixed

- `Load earlier messages` 合并后按消息序列重排顶层任务，较早历史固定插入当前内容上方。
- 历史加载按钮点击后立即禁用并显示旋转状态，直到 Host 明确完成。
- 中途插入的用户消息使用更紧凑的右侧卡片和 `YOU · STEER` 标签，与整轮起始消息区分。
- Harness RC 检查改为协议系列兼容：`0.1.0-rc.6` 与 `0.1.0-rc.7` 可互用并记录警告，不再因市场升级或共享 runtime 的 RC 修订差异阻止启动。

## [0.1.17] - 2026-08-21

### Fixed

- 任务内部固定按 `YOU → intermediate process → ASSISTANT` 排列，即使 Harness 历史事件中的 reasoning/tool 早于用户消息投影出现，也不会把过程折叠放到用户消息上方。

## [0.1.16] - 2026-08-21

### Fixed

- 统一任务与过程折叠按钮尺寸、颜色和边界，修复用户消息左边框被任务容器覆盖的问题。
- `YOU` 与 `ASSISTANT` 标签始终可见；`Edit / Steer` 仅允许出现在真实运行中任务的最后一条用户消息。
- 空会话或仅有过期 running 投影时不再错误显示停止按钮。
- Show/Hide 过程按钮的箭头现在随折叠状态正确旋转。

### Changed

- 首次载入及向上分页载入的任务默认递归折叠。
- 工具栏折叠按钮现在递归收起所有任务；再次点击仅展开第一层，内部过程、Vision、reasoning 和工具仍保持折叠。

## [0.1.15] - 2026-08-21

### Added

- 图片消息点击发送后立即离开输入框并在对话区显示，Vision 识别和 Harness 提交在后台继续；失败时恢复草稿和附件。
- Vision 识别过程成为独立可折叠层，显示模型、状态和最终识图文本，并可从会话历史恢复。
- 每轮任务新增整轮折叠，内部仍保留过程折叠以及 reasoning、tool、Vision 的独立折叠。
- 长文本生成的临时附件可点击并直接在 VS Code 编辑器中打开。

### Changed

- 用户消息靠右、Assistant 输出靠左，并用低对比色区分。
- Queue、Steer、Auto 直接切换不同图标，菜单同步标记当前模式。
- 520px 以下输入工具栏使用稳定双行布局，长模型名不再覆盖发送控件。

## [0.1.14] - 2026-08-21

- Added Prompt Inspector, delivery mode controls, and active-message Edit / Steer actions.
- Made the runtime model overlay follow the configured provider and model.
- Reduced settings control density and fixed the UI preview bootstrap.

## [0.1.13] - 2026-08-20

### Fixed

- Vision model configuration now starts empty instead of assuming `qwen-vl-plus`.
- Saving Vision URL and key refreshes the inline model suggestions from the endpoint's `/models` response.
- Vision HTTP 401/403/502 errors now explain that endpoint access, model permissions, or upstream image policy may be blocking the request.
- Added a hover explanation for Clipboard versus CLI handoff delivery.
- Vision settings now provide a separate endpoint-model selector while preserving manual model entry. The compact composer menu hides obvious image-generation and review-only models by default and can reveal the complete endpoint catalog.
- Vision requests support an optional `reasoning_effort`; the parameter is omitted by default for cross-provider compatibility.
- The active session remains visible in the tab strip while the runtime is temporarily reporting it as blank.
- Manual compaction HTTP 404 responses now explain that the runtime lacks the RPC and confirm that no context was changed.

## [0.1.12] - 2026-08-20

### Fixed

- 设置面板标题栏新增关闭按钮，并支持按 `Esc` 关闭。
- Vision 模型按钮使用稳定的固定宽度，不再被较长的 Harness 模型名称挤出输入工具栏。
- 折叠 Assistant、User 或 System 消息段时，同时收起紧随其后的 reasoning 和工具调用；重新展开后内部详情仍可单独折叠。

## [0.1.11] - 2026-08-20

### Added

- Added an embedded settings dialog for DeepSeek and Vision URL, model, and key configuration. Keys remain in VS Code SecretStorage and are never returned to the Webview.
- Added a compact Vision model picker beside the composer model control, with compatible `/models` discovery and an inline configuration entry point.
- Added paged loading of older session history when scrolling to the top.
- Added a dedicated Git working-tree change review button.

### Changed

- Replaced the textarea corner resize affordance with an unambiguous horizontal handle above the input; dragging upward increases the height.
- Swapped the compact-thinking and context-configuration button positions for a clearer composer layout.
- Reduced the default long-paste-to-file threshold from 8 KB to 4 KB.

### Fixed

- Preserved message ordering while prepending older history pages and keeping the user's scroll offset.
- Made task-level folding include intermediate reasoning, tool calls, and inserted messages without obscuring the first prompt or final response.

## [0.1.10] - 2026-08-20

### Added

- 已完成任务支持任务级紧凑视图：保留首条用户消息和最终答复，中间 reasoning、工具、阶段性答复与插队消息统一折叠，并可随时展开。
- 已开始的会话选择其他 Agent Preset 时，可确认后创建隔离的新 Preset 会话，并附带有长度上限的 user/assistant 文本交接；原会话和工具状态不变。

### Changed

- 空白会话不再占用顶部 tab，也不显示 `Start new session` 占位页；没有活动会话时直接发送会自动创建会话。
- 图片在粘贴或拖入时立即检查 Vision endpoint、model 和 SecretStorage key，配置不完整时先提示配置，不再等到发送时才失败。
- 输入框支持手动纵向调整高度；流式快照改为 120 ms 合并刷新，reasoning/工具采用惰性 DOM 和有界可视投影，避免长思考阻塞侧栏缩放。

### Fixed

- 内置 Harness 版本校验与实际依赖统一为官方 `0.1.0-rc.7`，不再错误提示 rc.6/rc.7 不匹配。

## [0.1.9] - 2026-08-20

### Added

- 插队发送后显示"排队中"提示条（输入框正上方）：说明消息将在当前 reasoning/工具步骤结束后生效；消息真正进入会话历史后提示条自动消失，也可手动关闭。
- 交接目标菜单与历史菜单的 handoff 文案更新为剪贴板优先：`Copy a take-over prompt to the clipboard, or launch the CLI`，并在详情中说明原会话不受影响。

## [0.1.8] - 2026-08-20

### Added

- 长文本粘贴不再直接进入输入框：粘贴内容超过 `context.pasteFileThreshold`（默认 8 KB）时自动转为附件，输入框上方显示带文件图标的缩略 chip（标注 `saved to file`），可随时删除；发送时才把内容写入插件存储目录并以路径引用给模型。
- 删除长文本附件时同步清理已落盘的文件。

## [0.1.7] - 2026-08-20

### Added

- 升级内置 DeepSeek Harness 运行时到官方 `0.1.0-rc.7`（已实测可读取 rc.6 的会话数据；升级时自动把旧版本 home 的会话迁移到新版本目录）。
- 长文本粘贴自动落盘：粘贴内容超过 `context.pasteFileThreshold`（默认 8 KB）时写入插件存储目录，提示中只给文件路径，模型按需读取，不再撑满上下文。
- 交接到 Codex/Claude 时弹窗选择交付方式（复制接手 prompt / 启动 CLI），文案说明两种方式的区别。

### Fixed

- 删除会话找不到磁盘数据时不再报错：自动改用官方归档移除并从工作台移除，避免"Could not locate persisted data"和删不掉的空白会话。
- 插件注入的消息（系统快照、工具通知、命令回显）不再显示为 "You"，按轮次折叠的边界恢复正确。

## [0.1.6] - 2026-08-20

### Added

- 思考折叠默认开启：Reasoning/Tool 默认收起为一行摘要（`Reasoning · 12K chars`），像紧凑模式一样开箱即用；按钮仍可随时切换。
- 图片粘贴支持：粘贴截图/图片（剪贴板 item）会自动添加为图片附件，并在输入框上方显示可删除的缩略图。
- 统一设置面板：底部设置按钮打开分类菜单（API Key、Vision Key、Vision 端点、Skill 目录、Handoff、运行时与模型），各配置项一键直达。
- 删除/归档最后一个会话后不再自动新建：工作台显示空状态并提供 `Start new session` 按钮手动创建。
- 删除会话后标签立即移除，避免"删除后 tab 仍在、再删报错"。

### Fixed

- 修复附件从不显示的问题：状态渲染未同步附件数据，导致粘贴的图片看不见也删不掉（同时影响所有附件 chips）。
- 渲染对缺失的消息字段做防御，避免异常快照导致对话区白屏。

## [0.1.5] - 2026-08-20

### Added

- 底部图标修复：静态按钮（发送、附加、权限、模型、压缩等）的图标重新显示为内联 SVG。
- 输入框输入 `@` 弹出 Skill 选择：从可配置目录（默认 `~/.codex/skills`）遍历 SKILL.md，选择后插入 `@name`，发送时自动把对应 SKILL.md 正文作为附件注入。设置项 `dedgeDeepSeekHarness.skills.directories`。
- 图片识别：拖入/粘贴/右键添加的图片在发送前调用可配置的 OpenAI 兼容视觉模型（如 Qwen-VL、GLM-4V、GPT-4o）生成文字描述再发给 DeepSeek。设置项 `vision.baseUrl`、`vision.model`，密钥存 SecretStorage（命令 Configure Vision API Key）。
- 思考过程紧凑模式按钮：开启后 Reasoning/Tool 默认折叠，只显示摘要（如 `Reasoning · 12K chars`），流式过程不再自动展开；可单独展开任意一条。
- 按轮次折叠：每条用户消息头部新增本轮折叠按钮，折叠后显示 `N replies hidden`，流式更新期间保持。
- 输出中发送插队（steer）：回复进行时发送按钮变为虚线插队模式，点击后让当前回复立即处理新指令；停止按钮仍可用。官方 `session.prompt` 的 `mode: steer`。
- 交接到 Codex/Claude 默认不再启动 CLI：改为把接手 prompt（现状说明 + 隔离历史）复制到剪贴板，在 VS Code 的 Codex/Claude 扩展里新建会话粘贴即可接手。设置项 `handoff.launchMode`（clipboard/cli）。
- 从 Codex/Claude 导入的会话自动重命名为 `平台: 原会话名`，会话标签不再显示无意义的 id。

### Fixed

- 打开工作台时如果会话列表为空会等待运行时恢复历史会话后再创建新会话，避免重启后总是冒出 `New session` 标签。
- 输出过程中滚动不再跟随：滚离底部后保持阅读位置，滚回底部才恢复跟随（带跳到底部按钮）。
- 拖动窗口大小时弹层重定位合并到动画帧，避免布局抖动。

## [0.1.4] - 2026-08-20

### Fixed

- 修复长时间思考或大量输出导致的 Webview 卡死、UI 变形和输出期间无法调整窗口大小的问题：
  - 会话消息改为增量渲染：只重建实际变化的单条消息，不再在每次流式更新时重绘整段对话并重新解析全部 Markdown。
  - 流式输出中的消息以纯文本渲染（带光标指示），仅在完成后执行一次 Markdown 渲染，避免输出长度增长带来的二次方解析开销。
  - 渲染按动画帧合并，扩展宿主与控制器对状态推送做节流，减少高频流式事件下的 IPC 与快照开销。
  - 流式期间保留用户手动展开/折叠的 Reasoning/Tool 区块；Reasoning 流结束后仍会自动收起。
  - 动态图标改为直接创建 SVG，不再在每次渲染时全文档扫描重建图标。
- 滚动条不再跟随输出：输出过程中可以自由向上翻阅历史，只有停留在底部时才自动跟随；滚离底部时显示「跳到底部」按钮。
- 每条消息（用户/助手/系统）新增折叠按钮，折叠后只保留一行预览；Reasoning/Tool 区块显示旋转箭头，手动折叠状态在流式更新期间保持不变。
- 点击发送后输入框焦点不再丢失，光标和删除键在输出过程中保持可用。
- 输入框支持按 ↑/↓ 浏览之前发送过的内容（空输入或正在浏览历史时生效），重新编辑会自动退出历史浏览。

## [0.1.3] - 2026-08-20

### Fixed

- 权限菜单读取当前 Harness session 的官方 `permissions` projection，切换后重新校验实际生效值，并在切换期间锁定相关控件。
- 停止请求等待 Harness 的实际 idle 状态；事件丢失时主动回查，避免按钮永久停留在“停止中”。
- Codex/Claude 导入的未发送草稿和 handoff 附件保存到 VS Code workspace state，重启窗口后自动恢复。
- Full access 切换增加确认；workspace-write 在 Windows 下明确提示外部工具可能需要一次性 sandbox approval。

## [0.1.2] - 2026-08-17

### Added

- 发布本机 loopback Gateway lease，供 DeDge Orbit 在不读取 API Key 的前提下连接现有 DeepSeek Harness 运行时。

### Changed

- Runtime 停止或异常退出时按进程所有权清理 lease，避免多窗口清理掉其他仍存活实例的地址。
- 平台运行时打包会整体移除 `.bin` 开发 shim，避免无效 Node 启动器进入 VSIX。

### Fixed

- 模型目录加载期间禁用模型、思考深度和发送控件；运行时、活动会话或模型目录未就绪时，前端与扩展宿主都会拒绝提交。
- 移除运行时就绪后自动补发旧草稿的行为，避免选择模型或思考深度后意外发送输入框内容。
- 草稿和附件仅在 Gateway 明确接受请求后清空；拒绝或失败时保留，便于检查后重试。

## [0.1.1] - 2026-08-16

首个公开预览版本，面向 VS Code 的 DeepSeek Harness 原生工作台。上游 Harness 仍处于 developer preview，本版本优先保证可重复安装、Windows 进程边界和跨平台交接的数据隔离。

### Added

- 原生侧边栏工作台：多会话、流式回复、reasoning、工具状态、审批、问题表单、取消、归档和删除。
- 平台专用 VSIX，固定 `@deepseek-ai/dsh@0.1.0-rc.6`、Node.js `22.22.3` 和 pnpm `11.21.0`；激活阶段不安装依赖。
- `SecretStorage` API Key、版本隔离的 `DSH_HOME`、随机 loopback Gateway 端口和进程树清理。
- 编辑器选区、文件、诊断、Git change review，以及 Explorer/编辑器/标签页右键文件附件和输入框拖放/粘贴。
- Host 驱动的模型、reasoning effort、Agent Preset 目录和按 `rpcId` 原子提交的问题表单。
- 上下文占用环、悬停 token 明细、默认 1M 且可配置的上下文窗口、空闲手动压缩和固定 preset 的自动压缩策略。
- Codex、Claude Code 与 DeepSeek Harness 之间的只读、独立文本交接包；外部会话导入只生成新的未发送草稿。
- 标题栏会话 tabs、完整历史选择器、模型菜单视口定位、小尺寸 Lucide 图标和窄窗口稳定的双行工具栏。
- DeepSeek 官方 Base URL、自定义 OpenAI-compatible/sub2 endpoint，以及不依赖 PowerShell/cmd 拼接的 Windows 启动与诊断。
- Node.js 官方完整许可证固定副本、VSIX native binary/许可证审计、跨平台单元测试、CI 和发布维护文档。

### Changed

- 公开发布边界改为固定版本运行时、显式 external 路径和集中式临时目录；不再依赖 PATH、全局 npm 或自动下载。
- Codex 会话发现优先使用官方 app-server 的当前 provider、Active 根会话和官方重命名/recency；只读 JSONL 仅作为严格过滤的回退。
- 历史中的交接正文和 editor context 改为紧凑附件条；完整恢复路径写入输出日志，界面只显示短状态。
- 上下文配置按钮同时说明容量与自动压缩基数，手动压缩按钮仅在代理空闲且能力可用时启用。

### Fixed

- Model and reasoning controls remain disabled while their catalog loads; prompt submission is rejected until the runtime, active session, and model catalog are ready.
- 构建不再清空已准备好的 `dist/runtime`，避免 Windows 大文件或硬链接删除争用。
- 相同 question id 出现在不同请求批次时不再互相覆盖。
- 删除、归档和停止操作增加会话级互斥与即时忙碌状态，防止延迟期间重复提交。
- Codex/Claude 载入不再自动启动 reasoning；停止响应必须收到官方 `{ accepted: true }` 确认。
- Codex rollout 不再跨 session ID 合并，并排除 archived、subagent、guardian、exec、MCP 和未知内部来源。
- 420px 及以下输入区不再让权限、压缩、模型和发送控件互相覆盖；模型/思考深度菜单保持在可视区域内。
- 扩展版本提升到 `0.1.1`，避免同版本 VSIX 缓存更新难以判断。

### Security

- API Key 不进入设置、日志、工作区、交接包或生成 overlay，只通过 VS Code `SecretStorage` 注入本地进程。
- Gateway 固定监听随机 `127.0.0.1`，子进程使用参数数组、`shell: false` 和 `windowsHide: true`。
- 发布审计拒绝 session dump、私钥、常见 provider token、绝对本机路径、Mojibake 和开发期文件进入公开源或 VSIX。

[0.1.14]: https://github.com/EternityFOR/DeDge_DS_HS/releases/tag/v0.1.14
[0.1.15]: https://github.com/EternityFOR/DeDge_DS_HS/releases/tag/v0.1.15
[0.1.16]: https://github.com/EternityFOR/DeDge_DS_HS/releases/tag/v0.1.16
[0.1.17]: https://github.com/EternityFOR/DeDge_DS_HS/releases/tag/v0.1.17
[0.1.18]: https://github.com/EternityFOR/DeDge_DS_HS/releases/tag/v0.1.18
[0.1.19]: https://github.com/EternityFOR/DeDge_DS_HS/releases/tag/v0.1.19
[0.1.20]: https://github.com/EternityFOR/DeDge_DS_HS/releases/tag/v0.1.20
[0.1.21]: https://github.com/EternityFOR/DeDge_DS_HS/releases/tag/v0.1.21
[0.1.22]: https://github.com/EternityFOR/DeDge_DS_HS/releases/tag/v0.1.22
[0.1.23]: https://github.com/EternityFOR/DeDge_DS_HS/releases/tag/v0.1.23
[0.1.24]: https://github.com/EternityFOR/DeDge_DS_HS/releases/tag/v0.1.24
[0.1.25]: https://github.com/EternityFOR/DeDge_DS_HS/releases/tag/v0.1.25
[0.1.26]: https://github.com/EternityFOR/DeDge_DS_HS/releases/tag/v0.1.26
[0.1.27]: https://github.com/EternityFOR/DeDge_DS_HS/releases/tag/v0.1.27
[0.1.28]: https://github.com/EternityFOR/DeDge_DS_HS/releases/tag/v0.1.28
[0.1.29]: https://github.com/EternityFOR/DeDge_DS_HS/releases/tag/v0.1.29
[0.1.30]: https://github.com/EternityFOR/DeDge_DS_HS/releases/tag/v0.1.30
[0.1.31]: https://github.com/EternityFOR/DeDge_DS_HS/releases/tag/v0.1.31
[0.1.32]: https://github.com/EternityFOR/DeDge_DS_HS/releases/tag/v0.1.32
[0.1.33]: https://github.com/EternityFOR/DeDge_DS_HS/releases/tag/v0.1.33
[0.1.34]: https://github.com/EternityFOR/DeDge_DS_HS/releases/tag/v0.1.34
[Unreleased]: https://github.com/EternityFOR/DeDge_DS_HS/compare/v0.1.34...HEAD
[0.1.13]: https://github.com/EternityFOR/DeDge_DS_HS/releases/tag/v0.1.13
[0.1.12]: https://github.com/EternityFOR/DeDge_DS_HS/releases/tag/v0.1.12
[0.1.11]: https://github.com/EternityFOR/DeDge_DS_HS/releases/tag/v0.1.11
[0.1.10]: https://github.com/EternityFOR/DeDge_DS_HS/releases/tag/v0.1.10
[0.1.9]: https://github.com/EternityFOR/DeDge_DS_HS/releases/tag/v0.1.9
[0.1.8]: https://github.com/EternityFOR/DeDge_DS_HS/releases/tag/v0.1.8
[0.1.7]: https://github.com/EternityFOR/DeDge_DS_HS/releases/tag/v0.1.7
[0.1.6]: https://github.com/EternityFOR/DeDge_DS_HS/releases/tag/v0.1.6
[0.1.5]: https://github.com/EternityFOR/DeDge_DS_HS/releases/tag/v0.1.5
[0.1.4]: https://github.com/EternityFOR/DeDge_DS_HS/releases/tag/v0.1.4
[0.1.3]: https://github.com/EternityFOR/DeDge_DS_HS/releases/tag/v0.1.3
[0.1.2]: https://github.com/EternityFOR/DeDge_DS_HS/releases/tag/v0.1.2
[0.1.1]: https://github.com/EternityFOR/DeDge_DS_HS/releases/tag/v0.1.1

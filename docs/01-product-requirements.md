# 需求文档

## 1. 产品定位

wmux 是一个为 AI coding agent、终端多任务和本地开发调试设计的桌面工作台。它不是传统终端模拟器，也不是 tmux 的皮肤，而是把多个终端、浏览器预览、任务状态、命令编排和自动化 API 放进同一个可视化工作区。

参考产品 cmux 官方描述：cmux 是面向多任务的 macOS 原生终端，提供垂直标签、通知环、分屏、内置浏览器和 socket API。官方文档也说明它使用 Window -> Workspace -> Pane -> Surface -> Panel 的层级组织终端和浏览器内容。

参考资料：

- https://cmux.com/zh-CN
- https://cmux.com/zh-CN/docs/concepts
- https://cmux.com/zh-CN/docs/api
- https://cmux.com/docs/browser-automation
- https://cmux.com/docs/custom-commands

## 2. 目标用户

- 高频使用 Claude Code、Codex、Cursor Agent、Gemini CLI 等 AI coding agent 的开发者。
- 同时运行前端、后端、测试、日志、数据库、浏览器预览的全栈工程师。
- 需要用脚本控制终端、切换工作区、发送命令、采集浏览器状态的自动化用户。
- 想要比 tmux 更直观、比 IDE terminal 更强组织能力的开发者。

## 3. 核心价值

- 将多个 agent 会话组织成可见、可切换、可分屏的工作区。
- 将终端和浏览器预览放在同一布局里，减少窗口切换。
- 让脚本和 agent 能通过 CLI/socket 控制 UI、发送通知、标记状态。
- 通过工作区配置一键恢复常用开发环境。
- 通过视觉状态让用户快速知道哪个任务需要关注。

## 4. 范围

### P0：必须实现

- 桌面应用主窗口。
- 左侧垂直工作区列表。
- 创建、关闭、重命名、切换工作区。
- 每个工作区支持水平/垂直分屏。
- 每个 Pane 内支持多个 Surface 标签。
- Surface 类型至少包括 terminal 和 browser。
- Terminal 支持 shell 会话、输入输出、复制粘贴、滚动、基础快捷键。
- Browser 支持打开 URL、刷新、后退、前进、地址栏。
- 本地 CLI：列出工作区、创建工作区、切换工作区、发送文本、通知。
- 本地 socket API：JSON line request/response。
- 工作区布局持久化和恢复。
- 命令面板。
- 通知状态：工作区和 surface 可显示 attention/working/success/error 状态。

### P1：接近 cmux 体验

- 自定义命令配置 `wmux.json`。
- 工作区模板：一键打开前端、后端、浏览器预览、日志。
- Browser surface 自动化：snapshot、screenshot、click、fill、evaluate、console/errors。
- 端口探测：工作区侧栏显示监听端口。
- Git 信息：分支名、仓库路径、dirty 状态。
- Agent 集成：检测 Claude/Codex 等进程输出中的等待输入、错误、完成状态。
- 搜索与过滤工作区。
- 快捷键系统。
- 设置页：终端、浏览器、自动化、安全策略、主题。

### P2：增强项

- 多窗口。
- Session restore 的滚动缓冲恢复。
- 远程 SSH 工作区。
- 录制/回放自动化脚本。
- 插件系统。
- 云端同步配置。
- 原生 macOS menu bar、Sparkle 自动更新。

## 5. 非目标

- 不复制 cmux 的商标、品牌、文案和受保护视觉资产。
- 不要求第一版达到原生 Swift/AppKit 级别的性能。
- 不承诺恢复已退出进程的真实运行状态。
- 不做完整 IDE，不负责代码编辑器主体验。

## 6. 用户故事

1. 作为开发者，我可以创建一个“前端开发”工作区，左边跑 `npm run dev`，右上放浏览器预览，右下跑测试。
2. 作为 AI agent 用户，我可以同时开多个 agent 会话，并从左侧看到哪个会话需要我输入。
3. 作为自动化用户，我可以执行 `wmux send "npm test\n"`，把文本发到当前终端。
4. 作为团队成员，我可以在项目根目录提交 `wmux.json`，让所有人一键打开一致的开发布局。
5. 作为调试者，我可以让脚本在构建失败时调用 `wmux notify` 并在工作区侧栏显示红色状态。

## 7. 成功指标

- 新用户 10 分钟内能创建 2 个工作区、3 个终端 surface、1 个浏览器 surface。
- 80% 常见开发布局可通过 `wmux.json` 一键创建。
- CLI/socket 命令延迟小于 100ms。
- 终端输入延迟在常规开发负载下体感无卡顿。
- 应用崩溃后可恢复工作区布局、surface 名称、cwd、浏览器 URL。
- browser automation 能完成登录页填表、截图、读取标题和控制台错误这类基础任务。


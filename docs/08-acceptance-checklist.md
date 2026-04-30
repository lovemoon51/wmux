# 验收清单

## 1. P0 验收

- [x] 应用可启动并显示主窗口。
- [x] 可创建、重命名、关闭、切换 workspace。
- [x] 左侧 sidebar 显示 workspace 名称、cwd、状态。
- [x] 可在 workspace 内创建 terminal surface。
- [x] terminal 支持交互 shell。
- [x] terminal resize 后 shell 尺寸正确。
- [x] terminal 默认使用 PowerShell，并支持选择可用的 shell profile。
- [x] terminal surface 支持新增、切换、关闭 tab。
- [x] 可水平和垂直分屏。
- [x] 每个 pane 可有多个 surface tab。
- [x] 可创建 browser surface 并打开 URL。
- [x] browser 支持 back/forward/reload。
- [x] surface tab 可拖拽到 pane 四周生成分屏。
- [x] 单 surface pane（包含工具栏 Split 创建的 pane）可拖入其他 pane 四周并保留 shell 会话。
- [x] 应用重启后恢复 workspace、layout、surface 元信息。
- [x] CLI `wmux ping` 可返回成功。
- [x] CLI `wmux list-workspaces` 可列出工作区。
- [x] CLI `wmux send "echo hi\n"` 可写入当前终端。
- [x] socket API 支持 JSON line request/response。
- [x] `wmux notify` 可在 UI 中显示通知。

## 2. P1 验收

- [x] 可读取项目级 `wmux.json`。
- [x] command palette 可搜索并运行 custom command。
- [x] workspace command 可创建包含多个 pane/surface 的布局。
- [ ] sidebar 可显示 git branch。
- [ ] sidebar 可显示监听端口。
- [x] browser automation 支持 navigate、click、fill、eval。
- [x] browser automation 支持 screenshot 和 snapshot。
- [x] terminal 链接可在内置 browser 打开。
- [ ] 设置页可配置 socket 安全模式。
- [ ] 快捷键覆盖 workspace、pane、surface 的高频操作。

## 3. 体验验收

- [x] 1440x900 下 sidebar、terminal、browser 不拥挤。
- [ ] 1280x800 下按钮和 tab 文本不溢出。
- [x] 分屏拖拽时不会明显卡顿。
- [ ] 创建 8 个 terminal surface 后输入仍流畅。
- [ ] 创建 4 个 workspace 后切换无明显延迟。
- [x] Browser surface 与 terminal surface 混排时焦点行为清晰。
- [x] Browser webview 高度与 pane 视口一致，不只渲染局部。
- [x] Browser webview 和网页内容随 pane/window 尺寸变化自适应。
- [x] Browser surface 分屏后保留当前 URL 和可见内容。
- [x] Terminal 滚动条视觉与深色界面一致。
- [x] 命令面板结果可通过键盘完整操作。

## 4. 安全验收

- [ ] 默认 socket 模式不允许任意本地进程控制终端。
- [ ] `allowAll` 模式有明确警告。
- [ ] custom command 首次运行需确认或信任目录。
- [ ] socket token 不写入日志。
- [ ] Browser automation 写文件操作需要明确路径。

## 5. 与 cmux 能力对齐度

达到 80%：

- [ ] workspace/sidebar/split/surface/terminal/browser 全部可用。
- [x] CLI/socket 可控制基本 UI 和 terminal。
- [x] session restore 可恢复布局。

达到 90%：

- [ ] custom commands 和 workspace layout 稳定。
- [ ] browser automation 覆盖常用 DOM/inspection/state 操作。
- [ ] agent 通知和侧栏状态足够可靠。
- [ ] terminal 体验接近日常主力终端。
- [ ] 快捷键和命令面板能覆盖主要工作流。

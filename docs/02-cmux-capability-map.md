# cmux 能力拆解

## 1. 信息来源

本拆解来自 cmux 官网和公开文档：

- 首页：垂直标签、通知环、内置浏览器、分屏、CLI/socket API、GPU 加速、快捷键。
- 核心概念：Window -> Workspace -> Pane -> Surface -> Panel。
- API 文档：CLI 和 Unix socket 共享能力；socket 使用换行分隔 JSON 请求；支持 workspace、surface、send、metadata、utility 等命令。
- 自定义命令文档：项目级或全局 `cmux.json`，支持简单命令和工作区布局命令。
- 浏览器自动化文档：导航、等待、DOM 操作、snapshot、screenshot、JS eval、cookies/storage、console/errors 等。

## 2. 能力映射表

| cmux 能力 | wmux 对应能力 | 优先级 | 实现难度 | 备注 |
| --- | --- | --- | --- | --- |
| 垂直工作区侧栏 | WorkspaceSidebar | P0 | 中 | 显示名称、cwd、git、端口、状态 |
| 通知环/attention | WorkspaceStatus + SurfaceStatus | P0 | 中 | 初期由 CLI/agent hook 主动设置 |
| 分屏 | LayoutTree | P0 | 中 | 递归 split tree |
| Pane 内 surface tabs | SurfaceTabBar | P0 | 中 | 每个 pane 独立 tab 组 |
| Terminal panel | TerminalSurface | P0 | 高 | node-pty + xterm.js |
| Browser panel | BrowserSurface | P0 | 高 | Electron WebContentsView |
| CLI | `wmux` binary | P0 | 中 | Node/Rust 均可 |
| Socket API | Local RPC server | P0 | 中 | JSON line protocol |
| `cmux.json` 自定义命令 | `wmux.json` | P1 | 中 | 兼容 cmux 子集可降低迁移成本 |
| Browser automation | `wmux browser ...` | P1 | 高 | Electron CDP 或 Playwright bridge |
| Session restore | Layout/session store | P0/P1 | 中 | 不恢复 live process |
| 快捷键 | Command registry | P0 | 中 | 全局 command palette |
| 原生轻量 + Ghostty | 暂不追求 | P2 | 很高 | 后续原生化路线 |
| Sparkle 自动更新 | electron-updater | P2 | 低 | macOS 可后置 |

## 3. 80%-90% 复刻边界

### 必须接近

- 信息架构和交互模型：Window、Workspace、Pane、Surface、Panel。
- 用户主要操作：分屏、切换、创建、关闭、命名、运行命令、打开浏览器。
- 自动化能力：CLI/socket 控制 UI 和 terminal/browser surface。
- Agent 工作流：状态提醒、通知、侧栏摘要。

### 可以不完全一致

- 终端渲染引擎不必使用 Ghostty。
- macOS 原生 AppKit 质感不必第一版完全一致。
- 快捷键可以先覆盖高频项。
- Browser automation 可以先覆盖核心命令，不必完整实现所有子命令。
- Session restore 可先恢复布局和元信息，不恢复进程。

## 4. 风险点

- 终端体验是成败核心，node-pty + xterm.js 需要仔细处理中文宽字符、IME、复制粘贴、滚动性能和 shell resize。
- Electron 内嵌浏览器自动化要设计好 target surface 与 CDP session 的绑定。
- Socket API 需要安全策略，避免任意本地进程注入命令。
- Layout tree 状态、真实视图和持久化数据容易不一致，必须用单一状态源。
- Agent 状态识别若完全依赖输出正则会不稳定，需要允许 CLI 显式上报状态。


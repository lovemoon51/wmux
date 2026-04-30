# 技术架构

## 1. 总体选型

推荐第一版采用 Electron + React + TypeScript，原因是它能最快同时获得：

- 可控桌面窗口。
- 多 WebContents/BrowserView 能力。
- 成熟 terminal 前端 xterm.js。
- node-pty 连接本地 shell。
- Node 生态中较低成本的 CLI、socket、配置读取和打包。

cmux 官方强调其 macOS 原生和 libghostty，但从零复刻 80%-90% 能力时，优先级应放在产品行为闭环，而不是一开始追求底层一致。

## 2. 进程模型

```text
Electron Main Process
  - app lifecycle
  - window manager
  - workspace/session store
  - pty manager
  - browser manager
  - socket RPC server
  - CLI bridge

Renderer Process
  - React UI
  - layout tree rendering
  - xterm.js terminal view
  - command palette
  - settings UI

Browser WebContents
  - one BrowserSurface maps to one WebContentsView
  - navigation/state/automation via main process

CLI Process
  - wmux command
  - talks to local socket/named pipe
```

## 3. 模块划分

```text
apps/desktop
  src/main
    app.ts
    windows/
    rpc/
    pty/
    browser/
    session/
    config/
    commands/
  src/renderer
    app/
    components/
    features/workspaces/
    features/layout/
    features/terminal/
    features/browser/
    features/command-palette/
    styles/

packages/cli
  src/index.ts
  src/client.ts
  src/commands/

packages/protocol
  src/schema.ts
  src/types.ts

packages/shared
  src/id.ts
  src/path.ts
  src/logger.ts
```

## 4. 核心状态

Renderer 只负责展示和用户输入，权威状态在 Main Process。

```text
WindowState
  windows[]
  activeWindowId

Workspace
  id
  name
  cwd
  color
  status[]
  layoutTree
  activePaneId

Pane
  id
  surfaceIds[]
  activeSurfaceId

Surface
  id
  type: terminal | browser
  name
  cwd
  status
  metadata

TerminalRuntime
  surfaceId
  ptyProcess
  scrollback snapshot

BrowserRuntime
  surfaceId
  webContentsId
  url
  history
```

## 5. Layout Tree

```ts
type LayoutNode =
  | {
      type: "split";
      id: string;
      direction: "horizontal" | "vertical";
      ratio: number;
      children: [LayoutNode, LayoutNode];
    }
  | {
      type: "pane";
      id: string;
      surfaceIds: string[];
      activeSurfaceId: string;
    };
```

关键原则：

- split ratio 保持 0.1-0.9。
- pane 是 leaf node。
- surface 不直接存在于 tree 中，而由 pane 引用。
- resize、close pane、move surface 都通过 command reducer 修改状态。

## 6. Terminal 实现

- Main 创建 node-pty。
- Renderer 创建 xterm.js。
- IPC 通道：
  - renderer -> main：input、resize、paste、kill。
  - main -> renderer：data、exit、title、status。
- 每个 terminal surface 注入环境变量：
  - `WMUX_WORKSPACE_ID`
  - `WMUX_SURFACE_ID`
  - `WMUX_SOCKET_PATH`
  - `TERM_PROGRAM=wmux`

## 7. Browser 实现

- Main 为每个 browser surface 创建 WebContentsView。
- Renderer 只渲染 chrome UI：地址栏、tab title、loading、错误状态。
- Main 根据当前 pane 的 DOM bounds 放置 WebContentsView。
- Browser automation 通过 WebContents debug protocol 或 Electron API 实现。

## 8. Socket RPC

采用 JSON line 协议：

```json
{"id":"req-1","method":"workspace.list","params":{}}
{"id":"req-1","ok":true,"result":{"workspaces":[]}}
```

设计原则：

- CLI 与外部脚本都走同一协议。
- 方法名按 domain 分组：`workspace.*`、`surface.*`、`browser.*`、`status.*`、`system.*`。
- 默认只允许 wmux 子进程或带 token 的本地请求。

## 9. 持久化

- SQLite：工作区、surface、历史状态、命令运行记录。
- JSON：用户配置、快捷键、自定义命令。
- App data 目录：
  - macOS: `~/Library/Application Support/wmux`
  - Windows: `%APPDATA%/wmux`
  - Linux: `~/.config/wmux`

## 10. 后续原生化路线

当 Electron 版本证明产品价值后，可逐步替换：

- Terminal renderer：xterm.js -> Ghostty/libghostty 或自研 GPU renderer。
- Desktop shell：Electron -> Swift/AppKit。
- Browser：Electron WebContents -> WKWebView。
- CLI/socket/protocol 保持兼容，降低迁移成本。


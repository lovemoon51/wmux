# CLI 与 Socket API 设计

## 1. 协议目标

CLI 和 socket API 是 wmux 接近 cmux 核心能力的关键。它让终端内的 agent、外部脚本和用户都能控制桌面 UI。

协议参考 cmux 的公开文档：本地 socket 接收以换行结尾的 JSON 请求，包含 `id`、`method`、`params`，返回 `ok/result/error`。

## 2. Socket 路径

```text
macOS/Linux: $TMPDIR/wmux.sock or /tmp/wmux.sock
Windows: \\.\pipe\wmux
Debug: /tmp/wmux-debug.sock
Override: WMUX_SOCKET_PATH
```

## 3. 请求/响应

```json
{"id":"req-1","method":"workspace.list","params":{}}
```

```json
{"id":"req-1","ok":true,"result":{"workspaces":[]}}
```

```json
{"id":"req-1","ok":false,"error":{"code":"NOT_FOUND","message":"workspace not found"}}
```

## 4. 安全模式

```text
off       禁用 socket
wmuxOnly 仅允许 wmux 启动的子进程连接
token    需要 WMUX_SOCKET_TOKEN
allowAll 允许本机任意进程连接，仅开发环境建议
```

默认：`wmuxOnly`。

## 5. CLI 命令

### 系统

```bash
wmux ping
wmux identify --json
wmux capabilities --json
```

### 工作区

```bash
wmux list-workspaces
wmux new-workspace --name "Frontend" --cwd .
wmux select-workspace --workspace workspace:1
wmux close-workspace --workspace workspace:1
wmux rename-workspace --workspace workspace:1 --name "API"
```

### Surface

```bash
wmux surface list
wmux surface list --workspace workspace:1
wmux new-terminal --name "Tests" --cwd .
wmux new-browser --url http://localhost:3000 --name Preview
wmux split right
wmux split down
wmux surface focus --surface surface:2
wmux close-surface --surface surface:2
```

### 输入

```bash
wmux send "npm test\n"
wmux send-key enter
wmux paste
```

`send-key` P0 支持 `enter`、`tab`、`escape`/`esc`、`backspace`、`delete`、方向键 `up`/`down`/`left`/`right`，以及 `ctrl+c`、`ctrl+d`、`ctrl+l`。

### 状态和通知

```bash
wmux notify --title "Build complete" --body "All checks passed"
wmux status list
wmux status list --json
wmux clear-status
```

### 浏览器

```bash
wmux browser open https://example.com
wmux browser navigate http://localhost:3000 --surface surface:3
wmux browser screenshot --surface surface:3 --out /tmp/page.png
wmux browser snapshot --surface surface:3
wmux browser click "button[type='submit']" --surface surface:3
wmux browser fill "#email" --text "dev@example.com" --surface surface:3
wmux browser eval "document.title" --surface surface:3
wmux browser console list --surface surface:3
wmux browser errors list --surface surface:3
```

## 6. Socket 方法

| Method | Params | Result |
| --- | --- | --- |
| `system.ping` | `{}` | `{ pong: true }` |
| `system.identify` | `{}` | active ids |
| `system.capabilities` | `{}` | method list |
| `workspace.list` | `{}` | workspace list |
| `workspace.create` | `{ name?, cwd?, layout? }` | workspace |
| `workspace.select` | `{ workspaceId }` | selected workspace |
| `workspace.close` | `{ workspaceId }` | closed workspace |
| `surface.list` | `{ workspaceId? }` | surface list |
| `surface.createTerminal` | `{ paneId?, name?, cwd?, command? }` | surface |
| `surface.createBrowser` | `{ paneId?, name?, url? }` | surface |
| `surface.split` | `{ direction, surfaceId? }` | pane/surface ids |
| `surface.focus` | `{ surfaceId }` | selected surface ids |
| `surface.sendText` | `{ surfaceId?, text }` | ok |
| `surface.sendKey` | `{ surfaceId?, key }` | ok |
| `status.notify` | `{ workspaceId?, title, body? }` | notice |
| `status.clear` | `{ workspaceId? }` | ok |
| `status.list` | `{ workspaceId? }` | workspace status list |
| `browser.navigate` | `{ surfaceId, url }` | ok |
| `browser.snapshot` | `{ surfaceId, selector?, compact? }` | snapshot |
| `browser.screenshot` | `{ surfaceId, path? }` | path/base64 |
| `browser.click` | `{ surfaceId, selector }` | ok |
| `browser.fill` | `{ surfaceId, selector, text }` | ok |
| `browser.eval` | `{ surfaceId, script }` | value |

## 7. 错误码

```text
BAD_REQUEST
UNAUTHORIZED
NOT_FOUND
METHOD_NOT_FOUND
INVALID_STATE
PTY_ERROR
BROWSER_ERROR
TIMEOUT
INTERNAL
```

## 8. 兼容 cmux 的策略

- 命令命名尽量与 cmux 接近，但使用 `wmux` 前缀。
- `wmux.json` 的 workspace layout schema 尽量兼容 cmux 子集。
- 环境变量使用 `WMUX_*`，可选提供 `CMUX_*` 兼容模式，但默认不冒充 cmux。

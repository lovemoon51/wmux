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
wmux config --json
wmux palette open
wmux palette run --query "new terminal"
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
wmux current-workspace
wmux list-surfaces
wmux focus-surface --surface surface:2
wmux new-split --direction vertical
```

### 输入

```bash
wmux send "npm test\n"
wmux send-key enter
wmux send-surface --surface surface:2 "npm test\n"
wmux send-key-surface --surface surface:2 enter
wmux paste
```

`send-key` P0 支持 `enter`、`tab`、`escape`/`esc`、`backspace`、`delete`、方向键 `up`/`down`/`left`/`right`，以及 `ctrl+c`、`ctrl+d`、`ctrl+l`。

### 状态和通知

```bash
wmux notify --title "Build complete" --body "All checks passed"
wmux status set --status running --notice "npm test"
wmux status list
wmux status history --limit 5
wmux status list --json
wmux clear-status
```

`status history` 人类输出按 `time / workspace / status / message` 展示最近事件；`--json` 仍返回 `WorkspaceSummary.recentEvents`，`--limit` 可限制每个 workspace 的事件数量。

### 命令块

```bash
wmux block list --limit 50
wmux block get --block <blockId>
wmux block rerun --block <blockId>
```

### AI

```bash
wmux ai explain --block <blockId>
wmux ai suggest "# 把所有 png 转成 webp"
```

AI 入口需要先在设置里启用 BYOK 配置；未配置时 socket 会返回 `INVALID_STATE`，不会隐式联网。

### 浏览器

```bash
wmux browser open https://example.com
wmux browser navigate http://localhost:3000 --surface surface:3
wmux browser screenshot --surface surface:3 --out /tmp/page.png
wmux browser snapshot --surface surface:3
wmux browser wait "#app" --surface surface:3
wmux browser click "button[type='submit']" --surface surface:3
wmux browser fill "#email" --text "dev@example.com" --surface surface:3
wmux browser type "#email" ".test" --surface surface:3
wmux browser press "#email" Backspace --surface surface:3
wmux browser eval "document.title" --surface surface:3
wmux browser console list --surface surface:3
wmux browser errors list --surface surface:3
wmux browser cookies list --surface surface:3
wmux browser storage list --surface surface:3
wmux browser storage get --key wmux_local --surface surface:3
wmux browser storage set --key wmux_local --value updated --surface surface:3
```

## 6. Socket 方法

| Method | Params | Result |
| --- | --- | --- |
| `system.ping` | `{}` | `{ pong: true }` |
| `system.identify` | `{}` | active ids |
| `system.capabilities` | `{}` | method list |
| `config.list` | `{}` | config sources and commands |
| `palette.open` | `{ query? }` | opened flag |
| `palette.run` | `{ id?, query? }` | selected palette command |
| `workspace.list` | `{ active? }` | workspace list |
| `workspace.create` | `{ name?, cwd? }` | workspace |
| `workspace.select` | `{ workspaceId }` | selected workspace |
| `workspace.close` | `{ workspaceId }` | closed workspace |
| `workspace.rename` | `{ workspaceId, name }` | renamed workspace |
| `surface.list` | `{ workspaceId? }` | surface list |
| `surface.createTerminal` | `{ paneId?, name?, cwd?, command? }` | surface |
| `surface.createBrowser` | `{ paneId?, name?, url? }` | surface |
| `surface.split` | `{ direction }` | pane/surface ids |
| `surface.focus` | `{ surfaceId }` | selected surface ids |
| `surface.sendText` | `{ surfaceId?, text }` | ok |
| `surface.sendKey` | `{ surfaceId?, key }` | ok |
| `status.notify` | `{ workspaceId?, title, body? }` | notice |
| `status.set` | `{ workspaceId?, status, notice? }` | workspace status |
| `status.clear` | `{ workspaceId? }` | ok |
| `status.list` | `{ workspaceId?, limit? }` | workspace status list and recent events |
| `block.list` | `{ surfaceId?, limit? }` | recent command blocks |
| `block.get` | `{ blockId }` | block metadata |
| `block.rerun` | `{ blockId }` | writes command into terminal input |
| `ai.explain` | `{ blockId }` | opens Explain panel and starts a streamed AI request |
| `ai.suggest` | `{ prompt, surfaceId? }` | opens palette AI Suggestions for the active terminal |
| `browser.navigate` | `{ surfaceId, url }` | ok |
| `browser.snapshot` | `{ surfaceId, selector?, compact? }` | snapshot |
| `browser.screenshot` | `{ surfaceId, path? }` | path/base64 |
| `browser.wait` | `{ surfaceId?, selector?, wait?, waitUntil?, timeoutMs? }` | matched selector or load state |
| `browser.click` | `{ surfaceId, selector }` | ok |
| `browser.fill` | `{ surfaceId, selector, text }` | ok |
| `browser.type` | `{ surfaceId, selector, text }` | ok |
| `browser.press` | `{ surfaceId, selector, key }` | ok |
| `browser.eval` | `{ surfaceId, script }` | value |
| `browser.console.list` | `{ surfaceId?, paneId?, workspaceId?, active?, limit? }` | console entries |
| `browser.errors.list` | `{ surfaceId?, paneId?, workspaceId?, active?, limit? }` | error entries |
| `browser.cookies.list` | `{ surfaceId?, paneId?, workspaceId?, active? }` | script-visible cookie entries |
| `browser.storage.list` | `{ surfaceId?, paneId?, workspaceId?, active?, area? }` | storage entries |
| `browser.storage.get` | `{ surfaceId?, paneId?, workspaceId?, active?, area?, key }` | storage value |
| `browser.storage.set` | `{ surfaceId?, paneId?, workspaceId?, active?, area?, key, value }` | ok |

`config.list` 返回的 `commands` 保持兼容旧 `command` 字段；参数化 Workflow 命令会额外包含 `commandTemplate` 与 `args`。项目根目录 `.warp/workflows/*.yaml` 会作为 `workflow` 来源合并进命令列表。通过 `palette.run` 触发这类命令时，renderer 会打开参数表单并把渲染结果写入当前终端输入草稿，不会直接执行。

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

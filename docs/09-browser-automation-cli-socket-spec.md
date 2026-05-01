# Browser Automation CLI/socket 规格设计

## 1. 范围

本规格定义 P0 browser automation 闭环，不包含安全模式、权限确认、跨进程隔离策略和远程调试协议暴露。安全模式放下一阶段，不阻塞本阶段自动化能力。

P0 覆盖：

- `list`
- `navigate`
- `click`
- `fill`
- `eval`
- `snapshot`
- `screenshot`

目标用户是本机 agent、脚本和开发者。所有能力经由 wmux 本地 socket JSON line 协议实现，CLI 只是薄封装。

## 2. 统一协议

### 2.1 Socket request

```json
{"id":"req-1","method":"browser.navigate","params":{"url":"http://localhost:5173"}}
```

字段：

- `id`: 客户端生成的字符串，响应原样返回。
- `method`: browser automation 方法名。
- `params`: 方法参数对象。

### 2.2 Socket success

```json
{"id":"req-1","ok":true,"result":{"surfaceId":"surface-browser-1","url":"http://localhost:5173/"}}
```

### 2.3 Socket error

```json
{"id":"req-1","ok":false,"error":{"code":"TIMEOUT","message":"selector did not appear before timeout","details":{"selector":"button[type=submit]","timeoutMs":5000}}}
```

错误字段：

- `code`: 稳定错误码。
- `message`: 面向人的短消息。
- `details`: 可选，机器可读上下文。

## 3. Browser 实现口径

Browser automation P0 与当前代码保持一致：browser surface 使用 Renderer 内的 Electron `<webview>`。Socket request 由 Main 收到后转发给 Renderer，Renderer 按 `surfaceId` 定位 `<webview>` 并执行自动化动作。

`docs/03-architecture.md` 中曾规划 Main 管理 `WebContentsView`。该方案保留为后续原生化/性能优化路线，不作为 P0 实现口径。P0 规格只要求对外 socket/CLI 语义稳定，未来从 `<webview>` 迁移到 `WebContentsView` 时不得改变方法名、参数、错误码和结果格式。

## 4. Surface 选择

所有 browser 方法都接受同一套 surface 选择参数。

```ts
type BrowserSurfaceSelector = {
  surfaceId?: string;
  paneId?: string;
  workspaceId?: string;
  active?: boolean;
  createIfMissing?: boolean;
};
```

选择规则按顺序执行：

1. 如果传入 `surfaceId`，必须精确命中一个 browser surface，否则返回 `NOT_FOUND` 或 `SURFACE_TYPE_MISMATCH`。
2. 如果传入 `paneId`，优先选择该 pane 的 active surface；若 active surface 不是 browser：
   - 该 pane 内只有一个 browser surface 时，选择该 browser surface。
   - 该 pane 内有多个 browser surface 时，返回 `AMBIGUOUS_TARGET`。
   - 该 pane 内没有 browser surface 时，返回 `NOT_FOUND`。
3. 如果传入 `workspaceId`，优先选择该 workspace active pane 的 active surface；若 active surface 不是 browser：
   - 该 workspace 内只有一个 browser surface 时，选择该 browser surface。
   - 该 workspace 内有多个 browser surface 时，返回 `AMBIGUOUS_TARGET`。
   - 该 workspace 内没有 browser surface 时，返回 `NOT_FOUND`。
4. 如果 `active: true` 或未提供任何 selector，选择当前 active workspace 的 active pane 中的 active surface；若 active surface 不是 browser：
   - 当前 workspace 内只有一个 browser surface 时，CLI 可选择该 browser surface。
   - 当前 workspace 内有多个 browser surface 时，返回 `AMBIGUOUS_TARGET`。
   - 当前 workspace 内没有 browser surface 时，返回 `NOT_FOUND`。
5. `createIfMissing` 只允许 `browser.navigate` 使用。创建 browser surface 后必须立即导航到传入 URL，并返回新 surface 的 id、pane id、workspace id 和最终 URL。
6. 若仍未找到，返回 `NOT_FOUND`。

默认：

```json
{"active":true,"createIfMissing":false}
```

CLI 默认使用 active browser surface。若 active pane 不是 browser，但当前 workspace 中存在多个 browser surface，必须返回 `AMBIGUOUS_TARGET`，提示用户传 `--surface`。禁止静默选择第一个 browser surface。

非 `navigate` 命令传 `--create` 或 `createIfMissing: true` 时返回参数错误：

```json
{"code":"BAD_REQUEST","message":"createIfMissing is only supported by browser.navigate"}
```

## 5. Selector 语义

P0 selector 使用 CSS selector。后续可以扩展 role/text/test-id selector，但 P0 不阻塞。

格式：

```ts
type ElementSelector = string;
```

规则：

- selector 在 browser surface 的主 frame 中执行。
- selector 必须至少匹配一个元素，否则等待到 timeout 后返回 `TIMEOUT`。
- 若匹配多个元素，默认取第一个可见、可交互元素。
- `click` 和 `fill` 默认要求元素可见。
- `fill` 目标必须是 `input`、`textarea` 或 `contenteditable=true` 元素，否则返回 `BAD_REQUEST`。
- selector 不跨 iframe。P0 不支持 frame selector；下一阶段可加 `frameSelector`。

可选参数：

```ts
type SelectorOptions = {
  selector: string;
  timeoutMs?: number;
  wait?: "visible" | "attached" | "none";
};
```

默认：

- `timeoutMs`: `5000`
- `wait`: `visible`

## 6. 等待与 timeout

所有 browser 方法接受：

```ts
type BrowserWaitOptions = {
  timeoutMs?: number;
  waitUntil?: "none" | "domcontentloaded" | "load";
};
```

默认：

- `timeoutMs`: `10000` for `navigate`
- `timeoutMs`: `5000` for selector actions
- `timeoutMs`: `5000` for `snapshot`
- `timeoutMs`: `10000` for `screenshot`
- `waitUntil`: `domcontentloaded` for `navigate`

语义：

- `navigate` 在 webview 导航到目标 URL 后开始等待 `waitUntil`。
- `click` 完成点击后不默认等待导航；用户可传 `waitUntil`。
- `fill` 完成输入后立即返回。
- `wait` 可等待 selector，也可等待当前页面 load state；未传 `--load-wait` 时 selector wait 不额外等待 load。
- `eval` 执行脚本时不额外等待。
- `snapshot` 等待 document 存在即可。
- `screenshot` 等待 webview 有非零尺寸。

### 6.1 Socket 转发 timeout

Browser command 的 `timeoutMs` 必须与 Main -> Renderer 的 socket 转发 timeout 解耦。当前 Main 转发 renderer request 有固定超时保护；实现 P0 前必须把转发超时改为：

```ts
forwardTimeoutMs = Math.max((params.timeoutMs ?? methodDefaultTimeoutMs) + 1000, 5000)
```

要求：

- `browser.navigate --timeout 10000` 不得被 Main 的 5000ms 转发超时提前截断。
- `browser.screenshot --timeout 10000` 同理。
- Renderer 内部负责返回 `TIMEOUT` 的业务错误。
- Main 只在 Renderer 无响应超过 `forwardTimeoutMs` 时返回 socket 层 `TIMEOUT`，message 应说明是 renderer bridge timeout。

## 7. Socket methods

### 7.1 `browser.list`

Params:

```ts
{
  workspaceId?: string;
}
```

Result:

```ts
{
  browsers: Array<{
    surfaceId: string;
    workspaceId: string;
    workspaceName: string;
    paneId: string;
    active: boolean;
    url: string;
    title?: string;
  }>;
}
```

CLI:

```bash
wmux browser list
wmux browser list --json
```

### 7.2 `browser.navigate`

Params:

```ts
{
  surfaceId?: string;
  paneId?: string;
  workspaceId?: string;
  active?: boolean;
  createIfMissing?: boolean;
  url: string;
  timeoutMs?: number;
  waitUntil?: "none" | "domcontentloaded" | "load";
}
```

Result:

```ts
{
  surfaceId: string;
  workspaceId: string;
  paneId: string;
  url: string;
  title?: string;
}
```

Errors:

- `BAD_REQUEST`: url 缺失或无法规范化。
- `NOT_FOUND`: 找不到 browser surface。
- `BROWSER_ERROR`: Electron webview 导航失败。
- `TIMEOUT`: 导航或加载等待超时。

Create semantics:

- `createIfMissing: true` 时，若未找到目标 browser surface，则在目标 workspace active pane 创建 browser surface。
- 创建后必须立即导航到 `url`。
- 若创建成功但导航失败，返回 `BROWSER_ERROR`，并在 `details.surfaceId` 中带上已创建 surface id。

CLI:

```bash
wmux browser navigate http://localhost:5173
wmux browser navigate http://localhost:5173 --surface surface-browser-1
wmux browser navigate http://localhost:5173 --create
wmux browser navigate http://localhost:5173 --wait load --timeout 15000
```

CLI alias:

- `wmux browser open <url>` 是 `wmux browser navigate <url> --create` 的别名。
- 不新增 socket method `browser.open`。
- alias 只存在于 CLI 层，socket 仍发送 `method: "browser.navigate"` 和 `createIfMissing: true`。

### 7.3 `browser.click`

Params:

```ts
{
  surfaceId?: string;
  paneId?: string;
  workspaceId?: string;
  active?: boolean;
  selector: string;
  timeoutMs?: number;
  wait?: "visible" | "attached" | "none";
  waitUntil?: "none" | "domcontentloaded" | "load";
}
```

Result:

```ts
{
  surfaceId: string;
  selector: string;
  matched: number;
  clicked: true;
  url: string;
}
```

Errors:

- `BAD_REQUEST`: selector 缺失或非法。
- `BAD_REQUEST`: 传入 `createIfMissing: true`。
- `NOT_FOUND`: 找不到 browser surface。
- `AMBIGUOUS_TARGET`: surface 选择不唯一。
- `TIMEOUT`: selector 未在 timeout 内满足 wait 条件。
- `BROWSER_ERROR`: 点击失败。

CLI:

```bash
wmux browser click "button[type='submit']"
wmux browser click "#login" --timeout 8000
wmux browser click ".nav a:first-child" --wait attached
```

### 7.4 `browser.fill`

Params:

```ts
{
  surfaceId?: string;
  paneId?: string;
  workspaceId?: string;
  active?: boolean;
  selector: string;
  text: string;
  timeoutMs?: number;
  wait?: "visible" | "attached" | "none";
}
```

Result:

```ts
{
  surfaceId: string;
  selector: string;
  filled: true;
  valueLength: number;
}
```

Errors:

- `BAD_REQUEST`: selector/text 缺失、传入 `createIfMissing: true`，或目标不是可填充元素。
- `NOT_FOUND`: 找不到 browser surface。
- `AMBIGUOUS_TARGET`: surface 选择不唯一。
- `TIMEOUT`: selector 未满足条件。
- `BROWSER_ERROR`: DOM 写入失败。

CLI:

```bash
wmux browser fill "#email" "dev@example.com"
wmux browser fill "textarea[name=prompt]" --text-file prompt.txt
wmux browser fill "[contenteditable=true]" "hello"
```

CLI 规则：

- 第二个位置参数作为 `text`。
- `--text` 显式传文本。
- `--text-file` 从 UTF-8 文件读取文本。
- 同时传位置文本、`--text`、`--text-file` 时返回 CLI 使用错误。

### 7.5 `browser.type`

Params:

```ts
{
  surfaceId?: string;
  paneId?: string;
  workspaceId?: string;
  active?: boolean;
  selector: string;
  text: string;
  timeoutMs?: number;
  wait?: "visible" | "attached" | "none";
}
```

Result:

```ts
{
  surfaceId: string;
  selector: string;
  matched: number;
  typed: true;
  valueLength: number;
}
```

Rules:

- `type` 在当前值末尾追加文本，并触发 `input/change`。
- P0 不模拟逐字符键盘延迟；需要完整键盘事件流时后续单独扩展。
- CLI 文本参数规则与 `browser.fill` 一致。

CLI:

```bash
wmux browser type "#email" ".test"
wmux browser type "#prompt" --text-file prompt.txt
```

### 7.6 `browser.press`

Params:

```ts
{
  surfaceId?: string;
  paneId?: string;
  workspaceId?: string;
  active?: boolean;
  selector: string;
  key: string;
  timeoutMs?: number;
  wait?: "visible" | "attached" | "none";
}
```

Result:

```ts
{
  surfaceId: string;
  selector: string;
  matched: number;
  pressed: true;
  key: string;
}
```

Rules:

- P0 支持常用键：`Enter`、`Tab`、`Escape`/`Esc`、`Backspace`、`Delete`、方向键，以及单字符键。
- 对可编辑元素，`Backspace`、`Delete`、`Enter` 和单字符键会尽量模拟默认文本变化并触发 `input/change`。
- 复杂组合键、快捷键和跨平台真实键盘注入不属于 P0。

CLI:

```bash
wmux browser press "#email" Backspace
wmux browser press "#prompt" Enter
wmux browser press "#email" --key A
```

### 7.7 `browser.wait`

Params:

```ts
{
  surfaceId?: string;
  paneId?: string;
  workspaceId?: string;
  active?: boolean;
  selector?: string;
  timeoutMs?: number;
  wait?: "visible" | "attached" | "none";
  waitUntil?: "none" | "domcontentloaded" | "load";
}
```

Result:

```ts
// selector wait
{
  surfaceId: string;
  selector: string;
  matched: number;
  wait: "visible" | "attached" | "none";
  waitUntil: "none" | "domcontentloaded" | "load";
  url: string;
}

// load-state wait
{
  surfaceId: string;
  waitUntil: "domcontentloaded" | "load";
  url: string;
}
```

Rules:

- 传 `selector` 时等待 selector 满足 `wait`；默认 `wait=visible`。
- 未传 `waitUntil` 时，selector wait 不额外等待 load state。
- 未传 `selector` 时必须传 `waitUntil=domcontentloaded|load`。
- P0 不支持 text/role selector；后续实现 text selector 前必须先补小规格。

Errors:

- `BAD_REQUEST`: selector 和有效 waitUntil 均缺失，或传入 `createIfMissing: true`。
- `NOT_FOUND`: 找不到 browser surface。
- `AMBIGUOUS_TARGET`: surface 选择不唯一。
- `TIMEOUT`: selector 或 load state 未在 timeout 内满足条件。
- `BROWSER_ERROR`: webview 状态读取失败。

CLI:

```bash
wmux browser wait "#app"
wmux browser wait --selector "#app" --wait attached --timeout 8000
wmux browser wait --load-wait load --surface <surfaceId>
```

### 7.8 `browser.eval`

Params:

```ts
{
  surfaceId?: string;
  paneId?: string;
  workspaceId?: string;
  active?: boolean;
  script: string;
  timeoutMs?: number;
}
```

Result:

```ts
{
  surfaceId: string;
  value: unknown;
  valueType: "null" | "boolean" | "number" | "string" | "object" | "array";
}
```

Serialization:

- 返回值必须 JSON-serializable。
- `undefined` 返回 `{ value: null, valueType: "null" }`。
- DOM 节点返回简化描述 `{ tagName, id, className, text }`。
- 循环对象或函数返回 `BROWSER_ERROR`。

Errors:

- `BAD_REQUEST`: script 缺失，或传入 `createIfMissing: true`。
- `NOT_FOUND`: 找不到 browser surface。
- `AMBIGUOUS_TARGET`: surface 选择不唯一。
- `BROWSER_ERROR`: 脚本抛错或返回值不可序列化。
- `TIMEOUT`: 脚本执行超时。

CLI:

```bash
wmux browser eval "document.title"
wmux browser eval "({url: location.href, h1: document.querySelector('h1')?.textContent})" --json
wmux browser eval-file inspect.js --json
```

CLI 输出：

- 默认输出 `value` 的文本形式。
- `--json` 输出完整 socket result JSON。

### 7.9 `browser.snapshot`

Params:

```ts
{
  surfaceId?: string;
  paneId?: string;
  workspaceId?: string;
  active?: boolean;
  selector?: string;
  format?: "text" | "json";
  includeHidden?: boolean;
  maxTextLength?: number;
  timeoutMs?: number;
}
```

Result:

```ts
{
  surfaceId: string;
  url: string;
  title: string;
  format: "text" | "json";
  snapshot: string | BrowserSnapshotNode;
}
```

JSON node:

```ts
type BrowserSnapshotNode = {
  role?: string;
  tag: string;
  id?: string;
  name?: string;
  text?: string;
  selector?: string;
  children?: BrowserSnapshotNode[];
};
```

Text format:

```text
title: Example
url: https://example.com/
body
  h1 "Example Domain" selector="h1"
  a "More information..." selector="a"
```

Snapshot rules:

- 默认从 `document.body` 开始。
- 若传 `selector`，从匹配元素开始。
- `includeHidden=false` 时跳过不可见元素。
- `maxTextLength` 默认 `2000`。
- 每个可交互节点尽量生成可复用 CSS selector。

CLI:

```bash
wmux browser snapshot
wmux browser snapshot --selector main
wmux browser snapshot --json
wmux browser snapshot --out snapshot.txt
```

Errors:

- `BAD_REQUEST`: 传入 `createIfMissing: true`。
- `NOT_FOUND`: 找不到 browser surface。
- `AMBIGUOUS_TARGET`: surface 选择不唯一。
- `TIMEOUT`: snapshot 等待超时。
- `BROWSER_ERROR`: DOM snapshot 失败。

### 7.10 `browser.screenshot`

Params:

```ts
{
  surfaceId?: string;
  paneId?: string;
  workspaceId?: string;
  active?: boolean;
  path?: string;
  format?: "png" | "jpeg";
  fullPage?: boolean;
  selector?: string;
  timeoutMs?: number;
}
```

Result:

```ts
{
  surfaceId: string;
  url: string;
  path?: string;
  mimeType: "image/png" | "image/jpeg";
  bytes: number;
  base64?: string;
}
```

Rules:

- `format` 默认 `png`。
- 若提供 `path`，主进程写文件并返回绝对路径。
- 若不提供 `path`，返回 `base64`。
- `selector` 表示元素截图；P0 可先通过 DOM rect 裁剪当前 viewport。
- `fullPage=true` 表示整页截图；P0 若实现成本高，可先返回 `UNSUPPORTED`，但 CLI 参数先保留。
- 相对路径以当前 CLI 进程 cwd 解析，发送给 socket 前转绝对路径。

Errors:

- `BAD_REQUEST`: 传入 `createIfMissing: true`，或 path/format 参数非法。
- `NOT_FOUND`: 找不到 browser surface。
- `AMBIGUOUS_TARGET`: surface 选择不唯一。
- `TIMEOUT`: 截图等待超时。
- `UNSUPPORTED`: P0 暂不支持的截图模式，例如未实现的 `fullPage=true`。
- `BROWSER_ERROR`: 截图失败。

CLI:

```bash
wmux browser screenshot --out output/playwright/browser.png
wmux browser screenshot --format jpeg --out page.jpg
wmux browser screenshot --selector "#app" --out app.png
wmux browser screenshot --base64
```

### 7.11 `browser.cookies.list`

Params:

```ts
{
  surfaceId?: string;
  paneId?: string;
  workspaceId?: string;
  active?: boolean;
  timeoutMs?: number;
}
```

Result:

```ts
{
  surfaceId: string;
  url: string;
  cookies: Array<{
    name: string;
    value: string;
    url: string;
  }>;
}
```

Rules:

- P0 只读取页面脚本可见的 `document.cookie`。
- HttpOnly cookie、跨站 cookie jar 枚举、cookie set/delete 不属于本命令范围。
- cookie 名和值尽量按 URI component 解码；解码失败时保留原始文本。

CLI:

```bash
wmux browser cookies list --surface <surfaceId>
wmux browser cookies list --surface <surfaceId> --json
```

### 7.12 `browser.storage.list|get|set`

Params:

```ts
{
  surfaceId?: string;
  paneId?: string;
  workspaceId?: string;
  active?: boolean;
  area?: "local" | "session";
  key?: string;
  value?: string;
  timeoutMs?: number;
}
```

Result:

```ts
// browser.storage.list
{
  surfaceId: string;
  url: string;
  area: "local" | "session";
  entries: Array<{ key: string; value: string }>;
}

// browser.storage.get
{
  surfaceId: string;
  url: string;
  area: "local" | "session";
  key: string;
  value: string | null;
  exists: boolean;
}

// browser.storage.set
{
  surfaceId: string;
  url: string;
  area: "local" | "session";
  key: string;
  valueLength: number;
}
```

Rules:

- `area` 默认 `local`，可传 `session`。
- `get` 和 `set` 必须传 `key`；`set` 必须传 `value`。
- P0 不做 storage clear/remove、indexedDB、Cache API 或跨 origin 枚举。

CLI:

```bash
wmux browser storage list --surface <surfaceId>
wmux browser storage list --area session --surface <surfaceId>
wmux browser storage get --key wmux_local --surface <surfaceId>
wmux browser storage set --key wmux_local --value updated --surface <surfaceId>
```

## 8. CLI 参数规范

通用参数：

```text
--surface <surfaceId>
--pane <paneId>
--workspace <workspaceId>
--active
--create
--timeout <ms>
--json
```

规则：

- `--surface`、`--pane`、`--workspace` 至多传一个。
- `--active` 与显式 id 同传时返回 CLI 使用错误。
- `--create` 只允许 `browser navigate`，映射到 `createIfMissing: true`。
- `wmux browser open <url>` 是 CLI alias，等价于 `wmux browser navigate <url> --create`，不新增 socket method。
- `browser click/fill/type/press/wait/eval/snapshot/screenshot/console/errors/cookies/storage --create` 必须返回 CLI 使用错误，exit code `2`。
- `--timeout` 单位毫秒。
- `--json` 输出完整 JSON 响应；否则输出人类可读结果。

CLI exit code：

- `0`: socket `ok=true`。
- `1`: socket 返回业务错误。
- `2`: CLI 参数错误。
- `3`: 无法连接 wmux socket。
- `4`: 响应不是合法 JSON。

## 9. 错误码

Browser automation P0 使用以下错误码：

```text
BAD_REQUEST
NOT_FOUND
SURFACE_TYPE_MISMATCH
AMBIGUOUS_TARGET
BROWSER_ERROR
TIMEOUT
UNSUPPORTED
INVALID_STATE
INTERNAL
```

建议 details：

```ts
{
  surfaceId?: string;
  selector?: string;
  url?: string;
  timeoutMs?: number;
  method?: string;
  candidates?: BrowserSurfaceSummary[];
}
```

`AMBIGUOUS_TARGET` 必须返回 `details.candidates`，用于 CLI 提示可复制的 `--surface <id>`。

## 10. 本地验收脚本

新增脚本：

```json
{
  "scripts": {
    "smoke:browser": "node scripts/smoke-browser-automation.mjs"
  }
}
```

验收脚本流程：

1. `npm run build`
2. 使用独立 `WMUX_USER_DATA_DIR=output/playwright/wmux-browser-smoke-user-data`
3. 使用独立 `WMUX_SOCKET_PATH`
4. 启动 Electron 生产构建。
5. CLI 调 `wmux send "Write-Output \"http://127.0.0.1:<port>/terminal-link\"\r"`，点击 terminal 中的链接，断言内置 browser surface 打开该 URL。
6. CLI 调 `wmux browser navigate "data:text/html,..."`。
7. CLI 调 `wmux browser list --json`，断言包含当前 browser surface。
8. CLI 调 `wmux browser snapshot --json`，断言包含页面标题和按钮。
9. CLI 调 `wmux browser wait "#submit" --json` 和 `wmux browser wait --load-wait domcontentloaded --json`，断言 selector/load-state 等待成功。
10. CLI 调 `wmux browser fill "#name" "wmux"`，再 `eval "document.querySelector('#name').value"`，断言为 `wmux`。
11. CLI 调 `wmux browser type "#name" "typed"` 和 `wmux browser press "#name" Backspace`，断言输入值按预期变化。
12. CLI 调 `wmux browser click "#submit"`，断言页面显示 `clicked: wmux`。
13. CLI 调 `wmux browser eval "document.body.dataset.clicked"`，断言为 `wmux`。
14. CLI 调 `wmux browser screenshot --out output/playwright/browser-automation-smoke.png`，断言文件存在且大于 1KB。
15. CLI 调 `wmux browser screenshot --base64 --json`，断言 `mimeType` 和 `base64` 存在。
16. 创建第二个 browser surface 后调用 `wmux browser snapshot`，断言返回 `AMBIGUOUS_TARGET` 且 CLI 输出候选 `--surface <id>`；再用 `--surface` 精确指定并成功。
17. CLI 调 `wmux browser console list --surface <id> --json` 和 `wmux browser errors list --surface <id> --json`，断言可读取页面 console log/error，且 errors 只返回 error 级别。
18. CLI 导航到同源 HTTP storage 测试页，调用 `wmux browser cookies list --surface <id> --json`，断言可读取脚本可见 cookie。
19. CLI 调 `wmux browser storage list/get/set --surface <id> --json`，断言 localStorage 和 sessionStorage 可读写。
20. 调用 `wmux browser click "#submit" --create`，断言 CLI exit code 为 `2`。
21. 关闭 Electron，清理临时 userData。

测试页面：

```html
<!doctype html>
<title>WMUX Browser Automation Smoke</title>
<script>
  console.log("WMUX_CONSOLE_LOG");
  console.error("WMUX_CONSOLE_ERROR");
</script>
<main>
  <h1>WMUX_BROWSER_AUTOMATION</h1>
  <input id="name" />
  <button id="submit" onclick="document.body.dataset.clicked=document.querySelector('#name').value;document.querySelector('#result').textContent='clicked: '+document.body.dataset.clicked">Submit</button>
  <p id="result"></p>
</main>
```

最小验收输出：

```text
ok browser terminal link opens internal browser
ok browser navigate
ok browser list
ok browser snapshot
ok browser wait
ok browser fill
ok browser type/press
ok browser click
ok browser console/errors list
ok browser eval
ok browser screenshot file
ok browser screenshot base64
ok browser cookies/storage
ok browser ambiguous target
ok browser create rejected for non-navigate
browser automation smoke ok
```

## 11. P0 非目标

- 安全模式、token、allowAll UI 警告。
- iframe selector。
- Playwright role/text selector 语法。
- HttpOnly cookie、cookie set/delete、IndexedDB、Cache API 和跨 origin storage 枚举。
- full page screenshot 的完美实现。
- 跨 workspace 批量浏览器自动化。

## 12. 实现建议

- P0 采用当前 renderer `<webview>` 架构：Renderer 维护 browser surface registry，按 `surfaceId` 定位实际 `<webview>`。
- Socket request 由 Main 收到并转发给 Renderer；Renderer 执行 webview/DOM 操作后返回 response。
- Main 转发 timeout 必须按第 6.1 节由 browser command timeout 派生，不能固定 5000ms。
- 复杂 DOM 操作优先通过 `webview.executeJavaScript` 完成。
- 截图优先使用 webview/Electron 可用截图 API；若 API 不稳定，P0 可由 Renderer 提供 webview rect，由 Main 对窗口区域截图并裁剪。
- 后续迁移到 Main `WebContentsView` 时，保留本规格的 socket/CLI 语义不变。

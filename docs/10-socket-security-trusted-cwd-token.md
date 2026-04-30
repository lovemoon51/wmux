# Socket 安全模式、trusted cwd 与 token 规格

## 1. 范围

本规格定义 wmux 本地 socket 的安全边界与后续实现输入，不开始实现。

它与 `docs/05-cli-socket-api.md` 的安全模式命名保持一致：

```text
off
wmuxOnly
token
allowAll
```

核心原则：

- `trusted cwd` 是用户体验和授权范围提示，不是可靠认证机制。
- 真正的授权边界应是 socket token。
- cwd 可能来自 CLI 参数、环境变量、进程状态或 shell 行为，跨平台不适合作为唯一安全依据。

## 2. 安全模式

### `off`

禁用 socket server。CLI 对 socket API 的调用应返回无法连接或明确的 socket disabled 错误。

### `wmuxOnly`

仅允许 wmux 启动的子进程使用 socket。实现上可以通过 wmux 内 terminal 注入的环境变量识别来源，但该模式不应被视为强认证。

`wmuxOnly` 适合作为用户体验默认：wmux 内打开的 terminal 天然可用，外部进程默认不可用。

### `token`

所有 socket 请求必须携带 `WMUX_SOCKET_TOKEN`。server 侧校验 token，不依赖 cwd。

`token` 是可靠授权边界的 P0 目标。

### `allowAll`

允许本机任意进程连接。仅建议开发和调试使用。UI 必须给出可见警告，CLI/server 日志也应显示当前处于 `allowAll`。

## 3. 默认模式建议

P0 推荐默认口径：

```text
wmuxOnly + token
```

含义：

- wmux 启动时生成 socket token。
- wmux 内 terminal 自动注入 `WMUX_SOCKET_TOKEN`，因此内置 terminal 中的 CLI 默认可用。
- 外部 CLI 默认没有 token，调用 socket 会失败。
- 用户需要显式导出 token 或切换安全模式，外部 CLI 才能访问。

迁移影响：

- 当前无 token 的外部 CLI 调用会从可用变为 `UNAUTHORIZED`。
- smoke 和开发脚本必须通过 wmux 注入环境或测试专用 token 启动。
- 文档需要提示用户：从外部终端控制 wmux 不再是默认开放能力。

如果为了兼容早期开发流程，也可以短期设为 `allowAll`，但必须在 UI 和 README 中标为开发模式，不应作为长期默认。

## 4. Token 生命周期

### 生成

wmux app 启动时生成高熵随机 token。

建议：

- 至少 128 bit 熵。
- 使用 Node/Electron 原生安全随机源。
- token 只用于本机 socket，不用于远程认证。

### 持久化与轮换

P0 推荐不持久化 token：

- 每次 app 启动生成新 token。
- app 重启后 token 自动轮换。
- 降低 token 泄漏后的长期风险。

如果后续需要外部 CLI 在 app 重启后自动恢复访问，可以增加持久化 token，但那应是单独设计项。

## 5. Token 传递

### wmux 内 terminal

wmux 创建 terminal surface 时自动注入：

```text
WMUX_SOCKET_PATH
WMUX_SOCKET_TOKEN
WMUX_SECURITY_MODE
```

这样用户在 wmux 内 terminal 执行 `wmux ...` 时无需额外配置。

### CLI

CLI 优先从环境变量读取：

```text
WMUX_SOCKET_TOKEN
```

如果外部 CLI 没有 `WMUX_SOCKET_TOKEN`，必须明确失败并返回 `UNAUTHORIZED`。P0 不自动查找 token 文件，也不从项目目录、userData 或 cwd 推断 token。

CLI 请求 socket 时应把 token 放在统一位置，建议：

```json
{"id":"req-1","method":"workspace.list","auth":{"token":"..."},"params":{}}
```

若为了兼容旧协议，也可以短期支持 `params.token`，但新规格以顶层 `auth.token` 为准。

### 外部 CLI 与 token 文件

P0 默认不允许外部 CLI 自动读取 token 文件，因为本规格推荐不落盘 token。

如果后续允许 token 落盘，必须另行说明：

- token 文件路径。
- 文件权限。
- Windows ACL 与 Unix mode 差异。
- token 文件是否随 app 退出删除。
- 外部 CLI 是否需要显式 `--token-file` 才读取。

## 6. Token 存储

P0 推荐：

- token 仅保存在主进程内存。
- preload/renderer 只在需要注入 terminal 或发起内部调用时拿到必要值。
- 不写入 workspace state、日志、crash report 或普通配置文件。

如果未来落盘：

- macOS/Linux 默认路径应在 app userData 或 runtime dir 下，文件权限建议 `0600`。
- Windows 应依赖当前用户 profile 下的 app userData，并设置仅当前用户可读的 ACL。
- 任何 token 文件路径都不得放在项目仓库目录中。

## 7. Trusted cwd

trusted cwd 用于表达“哪些项目目录被用户信任”，帮助 UI 提示和授权范围说明。它不能替代 token。

### 信任来源

可信来源可以包括：

- 用户在 GUI 中手动信任当前 workspace cwd。
- 用户创建 workspace 时选择的目录。
- 项目配置 `wmux.json` 所在目录，但仅作为提示来源，不自动等价为强授权。

### 匹配规则

P0 建议：

- 路径先规范化为绝对路径。
- Windows 路径大小写按平台规则处理。
- symlink/canonical path 行为需在实现前明确，P0 可先使用 resolved absolute path。
- 默认只匹配精确 cwd。
- 是否信任父目录由用户显式选择，例如 `trust children`。

### 父目录支持

支持两种信任范围：

```text
exact
children
```

- `exact`: 只信任该目录本身。
- `children`: 信任该目录及其子目录。

默认应为 `exact`，避免误把整个 home 或磁盘根目录纳入信任范围。

### 撤销

用户必须可以撤销 trusted cwd。

P0 可先通过配置文件或简单 UI 完成，后续再做完整 GUI 权限管理。

### 安全声明

trusted cwd 不能用于判断 socket 请求是否授权。原因：

- 外部 CLI 的 cwd 可被调用者随意设置。
- 进程 cwd 在跨平台场景下不总是可验证。
- Windows named pipe 与 Unix socket 获取对端 cwd 的能力不同。
- cwd 不能证明请求来自 wmux 内 terminal。

因此：即使 cwd 命中 trusted cwd，socket 请求仍必须通过 token 校验，除非安全模式是 `allowAll`。

## 8. 未授权错误

未授权统一返回：

```json
{"id":"req-1","ok":false,"error":{"code":"UNAUTHORIZED","message":"socket token missing or invalid"}}
```

要求：

- 错误码统一为 `UNAUTHORIZED`。
- CLI exit code 仍按业务错误处理，即 exit code `1`。
- CLI 文案应提示当前安全模式，以及如何在 wmux 内 terminal 自动获得 token。

## 9. Smoke 覆盖

安全模式 smoke 至少覆盖：

- 无 token 请求失败，返回 `UNAUTHORIZED`。
- 错误 token 请求失败，返回 `UNAUTHORIZED`。
- 正确 token 请求成功。
- `allowAll` 模式下请求成功，并且 UI 或可观测文本中出现警告。
- `allowAll` 警告是验收要求，但不能阻塞 smoke；可以通过配置、日志或 UI 文案观测。
- wmux 内 terminal 自动带 `WMUX_SOCKET_TOKEN`，执行 CLI 成功。

Browser automation smoke 后续需要在 token 模式下运行。实现 token 后，`smoke:browser` 必须在启动 wmux 后拿到或继承正确 token，否则现有 browser CLI 流程会全部变成 `UNAUTHORIZED`。建议 smoke 使用测试专用 `WMUX_SOCKET_TOKEN` 启动 wmux，并让 CLI 子进程继承同一个 token。

## 10. P0 非目标

- 远程访问。
- 多用户权限模型。
- 复杂 ACL。
- 审计日志。
- GUI 权限管理。
- token 持久化与自动发现。
- 基于 cwd 的强认证。
- 网络监听或跨机器控制。

## 11. 实现顺序建议

1. 扩展 socket request 类型，加入 `auth.token`。
2. Main socket server 校验 token，并返回 `UNAUTHORIZED`。
3. wmux terminal 注入 `WMUX_SOCKET_TOKEN`。
4. CLI 自动读取 env token 并写入 request。
5. 增加安全 smoke。
6. 增加 `allowAll` 可见警告。
7. 再考虑 trusted cwd 的 UI 提示和撤销能力。

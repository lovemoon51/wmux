# cmux 对齐 TODO：CLI/API 兼容小包

本阶段只做 CLI/API 兼容小包，不扩 Browser Automation，不改 terminal 交互，不做打包分发。

## TODO

- [x] `wmux --help`
  - 显示现有用法文本。
  - exit code 为 `0`。
  - `wmux help` 行为与 `wmux --help` 一致。
  - smoke 覆盖 `--help` 和 `help`。

- [x] `wmux current-workspace [--json]`
  - 返回当前 active workspace。
  - 人类输出包含 `workspaceId / name / cwd / status`。
  - JSON 输出复用 `WorkspaceSummary` 字段。
  - 无 active workspace 时返回 `NOT_FOUND`。

- [x] 顶层 surface 别名
  - `wmux list-surfaces [--workspace <id>] [--json]` 等价于 `wmux surface list`。
  - `wmux focus-surface --surface <id> [--json]` 等价于 `wmux surface focus`。
  - 人类输出和 JSON 输出保持一致。
  - smoke 覆盖两个别名。

- [x] surface 定向发送别名
  - `wmux send-surface --surface <id> <text> [--json]`。
  - `wmux send-key-surface --surface <id> <key> [--json]`。
  - 必须显式传 `--surface`，不隐式使用 active surface。
  - surface 不存在时返回 `NOT_FOUND`。
  - 非 terminal surface 时返回 `SURFACE_TYPE_MISMATCH`。
  - smoke 覆盖成功发送和错误路径至少各一条。

- [x] `wmux new-split --direction horizontal|vertical [--json]`
  - 在当前 workspace active pane 上创建 split。
  - 新 pane 默认创建 terminal surface。
  - 返回新 paneId / surfaceId / workspaceId。
  - direction 缺失或非法时 CLI exit code 为 `2`。
  - smoke 覆盖 horizontal 或 vertical 至少一种成功路径。

- [x] CLI 帮助文本整理
  - 把新增命令加入用法文本。
  - 保持旧命令名称不变。
  - 不移除 `surface list/focus`、`send`、`send-key` 原命令。

- [x] 文档同步
  - README 增加最小 CLI/API 兼容示例。
  - `docs/05-cli-socket-api.md` 增加新增命令说明。
  - `docs/08-acceptance-checklist.md` 增加对应 smoke 覆盖说明。

## 非目标

- 不实现 Browser Automation 新命令。
- 不实现 cmux metadata/status/progress/log 完整模型。
- 不实现 `.cmux/cmux.json` 兼容入口。
- 不做 UI 大改。
- 不做打包、自动更新或安装器。

## 建议提交边界

一个提交完成全部 CLI/API 兼容小包即可。若实现过程中发现 `new-split` 需要较大重构，可以先把 `new-split` 拆到下一提交，其余命令先闭环。

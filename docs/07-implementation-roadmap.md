# 实施路线图

## 阶段 0：项目初始化，1-2 天

目标：建立可运行桌面应用骨架。

- 初始化 monorepo。
- 配置 Electron + React + TypeScript。
- 配置 ESLint、Prettier、Vitest、Playwright。
- 建立基础窗口、深色主题、应用菜单。
- 建立 protocol/types 包。

交付物：

- `pnpm dev` 可启动桌面窗口。
- 主界面有 sidebar 和空 workspace。

## 阶段 1：终端 MVP，4-6 天

目标：跑通 terminal surface。

- 集成 node-pty。
- 集成 xterm.js。
- 支持创建 terminal surface。
- 支持输入、输出、resize、复制粘贴。
- 支持 cwd 和 shell 选择。
- 注入 `WMUX_*` 环境变量。

交付物：

- 用户可在 wmux 内正常使用 shell。
- 可创建多个 terminal tab。

## 阶段 2：工作区与分屏，5-7 天

目标：实现 cmux 信息架构核心。

- Workspace sidebar。
- Layout tree。
- 水平/垂直 split。
- Pane resize。
- Pane 内 surface tab。
- Close/move/focus surface。
- 快捷键：新建、关闭、切换、分屏。

交付物：

- 单窗口内可以搭建复杂开发布局。

## 阶段 3：持久化与恢复，3-5 天

目标：应用关闭后恢复工作环境。

- SQLite session store。
- window/workspace/surface/layout 持久化。
- browser URL 持久化。
- terminal scrollback 尽力恢复。
- 崩溃恢复保护。

交付物：

- 重启后恢复布局和元信息。

## 阶段 4：CLI/socket，5-7 天

目标：外部脚本可控制 wmux。

- Socket server。
- CLI 包。
- `ping`、`identify`、`list-workspaces`。
- workspace create/select/close。
- surface list/focus/split。
- terminal `send`、`send-key`。
- status set/clear/list。
- 安全模式，规格先行：[Socket 安全模式、trusted cwd 与 token 规格](10-socket-security-trusted-cwd-token.md)。

交付物：

- 可以从终端执行 `wmux send "npm test\n"`。
- agent 可以调用 `wmux notify` 标记工作区。

## 阶段 5：内置浏览器，5-8 天

目标：browser surface 可用于开发预览。

- 创建 browser surface。
- URL toolbar。
- back/forward/reload。
- terminal 链接在 wmux browser 打开。
- browser state 持久化。
- 外部浏览器打开按钮。

交付物：

- 用户可把 localhost 预览和终端放在同一个 workspace。

## 阶段 6：自定义命令和模板，4-6 天

目标：项目一键启动布局。

- 读取全局/项目 `wmux.json`。
- command palette 集成。
- simple command。
- workspace command。
- restart 策略：ignore/recreate/confirm。
- 配置校验和错误提示。

交付物：

- 项目可提交 `wmux.json` 实现团队共享布局。

## 阶段 7：浏览器自动化，7-12 天

目标：达到 cmux browser API 的核心子集。

- P0 规格先行：[Browser Automation CLI/socket 规格设计](09-browser-automation-cli-socket-spec.md)。
- identify/open/navigate/url。
- wait selector/text/load-state。
- click/fill/type/press。
- snapshot/screenshot/get。
- eval。
- console/errors。
- cookies/storage 基础能力。

交付物：

- 脚本可控制内置浏览器完成常见验证流程。

## 阶段 8：Agent 集成与通知，5-8 天

目标：增强 AI coding agent 工作流。

- 状态 ring。
- Notification center。
- Agent 输出模式识别。
- 显式状态上报 helper。
- 工作区侧栏显示最近事件。
- 端口和 git 信息探测。

交付物：

- 多 agent 并行时，用户能快速看到谁需要关注。

## 阶段 9：打包和 beta，4-7 天

目标：可分发测试。

- electron-builder。
- macOS 签名、公证。
- Windows installer。
- 自动更新。
- 崩溃日志。
- 性能基准。

交付物：

- 可发给真实用户测试的 beta 包。

## 总周期估算

- 单人全职：8-12 周可达 alpha/beta。
- 两人小队：5-8 周可达 beta。
- 想达到 cmux 90% 体验：至少 3-4 个月持续打磨终端、浏览器和自动化细节。


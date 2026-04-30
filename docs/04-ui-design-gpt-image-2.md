# UI 设计与 gpt-image-2 资产流程

## 1. 视觉目标

wmux 的 UI 应该服务于高频开发工作，而不是营销页式视觉。整体风格建议：

- 安静、紧凑、扫描效率高。
- 侧栏信息密度高但不过载。
- 主工作区让终端和浏览器内容成为第一视觉层级。
- 状态色克制，仅用于 attention、running、success、error。
- 避免大面积紫蓝渐变、装饰性光斑、过度圆角卡片。

## 2. 主界面布局

```text
┌────────────────────────────────────────────────────────────┐
│ Titlebar: traffic lights | project | command | status       │
├──────────────┬─────────────────────────────────────────────┤
│ Workspace    │ Pane A                                      │
│ Sidebar      │ ┌ Surface tabs ───────────────────────────┐ │
│              │ │ terminal                                │ │
│ - agent #1   │ └─────────────────────────────────────────┘ │
│ - web dev    ├─────────────────────────────────────────────┤
│ - tests      │ Pane B                                      │
│ - logs       │ ┌ browser toolbar ────────────────────────┐ │
│              │ │ embedded browser preview                │ │
└──────────────┴─────────────────────────────────────────────┘
```

## 3. 关键组件

### Workspace Sidebar

- 宽度：220-280px，可调整。
- 每项展示：
  - 工作区名称。
  - cwd 或 repo name。
  - git branch pill。
  - 端口 pill，例如 `3000`、`5173`。
  - 状态 ring：idle/running/attention/error。
  - 最近通知摘要，一行截断。

### Pane

- 支持水平/垂直分割。
- 分割线宽 4px，可拖拽。
- hover 时显示淡色 resize handle。
- 空 pane 显示快捷操作：terminal、browser、command。

### Surface Tab Bar

- 每个 pane 独立。
- terminal surface 使用 shell/icon。
- browser surface 使用 globe/icon 或 favicon。
- tab 显示 title、busy/error 状态、close 按钮。

### Terminal Surface

- 背景接近纯黑但不要死黑，建议 `#101214`。
- 默认字体：JetBrains Mono / SF Mono / Menlo。
- 字号：13-14px。
- 行高：1.25-1.35。

### Browser Surface

- 顶部 toolbar：back、forward、reload、URL input、open external、devtools。
- URL input 不使用大圆角胶囊，保持紧凑。
- 错误页提供 reload 和 copy URL。

### Command Palette

- 快捷键：`Cmd+K` / `Ctrl+K`。
- 支持搜索：
  - command。
  - workspace。
  - surface。
  - custom command。
- 结果项展示 icon、标题、描述、快捷键。

## 4. 设计令牌

```css
:root {
  --bg-app: #0f1115;
  --bg-sidebar: #15181d;
  --bg-pane: #101214;
  --bg-elevated: #1b1f26;
  --border-subtle: #2a3038;
  --text-primary: #eceff3;
  --text-secondary: #a9b1bd;
  --text-muted: #707987;
  --accent: #3daee9;
  --success: #58c27d;
  --warning: #e2b84d;
  --danger: #ef6b73;
  --attention: #f59e0b;
  --radius-sm: 4px;
  --radius-md: 6px;
}
```

## 5. gpt-image-2 使用策略

gpt-image-2 不负责生成最终可交互 UI，它用于生成：

- 产品 moodboard。
- 高保真主界面视觉参考。
- 空状态插图。
- 官网/README 截图风格 mockup。
- App icon 候选。
- 状态图标和 onboarding 图示草案。

最终 UI 应由 Figma/代码实现，不能直接把 AI 生成图当作可点击界面。

## 6. 图片生成 Prompt 模板

### 主界面视觉参考

```text
Create a high-fidelity macOS desktop app mockup for a developer terminal workspace named wmux.
The app has a compact vertical workspace sidebar on the left, split panes in the main area, terminal surfaces with code output, and an embedded browser preview surface.
Style: quiet professional developer tool, dense but readable, dark neutral palette, subtle borders, small radius, no marketing hero, no decorative gradient blobs, no oversized typography.
The sidebar shows workspace names, git branch pills, port pills, and small attention rings.
The main area shows one terminal pane and one browser pane split vertically.
Use realistic macOS window chrome, crisp typography, and production-quality UI details.
Aspect ratio 16:10.
```

### App Icon

```text
Design a macOS app icon for wmux, a terminal workspace manager for AI coding agents.
Use an abstract monogram W combined with split panes or terminal cursor motif.
Style: modern macOS icon, dimensional but not glossy, dark graphite base with cyan accent, clear silhouette at small sizes.
No text except the abstract W shape.
1024x1024.
```

### 空工作区插图

```text
Create a subtle in-app empty state illustration for a developer terminal workspace.
Show abstract split panes, a small terminal cursor, and a browser preview outline.
Minimal, flat, restrained, dark UI compatible, no characters, no mascots, no large gradients.
Transparent or very dark background.
```

### README 产品截图

```text
Create a polished product screenshot mockup of wmux, a desktop terminal multitasking app.
Show multiple workspaces in a left sidebar, one active AI agent terminal, a test runner terminal, and an embedded browser preview.
The UI should look real, compact, and useful for software developers.
Avoid fake marketing slogans. Use readable labels such as API server, Frontend, Tests, Preview, main branch.
Aspect ratio 16:9.
```

## 7. 生成到落地流程

1. 用 gpt-image-2 生成 6-10 张主界面方向图。
2. 选 2 张最接近产品目标的图，提取布局、密度、状态表达。
3. 在 Figma 中重建真实组件，不直接描摹不可控细节。
4. 建立 design tokens。
5. 在 React 中实现 Storybook stories：
   - Sidebar idle/running/attention/error。
   - Split panes。
   - Terminal tab bar。
   - Browser toolbar。
   - Command palette。
6. 用 Playwright 截图对比关键视口：1440x900、1280x800、1024x768。
7. 每次改 UI 时检查文本是否溢出、按钮是否跳动、分屏拖拽是否稳定。

## 8. 首版页面清单

- MainWindow
- WorkspaceSidebar
- WorkspaceItem
- PaneSplitView
- SurfaceTabBar
- TerminalSurface
- BrowserSurface
- CommandPalette
- SettingsWindow
- CustomCommandEditor
- EmptyWorkspace
- NotificationCenter


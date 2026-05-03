# wmux 终端体验升级需求文档（参考 Warp）

> 版本：v1.0  
> 状态：待开发（拟交付 codex 实施）  
> 关联文档：`01-product-requirements.md`、`03-architecture.md`、`06-data-model-and-config.md`、`11-cmux-gap-optimization.md`  
> 编码约束：所有新增代码遵循 CLAUDE.md（TypeScript 严格模式、UTF-8 无 BOM、注释/日志/提交信息中文、复用既有 utils）。

## 1. 背景

wmux 已经把"工作台壳"做得相对完整：Workspace/Pane/Surface 多任务编排、内置浏览器、CLI/Socket RPC、`wmux.json` 自定义命令、布局持久化、OSC 通知、终端搜索、URL 点击、WebGL 渲染、字体连字。

但**终端本体仍是传统字符流**——`src/renderer/src/components/TerminalSurface.tsx` 全部交互建立在 xterm.js 逐字节渲染之上：没有结构化的命令单元、没有现代化输入编辑器、没有补全 UI、没有 AI、`wmux.json` 命令是写死字符串。

本需求基于对 Warp 终端（开源/单机部分）的对照分析（见 `.claude/plans/warp-shiny-waterfall.md`），把可单机落地、与 wmux"AI agent 工作台"定位契合的能力转化为可执行的开发任务。

## 2. 总目标

把 wmux 的终端体验从"xterm 套壳"升级为"块化 + 现代输入 + AI 友好"的现代终端，同时**严格保持 wmux 现有的多 surface 工作台定位**——不把终端做成独立产品，而是让块、补全、workflow 与 wmux 的 workspace/CLI/socket 体系打通。

非目标：

- 不做 Warp Drive、共享会话、云端历史等需要后端账号体系的能力。
- 不替换 xterm.js 渲染层，仅在其上叠加块边界与输入接管。
- 不实现完整的远程 SSH 终端（属于 P2 之外）。

## 3. 用户故事

| ID | 角色 | 故事 | 优先级 |
|---|---|---|---|
| US-1 | 开发者 | 在终端跑 `npm test` 后，能用 `Ctrl+↑/↓` 在历史命令块之间跳转，看到每个块的退出码和耗时 | P0 |
| US-2 | 开发者 | 按 `Ctrl+P` 打开命令面板，模糊搜索切换 workspace、运行 `wmux.json` 命令、跳到块 | P0 |
| US-3 | 开发者 | 输入 `git che` 时看到补全 `git checkout`，按 Tab 补完，flag 上 hover 看到说明 | P0 |
| US-4 | AI 用户 | 命令失败后右下角浮出"Explain"，点开把命令+输出+错误尾段送给我配置的 LLM 端点 | P1 |
| US-5 | AI 用户 | 输入 `# 把所有 png 转 webp` 触发 AI 候选命令面板，确认后写入输入框 | P1 |
| US-6 | 开发者 | 在 `wmux.json` 里写 `git rebase {{base}} {{branch}}` 模板，命令面板触发时弹表单填空 | P1 |
| US-7 | 开发者 | 跨 surface 搜索"包含 `npm ERR` 且退出码非 0 的块"，点击直接跳到那次执行 | P1 |
| US-8 | 用户 | 在设置里挑选/导入主题，实时预览终端配色 | P2 |

## 4. 范围与权重总览

按"投入产出比 × 与 wmux 定位契合度 × 解锁后续能力"赋权重 1–10。权重越高越优先。

| # | 模块 | 权重 | 优先级 | 阶段 | 估算工作量 | 解锁后续 |
|---|---|---|---|---|---|---|
| F-1 | 命令面板 Command Palette | 10 | P0 | M1 | 3-5d | F-5、F-6、F-7 |
| F-2 | 命令块 Blocks（OSC 133） | 10 | P0 | M1 | 8-12d | F-3、F-4、F-7 |
| F-3 | 块级状态可视化（退出码/耗时/cwd） | 8 | P0 | M1 | 2-3d | — |
| F-4 | 现代化输入编辑器 | 9 | P0 | M2 | 8-12d | F-5 |
| F-5 | 智能补全（Fig spec） | 7 | P1 | M2 | 5-7d | — |
| F-6 | Workflows 参数化命令 | 7 | P1 | M2 | 3-4d | — |
| F-7 | 块级搜索 + 现代历史（Ctrl+R） | 6 | P1 | M3 | 4-6d | — |
| F-8 | AI 集成（BYOK：解释/转命令） | 8 | P1 | M3 | 5-7d | — |
| F-9 | 状态栏（git/venv/node） | 5 | P2 | M3 | 2-3d | — |
| F-10 | 主题系统 | 4 | P2 | M3 | 2-3d | — |
| F-11 | Notebooks Surface | 2 | P3 | 远期 | 7-10d | — |

阶段划分：

- **M1（P0 基础）**：F-1、F-2、F-3。完成后 wmux 才算"现代终端"。
- **M2（P0 末段 + P1 高权重）**：F-4、F-5、F-6。
- **M3（P1 末段 + P2）**：F-7、F-8、F-9、F-10。
- **远期**：F-11，按用户反馈再决定。

---

## 5. P0 需求详细规格

### F-1 命令面板（Command Palette）

#### 用户故事
- US-2

#### 规格
- 触发键：`Ctrl+P`（macOS `Cmd+P`），可在 settings 中重绑。
- 居中浮层，最大宽 640px，输入框 + 候选列表 + 右侧 hint。
- 候选项分类（用 section header 区隔）：
  1. **Workspaces**：切换、重命名、关闭
  2. **Surfaces**：新建终端 / 浏览器、分屏、关闭当前
  3. **Project Commands**：来自 `wmux.json` 的 commands
  4. **Workflows**（依赖 F-6）：参数化模板
  5. **Blocks**（依赖 F-2）：跳转到指定历史块
  6. **AI Suggestions**（依赖 F-8）：自然语言候选命令
  7. **Settings / Misc**：打开设置、重载配置、退出
- 模糊匹配算法：fzf 风格（首字母优先 + 子串优先），基于 [`fzf`](https://www.npmjs.com/package/fzf) 或 `fuse.js`。
- 最近使用排序：本地存储最近 50 条调用记录，加权排序。
- 键盘交互：`↑/↓` 导航、`Enter` 执行、`Esc` 关闭、`Tab` 进入子菜单（带参数的项）。

#### 技术方案
- 组件库：[`cmdk`](https://cmdk.paco.me/) v1.x（headless，自带键盘交互、虚拟列表、组合输入）。
- 注册表模式：新增 `src/renderer/src/lib/commandRegistry.ts`，导出 `registerCommand(cmd: PaletteCommand)`、`unregisterCommand(id)`、`listCommands(query)`。
- 各模块自注册：App.tsx 启动时把 workspace/surface/wmux.json/blocks 命令注册进去。
- 持久化：`localStorage` 存最近使用次数与时间戳。

#### 数据结构（新增到 `src/shared/types.ts`）
```ts
export type PaletteCommandCategory =
  | "workspace" | "surface" | "project" | "workflow"
  | "block" | "ai" | "settings";

export type PaletteCommand = {
  id: string;
  category: PaletteCommandCategory;
  title: string;
  subtitle?: string;
  keywords?: string[];
  shortcut?: string;
  icon?: string;
  args?: PaletteCommandArg[]; // 参数化命令
  run: (args?: Record<string, string>) => Promise<void> | void;
};

export type PaletteCommandArg = {
  name: string;
  description?: string;
  default?: string;
  required?: boolean;
  // 候选项可静态或动态获取
  options?: string[] | (() => Promise<string[]>);
};
```

#### 关键改动文件
- 新增 `src/renderer/src/components/CommandPalette.tsx`
- 新增 `src/renderer/src/lib/commandRegistry.ts`
- 新增 `src/renderer/src/lib/commandRegistry.test.ts`
- 修改 `src/renderer/src/App.tsx`（注册全局快捷键、注入注册表）

#### 依赖
- npm 新增：`cmdk`、`fzf`

#### 验收标准
- [ ] `Ctrl+P` 打开面板 < 100ms。
- [ ] 输入 1 字符后候选列表更新 < 50ms（1000 条候选下）。
- [ ] 至少注册：切换 workspace、新建 terminal/browser surface、运行 wmux.json 命令、打开 settings。
- [ ] 最近使用排序生效：连续运行 3 次同一命令后，输入空查询时该命令置顶。
- [ ] vitest 覆盖：注册/注销、模糊匹配、最近使用排序。
- [ ] 在 smoke 脚本中能通过 `wmux palette open` socket 接口模拟打开（可选 P1）。

---

### F-2 命令块（Blocks）

#### 用户故事
- US-1

#### 规格
- 一个"块"语义：`prompt 起点 → 命令文本 → 命令输出 → exit code 终点`。
- 视觉：xterm.js 主体不变，**叠加层** DOM 在终端容器之上画块边界（半透明左色条 + 顶部元数据条 + 折叠按钮）。
- 元数据条显示：命令文本（首行省略）、cwd、shell、运行时长、退出码徽章（绿/红/灰）。
- 块级操作（右键菜单 + 块顶部按钮组）：
  - 复制命令
  - 复制输出
  - 复制全部（命令+输出）
  - 重新运行（写入当前 PTY 输入行）
  - 收藏（pin，存到工作区元数据）
  - 跳转/锚定（生成块 URL `wmux://workspace/<ws>/block/<id>`，可在面板里跳）
  - 折叠/展开（默认输出超过 500 行自动折叠）
- 键盘导航：
  - `Ctrl+↑/↓`：在块之间跳焦（视口滚动到目标块顶）
  - `Ctrl+Shift+C`：复制当前聚焦块
  - `Ctrl+Shift+R`：重运行当前聚焦块

#### 技术方案
- **协议**：使用 OSC 133（FinalTerm shell integration）：
  - `OSC 133 ; A ST` —— prompt 开始
  - `OSC 133 ; B ST` —— prompt 结束 / 命令输入开始
  - `OSC 133 ; C ST` —— 命令输出开始
  - `OSC 133 ; D ; <exit_code> ST` —— 命令结束
- **Shell 集成脚本**：在 `scripts/shell-integration/` 下提供 `wmux.bash`、`wmux.zsh`、`wmux.ps1`，由用户在 rc 文件里 `source`。bash 用 `PROMPT_COMMAND`、zsh 用 `precmd`/`preexec`、pwsh 用 `prompt` 函数 + `PSReadLine` hook。
  - 兼容已有 `oscNotifications.ts` 的 OSC 9/99/777 解析。
- **解析层**：在 `src/main/pty/` 新增 `blockParser.ts`，读 PTY 字节流提取 OSC 133 标记，向 renderer 发 IPC 事件 `terminal:block:start | block:command | block:output | block:end`。
- **Renderer 渲染**：`TerminalSurface.tsx` 拆分出子组件 `BlockOverlay.tsx`，监听 IPC 事件维护 `Block[]` state，读取 xterm.js 的行号映射（`terminal.buffer.active.viewportY`）计算块的像素位置，绝对定位画边框。
- **持久化**：复用 `outputBufferPersistence.ts`，扩展存 `Block[]` 元数据（不存全文输出，按需 lazy load）。

#### 数据结构（新增到 `src/shared/types.ts`）
```ts
export type BlockId = string;

export type BlockStatus = "running" | "success" | "error" | "aborted";

export type Block = {
  id: BlockId;
  surfaceId: string;
  workspaceId: string;
  // xterm 行号区间，渲染层用来定位
  startLine: number;
  endLine?: number;
  // 命令文本（OSC 133 B-C 之间的输入）
  command: string;
  cwd?: string;
  shell?: string;
  startedAt: string; // ISO
  endedAt?: string;
  durationMs?: number;
  exitCode?: number;
  status: BlockStatus;
  pinned?: boolean;
  // 输出字节范围，用于 lazy load
  outputByteStart?: number;
  outputByteEnd?: number;
};

export type BlockEvent =
  | { type: "block:start"; surfaceId: string; block: Block }
  | { type: "block:command"; surfaceId: string; blockId: BlockId; command: string }
  | { type: "block:output"; surfaceId: string; blockId: BlockId; chunkBytes: number }
  | { type: "block:end"; surfaceId: string; blockId: BlockId; exitCode: number; endedAt: string };
```

#### 关键改动文件
- 新增 `src/main/pty/blockParser.ts` + 测试
- 新增 `src/main/pty/blockStore.ts`（内存 + 持久化）
- 修改 `src/main/pty/ptyManager.ts`（在 onData 中调用 blockParser）
- 修改 `src/main/pty/outputBufferPersistence.ts`（扩展 schema 存 blocks）
- 新增 `src/renderer/src/components/BlockOverlay.tsx`
- 修改 `src/renderer/src/components/TerminalSurface.tsx`（挂载 overlay）
- 新增 `scripts/shell-integration/wmux.{bash,zsh,ps1}`
- 修改 `README.md`（说明如何启用 shell 集成）

#### 验收标准
- [ ] 启用 shell 集成后，每条命令执行都能产出一个 Block，包含命令、cwd、退出码、耗时。
- [ ] 未启用 shell 集成时降级为"无块模式"——保持原有 xterm 行为，不报错、不丢输出。
- [ ] 块边界 UI 在终端滚动时随 xterm.js 同步，不出现错位（resize/字号变更后重新计算）。
- [ ] 长输出（>500 行）默认折叠，展开后能完整看到原始字节。
- [ ] `Ctrl+↑/↓` 跳块在 1000 条历史块下 < 16ms（一帧）。
- [ ] 重运行块：把命令写入当前输入行（不直接执行），等用户回车——避免误操作。
- [ ] 进入交互式程序（vim/htop/ssh）时不产生伪块，OSC 133 标记缺失就保持无块状态。
- [ ] vitest 覆盖：blockParser 对 OSC 133 序列的提取、嵌套/异常序列的兜底。

---

### F-3 块级状态可视化

#### 用户故事
- US-1（与 F-2 共用）

#### 规格
- 块顶部元数据条左侧：
  - 状态色条（运行中=黄色脉冲，成功=绿，失败=红，中止=灰）
  - 退出码徽章（仅非 0 时高亮）
- 块顶部右侧：
  - 运行时长（运行中实时刷新；结束后定型，>1s 显示 s，>1min 显示 mm:ss）
  - cwd（鼠标 hover 全路径）
  - shell 名称
- 失败块：右下角小图标"Explain with AI"（依赖 F-8 落地后激活；F-8 未实现前隐藏）。

#### 技术方案
- 完全在 `BlockOverlay.tsx` 内部实现，复用 F-2 的 `Block` 数据。
- 运行时长用 `requestAnimationFrame` 节流，每 250ms 刷新一次（避免 60fps 浪费）。
- 颜色变量进 `styles.css` 的 CSS variables，方便 F-10 主题系统接管。

#### 验收标准
- [ ] 退出码 0/非 0/未结束 三种状态视觉区分明显。
- [ ] 运行时长显示符合上述格式。
- [ ] 改变字号（已支持的 +/-）后元数据条不溢出、不遮挡输出。
- [ ] vitest 覆盖：时长格式化函数、状态色映射函数。

---

## 6. P1 需求详细规格

### F-4 现代化输入编辑器

#### 用户故事
- US-3

#### 规格
- 默认行为：当 PTY 处于"非交互式"状态（OSC 133 处于 prompt 等待 = B 之后、C 之前）时，**接管输入**——展示一个独立编辑器替代 xterm.js 的输入区。
- 进入交互式程序（如 vim、less、ssh）后自动让位给 xterm.js 原生输入。判断依据：
  - 收到 alt-screen 切换序列（CSI ?1049h）→ 让位
  - PTY 子进程 isTTY raw mode 变更 → 让位（如能拿到）
  - 用户手动按 `Ctrl+\`Esc\`` → 强制让位/接管切换
- 编辑器能力：
  - 多行（`Shift+Enter` 换行，`Enter` 执行）
  - 选区、剪贴板、撤销重做
  - 命令名/flag/字符串/变量语法高亮（轻量 tokenizer）
  - 当前命令的解析提示气泡（与 F-5 联动）

#### 技术方案
- 选型：[CodeMirror 6](https://codemirror.net/)（比 Monaco 体积小一个数量级，3 万行 vs 50 万行；适合"小输入框"场景）。
- 输入流向：编辑器内容 → `Enter` → `ptyManager.write(surfaceId, content + "\n")` → 编辑器清空。
- shell 提示符的视觉拼接：编辑器前面用 readonly 的"prompt 影像"（从最近一次 OSC 133 A-B 之间的字节渲染），让用户看不出输入区其实是另一个组件。
- alt-screen 切换检测：扩展 `blockParser.ts` 同时监听 CSI 序列。

#### 关键改动文件
- 新增 `src/renderer/src/components/InputEditor.tsx`
- 新增 `src/renderer/src/lib/shellTokenizer.ts`（命令解析）
- 修改 `src/renderer/src/components/TerminalSurface.tsx`（接管/让位状态机）
- 修改 `src/main/pty/blockParser.ts`（扩展 alt-screen 监听）

#### 依赖
- npm 新增：`@codemirror/state`、`@codemirror/view`、`@codemirror/commands`、`@codemirror/language`

#### 验收标准
- [ ] 在 bash/zsh/pwsh 里输入命令体感与原生终端一致（无明显延迟、无双光标）。
- [ ] vim/htop/ssh/python REPL 启动后自动让位，用户按键直达 xterm。
- [ ] 多行编辑：粘贴含换行的脚本能完整保留缩进，Enter 一键执行。
- [ ] 长命令（200+ 字符）水平/垂直滚动正常。
- [ ] 中文/IME 输入不丢字、光标位置正确。
- [ ] vitest 覆盖：tokenizer、接管状态机。
- [ ] 提供 `wmux shell --no-modern-input` 启动开关，便于回退验证。

---

### F-5 智能补全（Fig spec）

#### 用户故事
- US-3

#### 规格
- 触发：F-4 编辑器输入空格、`-`、`/` 等字符后弹出候选浮层。
- 候选项类型：subcommand、flag、文件路径、git 分支、最近 cwd。
- 候选数据来源：
  - [`@withfig/autocomplete`](https://github.com/withfig/autocomplete) 开源 spec 集（MIT，可 vendored 或 npm 安装）
  - 文件路径：通过 main 进程暴露 `fs.readdir` IPC（受 trusted cwd 限制，复用 `10-socket-security` 已有策略）
  - git 分支：`git for-each-ref refs/heads --format="%(refname:short)"`
- 浮层 UI：紧贴光标、最多 8 条、键盘 `↑/↓` 导航、`Tab/Enter` 补全、`Esc` 关闭。

#### 技术方案
- 在 F-4 的 CodeMirror 编辑器中接入 `@codemirror/autocomplete`。
- spec 解析：参考 [`@fig/autocomplete-tools`](https://github.com/withfig/autocomplete-tools) 的 spec runtime（已是开源 SDK）。
- 缓存：spec 编译结果按命令名 LRU 缓存（最多 100 条）。

#### 关键改动文件
- 新增 `src/renderer/src/lib/completion/specLoader.ts`
- 新增 `src/renderer/src/lib/completion/providers/{file,git,history}.ts`
- 修改 `src/renderer/src/components/InputEditor.tsx`（挂载 autocomplete）
- 新增 `src/main/ipc/fsBridge.ts`（受限文件浏览）

#### 依赖
- npm 新增：`@withfig/autocomplete`、`@codemirror/autocomplete`

#### 验收标准
- [ ] 输入 `git che` 候选 `checkout`、`cherry-pick`，回车后命令补全到 `git checkout `。
- [ ] 输入 `git checkout ` 后候选当前 git 仓库分支。
- [ ] 输入 `cat ./src/` 后候选 src 目录下的子项。
- [ ] 候选浮层不阻塞输入，关闭后无残留 DOM。
- [ ] 文件浏览受 trusted cwd 限制，越界请求返回空（与现有 socket 安全模型一致）。
- [ ] vitest 覆盖：spec 解析、provider 排序合并。

---

### F-6 Workflows 参数化命令

#### 用户故事
- US-6

#### 规格
- 扩展 `wmux.json` schema：在 `WmuxCommandConfig` 上增加 `args?: WmuxCommandArg[]`、`commandTemplate?: string`，旧的 `command` 字段保持兼容。
- 命令面板触发带 `args` 的命令时弹出参数表单，填空 → 渲染模板 → 写入当前 surface 输入行（不直接执行，等用户确认）。
- 兼容 [warp-workflows](https://github.com/warpdotdev/workflows) 仓库的 YAML schema：增加 `WmuxWorkflowConfig`（YAML 解析），运行时合并到 commands 列表。

#### 数据结构（扩展 `src/shared/types.ts`）
```ts
export type WmuxCommandArg = {
  name: string;
  description?: string;
  default?: string;
  required?: boolean;
  enum?: string[];
};

export type WmuxCommandConfig = {
  // 既有字段保留
  name: string;
  description?: string;
  keywords?: string[];
  restart?: "ignore" | "recreate" | "confirm";
  // 兼容字段：command（写死字符串）保留；新增 commandTemplate（含 {{var}}）
  command?: string;
  commandTemplate?: string; // 优先于 command
  args?: WmuxCommandArg[];
  confirm?: boolean;
  workspace?: WmuxWorkspaceCommandConfig;
  source?: WmuxConfigSourceKind;
  sourcePath?: string;
};
```

#### 关键改动文件
- 修改 `src/shared/types.ts`
- 修改 `src/main/`（config 加载位置，需先 grep 确认 —— 推测在 wmux.json 解析模块）
- 新增 `src/renderer/src/components/ArgsPromptDialog.tsx`
- 新增 `src/main/config/workflowYamlLoader.ts`（YAML 兼容加载）
- 修改 `wmux.json` 示例（README 同步）
- 修改 `docs/06-data-model-and-config.md`（schema 文档同步）

#### 依赖
- npm 新增：`yaml`（YAML 解析，已是 vite 等链路常见依赖）

#### 验收标准
- [ ] 老的 `command` 字段配置仍正常运行（向后兼容）。
- [ ] 含 `{{name}}` 模板的命令在运行时弹表单。
- [ ] 表单验证：`required` 字段为空时禁用确认按钮。
- [ ] 渲染后的命令文本写入输入行（与 F-4 编辑器对接）；未启用 F-4 时直接 `surface.sendText`。
- [ ] 项目根目录 `.warp/workflows/*.yaml` 被自动加载（与 `wmux.json` 合并）。
- [ ] vitest 覆盖：模板渲染、YAML 解析、args 校验。

---

### F-7 块级搜索 + 现代历史

#### 用户故事
- US-1（导航）、US-7

#### 规格
- 命令面板新增"Blocks"分类，输入查询时模糊匹配命令文本/输出，返回跨 surface 跨 session 结果。
- 进阶筛选语法：`exit:!=0`、`cwd:src/`、`shell:pwsh`、`age:<7d`。
- `Ctrl+R` 打开"历史搜索"专用浮层（与命令面板分离，更紧凑）：
  - 仅搜索命令文本（不搜输出）
  - 显示命令、cwd、上次退出码、最近运行时间
  - `Enter` 把命令写入输入行；`Ctrl+Enter` 直接执行
- 数据源：F-2 的 BlockStore 持久化，落到 SQLite（`docs/03-architecture.md` 已规划）。

#### 技术方案
- SQLite 选型：`better-sqlite3`（同步 API，简化主进程读写；已是 Electron 生态主流）。
- 全文搜索：SQLite FTS5 虚拟表 `blocks_fts`，索引字段 `command`、`output_excerpt`（输出前 4KB）。
- 查询解析器：自写轻量解析器，把 `exit:!=0 cwd:src/` 转成 SQL where 子句。

#### 关键改动文件
- 新增 `src/main/store/sqliteBlocks.ts`（迁移 F-2 的内存 store 到持久化）
- 新增 `src/main/store/blockSearch.ts`（查询解析 + FTS5）
- 修改 `src/renderer/src/components/CommandPalette.tsx`（注册 Blocks 分类）
- 新增 `src/renderer/src/components/HistorySearch.tsx`（Ctrl+R 浮层）

#### 依赖
- npm 新增：`better-sqlite3`

#### 验收标准
- [ ] 1 万条块下，输入查询响应 < 100ms。
- [ ] 进阶筛选语法解析正确（含语法错误时友好提示）。
- [ ] 跨 session 持久化：重启 wmux 后历史块仍可搜索。
- [ ] `Ctrl+R` 体验对齐 fzf history（最近优先、模糊匹配、即按即写入）。
- [ ] vitest 覆盖：查询解析器、SQL 注入防御。

---

### F-8 AI 集成（BYOK）

#### 用户故事
- US-4、US-5

#### 规格
- 设置项 `ai.endpoint`、`ai.apiKey`、`ai.model`：兼容 OpenAI Chat Completions 协议（即覆盖 OpenAI/Azure/Anthropic via gateway/Ollama/任意兼容服务）。
- **三个能力切入点**：
  1. **Explain Block**：失败块右下角"Explain"按钮，把 `{ command, exit_code, cwd, shell, last_4kb_output }` 送给 LLM，结果浮在块下方。
  2. **AI 命令建议（# 触发）**：F-4 编辑器输入 `#` 开头时，按 Enter 把后续文本送给 LLM，返回 1-3 条命令候选注入命令面板的 AI Suggestions 分类。
  3. **Selection → Ask**：右键选中文本 → "Ask AI"，新窗口对话。
- 隐私默认：
  - 不主动联网；用户必须显式点按钮触发。
  - 上下文最多取 4KB 输出尾段，UI 上明示送了什么。
  - 提供"敏感词脱敏"开关（移除疑似 token/密钥）。
- **不维护后端**：所有调用从 renderer 直接走（IPC 主进程做 https 代理仅是为绕过 CORS）。

#### 技术方案
- 复用 OpenAI 兼容协议，无需引入 SDK：直接 `fetch` chat/completions 端点。
- 流式：使用 SSE，结果逐 token 渲染。
- 配置存储：复用现有 settings 持久化机制，apiKey 用 Electron `safeStorage` 加密落盘。

#### 数据结构（新增到 `src/shared/types.ts`）
```ts
export type AiSettings = {
  enabled: boolean;
  endpoint: string;     // e.g. https://api.openai.com/v1
  model: string;        // e.g. gpt-4o-mini
  apiKey?: string;      // 落盘前用 safeStorage 加密
  redactSecrets: boolean;
  maxOutputBytes: number; // 默认 4096
};

export type AiExplainRequest = {
  blockId: BlockId;
  surfaceId: string;
};

export type AiExplainResponse = {
  blockId: BlockId;
  explanation: string;
  suggestions?: string[]; // 可一键执行的修复命令
};
```

#### 关键改动文件
- 新增 `src/main/ai/aiClient.ts`（fetch + SSE 解析）
- 新增 `src/main/ai/redaction.ts`（敏感词脱敏）
- 新增 `src/renderer/src/components/AiExplainPanel.tsx`
- 新增 `src/renderer/src/components/AiSettings.tsx`
- 修改 `src/renderer/src/components/BlockOverlay.tsx`（Explain 按钮）
- 修改 `src/renderer/src/components/InputEditor.tsx`（# 触发）

#### 验收标准
- [ ] 配置 OpenAI 兼容端点后，能成功调用并流式渲染。
- [ ] apiKey 不出现在 settings.json 明文中（`safeStorage` 加密）。
- [ ] 失败块的 Explain 在 30s 内返回首 token；UI 提供"取消"按钮。
- [ ] 脱敏开关启用时，类似 `sk-`、`ghp_`、`AKIA` 前缀的字符串被替换为 `<redacted>`。
- [ ] 未配置 AI 时所有 AI 入口隐藏，不阻塞主流程。
- [ ] vitest 覆盖：脱敏函数、SSE 解析、配置加密读写。

---

## 7. P2 / P3 需求规格

### F-9 状态栏（git/venv/node）

- 终端 surface 顶部增加状态栏（与已有 SurfaceTabBar 同行）：当前 cwd、git 分支 + dirty 标记、Python venv、Node 版本（`.nvmrc` / `package.json` engines）。
- 复用现有 `WorkspaceInspection`（已有 `branch`、`ports`），扩展 `venv?: string`、`nodeVersion?: string`。
- 关键改动：扩展 `src/main/`（workspace inspection 模块，需先 grep 确认）+ 新增 `StatusBar.tsx`。

### F-10 主题系统

- 设置页内主题切换器：内置 5 个主题（Default/Dark/Light/Solarized/Dracula），支持 JSON 主题导入。
- xterm.js 调用 `terminal.options.theme = ...` 热更新；CSS variables 同步驱动 wmux 自身 UI 配色。
- 可批量导入 [iTerm2-Color-Schemes](https://github.com/mbadolato/iTerm2-Color-Schemes) 已转好的 JSON。
- 关键改动：新增 `src/renderer/src/lib/themes/`、`src/renderer/src/components/ThemePicker.tsx`、修改 `styles.css` 用 variables。

### F-11 Notebooks Surface（远期，基础能力已落地）

- 新增第三种 surface 类型：`type: "notebook"`，承载 Markdown + 可执行代码块。
- 数据落到 `.wmux/notebooks/<id>.md`，代码块运行时复用 PTY 通道（隐藏 surface）。
- 已落地基础能力：标题栏/命令面板/CLI/socket 创建入口、Markdown 编辑与预览、代码块隐藏 PTY 运行、`.wmux/notebooks` 读写。后续增强保留为远期 backlog，例如 Notebook 专用导出、富 Markdown 渲染、运行结果持久化。

---

## 8. 数据结构总表

为避免分散，本节列出本需求引入的 TypeScript 类型清单（实际定义已穿插在各 F-x 章节）。codex 实施时应**统一加到 `src/shared/types.ts`**：

- F-1：`PaletteCommand`、`PaletteCommandCategory`、`PaletteCommandArg`
- F-2：`Block`、`BlockId`、`BlockStatus`、`BlockEvent`
- F-6：`WmuxCommandArg` + 扩展 `WmuxCommandConfig.commandTemplate/args`
- F-8：`AiSettings`、`AiExplainRequest`、`AiExplainResponse`

新增 SocketRpcMethod（用于 CLI 联动）：

```ts
export type SocketRpcMethod =
  | /* 既有 method */
  | "palette.open"
  | "palette.run"
  | "block.list"
  | "block.get"
  | "block.rerun"
  | "ai.explain"
  | "ai.suggest"
  | "surface.createNotebook";
```

CLI 子命令同步增加（更新 `docs/05-cli-socket-api.md`）：
```bash
wmux palette open
wmux palette run "Start Dev"
wmux new-notebook --name "Runbook" --notebook-id runbook
wmux block list --surface <id> --limit 50
wmux block rerun --block <id>
wmux ai explain --block <id>
```

---

## 9. 验收清单（可在 `docs/08-acceptance-checklist.md` 追加）

按阶段汇总最终验收门槛：

### M1 出口
- [ ] F-1、F-2、F-3 全部子项验收通过。
- [ ] 启用 shell 集成在 bash/zsh/pwsh 三套 shell 下都能产出正确块。
- [ ] 关闭 shell 集成时无回归（既有 smoke 测试 `npm run smoke:terminal` 通过）。

### M2 出口
- [ ] F-4、F-5、F-6 全部子项验收通过。
- [ ] 现代输入编辑器在 vim/ssh 等交互式程序下自动让位无回归。
- [ ] `wmux.json` 的 v0.x 配置（含 `command` 字段）100% 兼容。

### M3 出口
- [ ] F-7、F-8、F-9、F-10 全部子项验收通过。
- [ ] AI 凭据加密落盘；离线模式下所有 AI 入口隐藏不报错。
- [ ] 主题切换不需要重启应用。

### 横向质量门槛（每个 PR 都查）
- [ ] `npm run type-check` 通过。
- [ ] `npm run lint` 通过。
- [ ] `npm run test` 覆盖新增逻辑。
- [ ] 注释/日志/commit message 全部简体中文（CLAUDE.md 强制）。
- [ ] 不新增重复实现 —— PR 描述说明复用了哪些既有模块。

---

## 10. 风险与缓解

| 风险 | 影响 | 缓解 |
|---|---|---|
| OSC 133 在某些 shell 上注入失败 | 块化能力降级 | 提供降级模式、文档化 troubleshoot；自动检测并 banner 提示用户启用 shell 集成 |
| 现代输入编辑器与 ssh/vim 冲突 | 用户体验劣化 | 严格 alt-screen 检测 + 强制让位快捷键；提供启动参数禁用 |
| CodeMirror 体积增加 | 包体积膨胀 | 按需加载（dynamic import），仅在 surface 激活时引入 |
| AI 凭据泄漏 | 安全/合规 | safeStorage 加密；脱敏开关；不上报遥测 |
| SQLite better-sqlite3 原生模块跨平台 | 打包失败 | electron-rebuild 自动化；CI 在三大平台都 smoke 一次 |
| 块持久化数据膨胀 | 磁盘占用 | 按工作区滚动保留最近 N 条（默认 5000）；提供清理 CLI |

---

## 11. 后续优化路线图

完成本需求后，下一轮可考虑（不在本文档范围）：

1. **协议层升级**：把 socket RPC 的 `block.*`、`ai.*` 暴露给外部 agent（Claude Code/Codex），让 agent 直接读块、解释、改写命令——把 wmux 变成"AI agent 的终端 SDK"。
2. **块共享 / 导出**：把块导出为 Markdown/HAR/Asciinema cast，便于 issue 复现、文档生成（不引入云端，仅本地导出）。
3. **远程 SSH workspace**（P2 → P1 视用户呼声）：基于现有 PTY 抽象 + ssh2，块/输入编辑器在远程会话里同样可用。
4. **录制/回放**：把整个 surface session 录成可回放文件（asciinema 协议），用于 bug 复现、教学。
5. **插件系统**：暴露 PaletteCommand 注册 + Block hook 给第三方 npm 包，覆盖"工具型扩展"的长尾需求。
6. **Notebooks（F-11）正式实施**：根据用户反馈决定是否启动。
7. **原生化探索**：长期（v2.x）评估把 PTY 解析与 SQLite 落到 Rust，渲染保留 web stack；不为性能而原生化，仅在体感瓶颈出现时启动。

---

## 12. 实施提示（给 codex）

- **最小 PR 原则**：F-1 单独一个 PR，F-2 拆成"shell 集成脚本 + blockParser" 与 "BlockOverlay UI" 两个 PR，便于审查。
- **强制中文**：所有注释、日志、commit、PR 描述都用简体中文（CLAUDE.md 已规定）。
- **复用优先**：动手前 grep 现有实现 —— 例如 OSC 解析复用 `oscNotifications.ts` 的工具函数；workspace 状态机复用 `workspaceStatusEvents.ts` 的事件模型。
- **smoke 兜底**：每个 F-x 至少新增 1 条 vitest，跨进程的端到端流程加到 `scripts/smoke-*.mjs`。
- **schema 文档同步**：F-2、F-6、F-8、F-11 改动 schema 时同步更新 `docs/06-data-model-and-config.md` 与 `docs/05-cli-socket-api.md`。
- **不要破坏既有 P0**：cmux 对齐能力（workspace、surface、CLI/socket、wmux.json）在本需求中**只增不改**。

---

附：本需求来源于 `.claude/plans/warp-shiny-waterfall.md` 的 Warp 全景对照分析。如果需要回溯每条特性的"为什么这么排权重"，参考该计划文件。

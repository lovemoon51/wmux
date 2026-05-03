# 数据模型与配置格式

## 1. 配置文件位置

```text
Project: ./wmux.json
Project compatibility fallback: ./.cmux/cmux.json
Global macOS/Linux: ~/.config/wmux/wmux.json
Global Windows: %APPDATA%/wmux/wmux.json
Runtime settings: app userData/settings.json
```

项目配置优先于全局配置。同名 command 由项目配置覆盖。项目根目录存在 `wmux.json` 时只读取它；不存在时才读取 `.cmux/cmux.json` 作为 cmux 兼容入口。两者使用同一套 schema，不引入并行配置模型。

项目根目录的 `.warp/workflows/*.yaml` 与 `.warp/workflows/*.yml` 会被自动加载并合并到命令列表，作为 `workflow` 来源展示。同名 workflow 会随项目 commands 一起覆盖全局 command；若 workflow 与 `wmux.json` command 同名，后加载的 workflow 会覆盖同名项目命令。

## 2. `wmux.json` Schema 草案

```json
{
  "commands": [
    {
      "name": "Start Dev",
      "description": "Start frontend, API, and preview",
      "keywords": ["dev", "frontend", "api"],
      "restart": "confirm",
      "workspace": {
        "name": "Web Dev",
        "cwd": ".",
        "color": "#3daee9",
        "layout": {
          "direction": "horizontal",
          "split": 0.55,
          "children": [
            {
              "pane": {
                "surfaces": [
                  {
                    "type": "terminal",
                    "name": "Frontend",
                    "command": "npm run dev",
                    "focus": true
                  }
                ]
              }
            },
            {
              "direction": "vertical",
              "split": 0.5,
              "children": [
                {
                  "pane": {
                    "surfaces": [
                      {
                        "type": "browser",
                        "name": "Preview",
                        "url": "http://localhost:3000"
                      },
                      {
                        "type": "notebook",
                        "name": "Runbook",
                        "notebookId": "dev-runbook"
                      }
                    ]
                  }
                },
                {
                  "pane": {
                    "surfaces": [
                      {
                        "type": "terminal",
                        "name": "Tests",
                        "command": "npm test -- --watch"
                      }
                    ]
                  }
                }
              ]
            }
          ]
        }
      }
    },
    {
      "name": "Run Tests",
      "command": "npm test",
      "confirm": true
    },
    {
      "name": "Git Rebase",
      "description": "Prepare a rebase command and let the user review it before running",
      "commandTemplate": "git rebase {{base}} {{branch}}",
      "args": [
        {
          "name": "base",
          "description": "Base branch",
          "default": "main",
          "required": true
        },
        {
          "name": "branch",
          "description": "Topic branch",
          "required": true
        }
      ]
    }
  ]
}
```

`command` 保持向后兼容：无参数命令仍会直接写入终端并执行。`commandTemplate` 用于参数化命令，优先于 `command`，模板变量格式为 `{{name}}`。配置带 `args` 或 `commandTemplate` 时会作为 Workflow 出现在命令面板，提交参数后只写入当前终端输入草稿，不会自动追加换行或执行。

Workspace layout 的 `surfaces` 支持三类：

- `terminal`：可带 `command`，创建后写入/执行终端命令。
- `browser`：可带 `url`，用于内置浏览器预览和自动化。
- `notebook`：可带 `notebookId`，正文落到当前 workspace 的 `.wmux/notebooks/<notebookId>.md`；若未配置 `notebookId`，运行时会生成本地 id。

`args` 字段元素结构：

```ts
type WmuxCommandArg = {
  name: string;
  description?: string;
  default?: string;
  required?: boolean;
  enum?: string[];
};
```

`enum` 会在参数表单中渲染为静态候选项。`.cmux/cmux.json` 复用同一 schema。

Warp YAML workflow 映射：

```yaml
name: Git Rebase
command: git rebase {{base}} {{branch}}
tags:
  - git
description: Prepare a rebase command
arguments:
  - name: base
    description: Base branch
    default_value: main
  - name: branch
    description: Topic branch
```

`name` 映射到 command 名称，`command` 映射到 `commandTemplate`，`tags` 映射到 `keywords`，`arguments[].default_value` 映射到 `args[].default`。没有默认值的 YAML argument 在 wmux 中按 required 处理。

## 3. Runtime Settings

`settings.json` 保存本机运行时偏好，不属于项目配置，也不会进入 `wmux.json`。当前字段：

```ts
type AiSettings = {
  enabled: boolean;
  endpoint: string;
  model: string;
  apiKey?: string;
  apiKeySet?: boolean;
  redactSecrets: boolean;
  maxOutputBytes: number;
};
```

`ai.apiKey` 通过 Electron `safeStorage` 加密后落盘，renderer 只读取 `apiKeySet`。`redactSecrets` 启用时，Explain/Suggest 发送上下文前会替换常见 `sk-`、`ghp_`、`AKIA` 与 `token=` 等敏感片段。

## 4. SQLite 表

### windows

```sql
create table windows (
  id text primary key,
  title text,
  bounds_json text not null,
  active_workspace_id text,
  created_at integer not null,
  updated_at integer not null
);
```

### workspaces

```sql
create table workspaces (
  id text primary key,
  window_id text not null,
  name text not null,
  cwd text,
  color text,
  layout_json text not null,
  sort_order integer not null,
  created_at integer not null,
  updated_at integer not null
);
```

### surfaces

```sql
create table surfaces (
  id text primary key,
  workspace_id text not null,
  type text not null,
  name text not null,
  cwd text,
  metadata_json text not null,
  created_at integer not null,
  updated_at integer not null
);
```

`metadata_json` 按 surface 类型保存可恢复的附加信息：`terminal` 记录终端启动上下文，`browser` 记录当前 URL 等浏览器状态，`notebook` 记录 `notebookId`。Notebook 正文不写入 SQLite，而是保存在当前 workspace 的 `.wmux/notebooks/<notebookId>.md`。

### statuses

```sql
create table statuses (
  id text primary key,
  workspace_id text,
  surface_id text,
  key text not null,
  text text not null,
  icon text,
  color text,
  level text,
  created_at integer not null,
  updated_at integer not null
);
```

### command_history

```sql
create table command_history (
  id text primary key,
  command_name text not null,
  source text not null,
  params_json text,
  status text not null,
  created_at integer not null
);
```

## 5. Runtime 不入库的数据

- PTY process handle。
- Browser WebContents handle。
- Notebook 隐藏 PTY 运行会话。
- Socket client connection。
- 瞬时 hover/focus UI 状态。
- 未持久化的 terminal alternate screen 内容。

## 6. Session restore 策略

重启后恢复：

- Window bounds。
- Workspace 列表和顺序。
- Pane split layout。
- Surface 名称、类型、cwd。
- Terminal scrollback 快照，尽力而为。
- Browser URL 和基础 history。
- Notebook surface 元数据，以及 `.wmux/notebooks/*.md` 中已保存的 Markdown 正文。
- Status 元信息。

不恢复：

- 已退出或运行中的真实进程。
- vim/tmux/agent 的运行时内存状态。
- 未保存的 shell 当前命令执行状态。
- Notebook 编辑器里尚未保存的草稿。

# 数据模型与配置格式

## 1. 配置文件位置

```text
Project: ./wmux.json
Global macOS/Linux: ~/.config/wmux/wmux.json
Global Windows: %APPDATA%/wmux/wmux.json
```

项目配置优先于全局配置。同名 command 由项目配置覆盖。

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
    }
  ]
}
```

## 3. SQLite 表

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

## 4. Runtime 不入库的数据

- PTY process handle。
- Browser WebContents handle。
- Socket client connection。
- 瞬时 hover/focus UI 状态。
- 未持久化的 terminal alternate screen 内容。

## 5. Session restore 策略

重启后恢复：

- Window bounds。
- Workspace 列表和顺序。
- Pane split layout。
- Surface 名称、类型、cwd。
- Terminal scrollback 快照，尽力而为。
- Browser URL 和基础 history。
- Status 元信息。

不恢复：

- 已退出或运行中的真实进程。
- vim/tmux/agent 的运行时内存状态。
- 未保存的 shell 当前命令执行状态。


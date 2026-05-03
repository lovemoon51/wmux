export type WorkspaceStatus = "idle" | "running" | "attention" | "success" | "error";

export type SurfaceType = "terminal" | "browser";

export type ShellProfile = "auto" | "pwsh" | "powershell" | "cmd" | "bash" | "zsh";

export type SocketSecurityMode = "off" | "wmuxOnly" | "token" | "allowAll";

export type SocketSecuritySettings = {
  activeMode: SocketSecurityMode;
  configuredMode: SocketSecurityMode;
  pendingRestart: boolean;
  warning?: string;
};

export type WmuxConfigSourceKind = "global" | "project" | "workflow";

export type WmuxSurfaceConfig =
  | {
      type: "terminal";
      name?: string;
      command?: string;
      focus?: boolean;
    }
  | {
      type: "browser";
      name?: string;
      url?: string;
      focus?: boolean;
    };

export type WmuxPaneConfig = {
  surfaces: WmuxSurfaceConfig[];
};

export type WmuxLayoutConfig =
  | {
      pane: WmuxPaneConfig;
    }
  | {
      direction: "horizontal" | "vertical";
      split?: number;
      children: [WmuxLayoutConfig, WmuxLayoutConfig];
    };

export type WmuxWorkspaceCommandConfig = {
  name?: string;
  cwd?: string;
  color?: string;
  layout?: WmuxLayoutConfig;
};

export type WmuxCommandArg = {
  name: string;
  description?: string;
  default?: string;
  required?: boolean;
  enum?: string[];
};

export type WmuxWorkflowConfig = {
  name: string;
  command: string;
  description?: string;
  tags?: string[];
  arguments?: Array<{
    name: string;
    description?: string;
    default_value?: string;
  }>;
};

export type WmuxCommandConfig = {
  name: string;
  description?: string;
  keywords?: string[];
  restart?: "ignore" | "recreate" | "confirm";
  command?: string;
  commandTemplate?: string;
  args?: WmuxCommandArg[];
  confirm?: boolean;
  workspace?: WmuxWorkspaceCommandConfig;
  source?: WmuxConfigSourceKind;
  sourcePath?: string;
};

export type WmuxProjectConfig = {
  commands: WmuxCommandConfig[];
};

export type PaletteCommandCategory =
  | "workspace"
  | "surface"
  | "project"
  | "workflow"
  | "block"
  | "ai"
  | "settings";

export type PaletteCommandArg = {
  name: string;
  description?: string;
  default?: string;
  required?: boolean;
  options?: string[] | (() => Promise<string[]>);
};

export type PaletteCommand = {
  id: string;
  category: PaletteCommandCategory;
  title: string;
  subtitle?: string;
  keywords?: string[];
  shortcut?: string;
  icon?: string;
  args?: PaletteCommandArg[];
  run: (args?: Record<string, string>) => Promise<void> | void;
};

export type PaletteOpenParams = {
  query?: string;
};

export type PaletteRunParams = {
  id?: string;
  query?: string;
};

export type BlockId = string;

export type BlockStatus = "running" | "success" | "error" | "aborted";

export type Block = {
  id: BlockId;
  surfaceId: string;
  workspaceId: string;
  startLine: number;
  endLine?: number;
  command: string;
  cwd?: string;
  shell?: string;
  startedAt: string;
  endedAt?: string;
  durationMs?: number;
  exitCode?: number;
  status: BlockStatus;
  pinned?: boolean;
  outputByteStart?: number;
  outputByteEnd?: number;
};

export type BlockEvent =
  | { type: "block:list"; surfaceId: string; blocks: Block[] }
  | { type: "block:start"; surfaceId: string; block: Block }
  | { type: "block:command"; surfaceId: string; blockId: BlockId; command: string }
  | { type: "block:output"; surfaceId: string; blockId: BlockId; chunkBytes: number }
  | { type: "block:end"; surfaceId: string; blockId: BlockId; exitCode: number; endedAt: string };

export type AiSettings = {
  enabled: boolean;
  endpoint: string;
  model: string;
  apiKey?: string;
  apiKeySet?: boolean;
  redactSecrets: boolean;
  maxOutputBytes: number;
};

export type AiSettingsUpdate = Partial<Omit<AiSettings, "apiKeySet">>;

export type AiExplainRequest = {
  requestId: string;
  blockId: BlockId;
  surfaceId: string;
};

export type AiExplainResponse = {
  requestId: string;
  blockId: BlockId;
  explanation: string;
  suggestions?: string[];
};

export type AiSuggestRequest = {
  requestId: string;
  prompt: string;
  cwd?: string;
  shell?: ShellProfile;
};

export type AiSuggestResponse = {
  requestId: string;
  suggestions: string[];
};

export type AiCancelRequest = {
  requestId: string;
};

export type AiStreamEvent =
  | { requestId: string; type: "token"; token: string }
  | { requestId: string; type: "done" }
  | { requestId: string; type: "error"; error: string };

export type TerminalInputModeEvent =
  | { type: "input:prompt-ready"; surfaceId: string; sessionId: string; source: "osc133" }
  | { type: "input:command-started"; surfaceId: string; sessionId: string; command?: string }
  | { type: "input:alt-screen"; surfaceId: string; sessionId: string; active: boolean };

export type CompletionDirectoryEntryKind = "file" | "directory";

export type CompletionDirectoryEntry = {
  name: string;
  kind: CompletionDirectoryEntryKind;
  relativePath: string;
};

export type CompletionListDirectoryParams = {
  workspaceId: string;
  cwd: string;
  query: string;
  includeHidden?: boolean;
  limit?: number;
};

export type CompletionListDirectoryResult = {
  entries: CompletionDirectoryEntry[];
};

export type CompletionListGitBranchesParams = {
  workspaceId: string;
  cwd: string;
  prefix?: string;
  limit?: number;
};

export type CompletionListGitBranchesResult = {
  branches: string[];
};

export type BlockListParams = {
  surfaceId?: string;
  limit?: number;
};

export type BlockGetParams = {
  blockId: string;
};

export type BlockRerunParams = {
  blockId: string;
};

export type WmuxConfigSource = {
  kind: WmuxConfigSourceKind;
  path: string;
  found: boolean;
  commandCount: number;
  /** Compatibility fallback: project sources can be ./wmux.json or ./.cmux/cmux.json. */
  errors: string[];
};

export type WmuxProjectConfigResult = {
  path: string;
  found: boolean;
  config: WmuxProjectConfig;
  errors: string[];
  sources?: WmuxConfigSource[];
};

export type WorkspaceInspection = {
  cwd: string;
  branch?: string;
  ports: number[];
  pullRequest?: PullRequestSummary;
};

// PR 状态：open/draft/merged/closed —— 来源 gh CLI，缺失时 undefined
export type PullRequestState = "open" | "draft" | "merged" | "closed";

export type PullRequestSummary = {
  number: number;
  state: PullRequestState;
  title?: string;
  url?: string;
};

export type SocketRpcMethod =
  | "system.ping"
  | "system.identify"
  | "system.capabilities"
  | "config.list"
  | "palette.open"
  | "palette.run"
  | "workspace.list"
  | "workspace.create"
  | "workspace.select"
  | "workspace.close"
  | "workspace.rename"
  | "surface.list"
  | "surface.createTerminal"
  | "surface.createBrowser"
  | "surface.split"
  | "surface.focus"
  | "surface.sendText"
  | "surface.sendKey"
  | "status.notify"
  | "status.set"
  | "status.clear"
  | "status.list"
  | "block.list"
  | "block.get"
  | "block.rerun"
  | "ai.explain"
  | "ai.suggest"
  | BrowserRpcMethod;

export type SocketRpcRequest = {
  id: string;
  method: SocketRpcMethod | string;
  auth?: {
    token?: string;
  };
  params?: unknown;
};

export type SocketRpcErrorCode =
  | "BAD_REQUEST"
  | "METHOD_NOT_FOUND"
  | "UNAUTHORIZED"
  | "INVALID_STATE"
  | "NOT_FOUND"
  | "SURFACE_TYPE_MISMATCH"
  | "AMBIGUOUS_TARGET"
  | "BROWSER_ERROR"
  | "TIMEOUT"
  | "UNSUPPORTED"
  | "INTERNAL";

export type SocketRpcErrorDetails = {
  surfaceId?: string;
  selector?: string;
  url?: string;
  timeoutMs?: number;
  method?: string;
  [key: string]: unknown;
};

export type SocketRpcError = {
  code: SocketRpcErrorCode;
  message: string;
  details?: SocketRpcErrorDetails;
};

export type SocketRpcResponse =
  | {
      id: string;
      ok: true;
      result: unknown;
    }
  | {
      id: string;
      ok: false;
      error: SocketRpcError;
    };

export type WorkspaceSummary = {
  id: string;
  name: string;
  cwd: string;
  status: WorkspaceStatus;
  active: boolean;
  activePaneId: string;
  activeSurfaceId?: string;
  notice?: string;
  recentEvents?: WorkspaceStatusEvent[];
};

export type SendTextParams = {
  surfaceId?: string;
  text: string;
};

export type SendKeyParams = {
  surfaceId?: string;
  key: string;
};

export type NotifyParams = {
  title: string;
  body?: string;
  workspaceId?: string;
};

export type StatusSetParams = {
  workspaceId?: string;
  status: WorkspaceStatus;
  notice?: string;
};

export type ClearStatusParams = {
  workspaceId?: string;
};

export type StatusListParams = {
  workspaceId?: string;
  limit?: number;
};

export type WorkspaceCreateParams = {
  name?: string;
  cwd?: string;
};

export type WorkspaceSelectParams = {
  workspaceId: string;
};

export type WorkspaceCloseParams = {
  workspaceId: string;
};

export type WorkspaceRenameParams = {
  workspaceId: string;
  name: string;
};

export type WorkspaceListParams = {
  active?: boolean;
};

export type SurfaceListParams = {
  workspaceId?: string;
};

export type SurfaceCreateTerminalParams = {
  paneId?: string;
  name?: string;
  cwd?: string;
};

export type SurfaceCreateBrowserParams = {
  paneId?: string;
  name?: string;
  url?: string;
};

export type SurfaceFocusParams = {
  surfaceId: string;
};

export type SurfaceSplitParams = {
  direction: "horizontal" | "vertical";
};

export type SurfaceSummary = {
  surfaceId: string;
  type: SurfaceType;
  workspaceId: string;
  workspaceName: string;
  paneId: string;
  active: boolean;
  name: string;
  status: WorkspaceStatus;
  subtitle?: string;
};

export type BrowserRpcMethod =
  | "browser.navigate"
  | "browser.click"
  | "browser.fill"
  | "browser.type"
  | "browser.press"
  | "browser.wait"
  | "browser.eval"
  | "browser.snapshot"
  | "browser.list"
  | "browser.console.list"
  | "browser.errors.list"
  | "browser.cookies.list"
  | "browser.storage.list"
  | "browser.storage.get"
  | "browser.storage.set"
  | "browser.screenshot";

export type BrowserWaitUntil = "none" | "domcontentloaded" | "load";

export type BrowserSelectorWait = "visible" | "attached" | "none";

export type BrowserSurfaceSelector = {
  surfaceId?: string;
  paneId?: string;
  workspaceId?: string;
  active?: boolean;
  createIfMissing?: boolean;
};

export type BrowserSurfaceSummary = {
  surfaceId: string;
  workspaceId: string;
  workspaceName: string;
  paneId: string;
  active: boolean;
  url: string;
  title?: string;
};

export type BrowserConsoleLevel = "debug" | "info" | "log" | "warn" | "error";

export type BrowserConsoleEntry = {
  id: string;
  at: string;
  level: BrowserConsoleLevel;
  message: string;
  source?: string;
  line?: number;
  url?: string;
};

export type BrowserCookieEntry = {
  name: string;
  value: string;
  url: string;
};

export type BrowserStorageArea = "local" | "session";

export type BrowserStorageEntry = {
  key: string;
  value: string;
};

export type BrowserNavigateParams = BrowserSurfaceSelector & {
  url: string;
  timeoutMs?: number;
  waitUntil?: BrowserWaitUntil;
};

export type BrowserClickParams = BrowserSurfaceSelector & {
  selector: string;
  timeoutMs?: number;
  wait?: BrowserSelectorWait;
  waitUntil?: BrowserWaitUntil;
};

export type BrowserFillParams = BrowserSurfaceSelector & {
  selector: string;
  text: string;
  timeoutMs?: number;
  wait?: BrowserSelectorWait;
};

export type BrowserTypeParams = BrowserSurfaceSelector & {
  selector: string;
  text: string;
  timeoutMs?: number;
  wait?: BrowserSelectorWait;
};

export type BrowserPressParams = BrowserSurfaceSelector & {
  selector: string;
  key: string;
  timeoutMs?: number;
  wait?: BrowserSelectorWait;
};

export type BrowserWaitParams = BrowserSurfaceSelector & {
  selector?: string;
  wait?: BrowserSelectorWait;
  waitUntil?: BrowserWaitUntil;
  timeoutMs?: number;
};

export type BrowserEvalParams = BrowserSurfaceSelector & {
  script: string;
  timeoutMs?: number;
};

export type BrowserSnapshotNode = {
  role?: string;
  tag: string;
  id?: string;
  name?: string;
  text?: string;
  selector?: string;
  children?: BrowserSnapshotNode[];
};

export type BrowserSnapshotParams = BrowserSurfaceSelector & {
  selector?: string;
  format?: "text" | "json";
  includeHidden?: boolean;
  maxTextLength?: number;
  timeoutMs?: number;
};

export type BrowserScreenshotParams = BrowserSurfaceSelector & {
  path?: string;
  format?: "png" | "jpeg";
  fullPage?: boolean;
  selector?: string;
  timeoutMs?: number;
};

export type BrowserListParams = {
  workspaceId?: string;
};

export type BrowserConsoleListParams = BrowserSurfaceSelector & {
  limit?: number;
};

export type BrowserCookiesListParams = BrowserSurfaceSelector & {
  timeoutMs?: number;
};

export type BrowserStorageListParams = BrowserSurfaceSelector & {
  area?: BrowserStorageArea;
  timeoutMs?: number;
};

export type BrowserStorageGetParams = BrowserSurfaceSelector & {
  area?: BrowserStorageArea;
  key: string;
  timeoutMs?: number;
};

export type BrowserStorageSetParams = BrowserSurfaceSelector & {
  area?: BrowserStorageArea;
  key: string;
  value: string;
  timeoutMs?: number;
};

export type BrowserRpcParams =
  | BrowserNavigateParams
  | BrowserClickParams
  | BrowserFillParams
  | BrowserTypeParams
  | BrowserPressParams
  | BrowserWaitParams
  | BrowserEvalParams
  | BrowserSnapshotParams
  | BrowserScreenshotParams
  | BrowserListParams
  | BrowserConsoleListParams
  | BrowserCookiesListParams
  | BrowserStorageListParams
  | BrowserStorageGetParams
  | BrowserStorageSetParams;

export type ShellProfileOption = {
  id: ShellProfile;
  label: string;
  path?: string;
};

export type Surface = {
  id: string;
  type: SurfaceType;
  name: string;
  subtitle?: string;
  status: WorkspaceStatus;
};

export type WorkspaceStatusEvent = {
  id: string;
  at: string;
  status: WorkspaceStatus;
  message: string;
};

export type Pane = {
  id: string;
  surfaceIds: string[];
  activeSurfaceId: string;
};

export type LayoutNode =
  | {
      type: "split";
      id: string;
      direction: "horizontal" | "vertical";
      ratio: number;
      children: [LayoutNode, LayoutNode];
    }
  | {
      type: "pane";
      id: string;
    };

export type Workspace = {
  id: string;
  name: string;
  cwd: string;
  branch?: string;
  ports: number[];
  status: WorkspaceStatus;
  notice?: string;
  recentEvents?: WorkspaceStatusEvent[];
  pullRequest?: PullRequestSummary;
  // ISO 时间戳：用户最近一次将该 workspace 切为 active 的时刻
  // unread 计数 = recentEvents 中 at > lastViewedAt 的条目数
  lastViewedAt?: string;
  layout: LayoutNode;
  panes: Record<string, Pane>;
  surfaces: Record<string, Surface>;
  activePaneId: string;
};

export type PersistedBrowserSession = {
  history: string[];
  historyIndex: number;
  url: string;
};

export type PersistedAppState = {
  version: 1;
  activeWorkspaceId: string;
  workspaces: Workspace[];
  browserSessions?: Record<string, PersistedBrowserSession>;
};

// 终端 OSC 9 / 99 / 777 通知序列解析后的载荷
export type TerminalNotificationPayload = {
  surfaceId: string;
  // OSC 序列码：9 = macOS Terminal、99 = iTerm2/VS Code、777 = rxvt
  code: 9 | 99 | 777;
  title: string;
  body: string;
};

// 自动更新状态机：renderer 据此渲染顶部横幅与按钮
// idle = 静默；checking = 已发起请求；available = 已发现新版本但还没下完；
// not-available = 上次检查无新版本（短暂态，10s 后回落 idle）；
// downloading = 下载中，附 progress 0..100；downloaded = 等待重启；error = 出错
export type AppUpdateState =
  | "idle"
  | "checking"
  | "available"
  | "not-available"
  | "downloading"
  | "downloaded"
  | "error";

export type AppUpdateStatus = {
  state: AppUpdateState;
  version?: string;
  releaseNotes?: string;
  // 0..100，仅 downloading 状态下意义
  progress?: number;
  error?: string;
};

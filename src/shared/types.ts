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

export type WmuxConfigSourceKind = "global" | "project";

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

export type WmuxCommandConfig = {
  name: string;
  description?: string;
  keywords?: string[];
  restart?: "ignore" | "recreate" | "confirm";
  command?: string;
  confirm?: boolean;
  workspace?: WmuxWorkspaceCommandConfig;
  source?: WmuxConfigSourceKind;
  sourcePath?: string;
};

export type WmuxProjectConfig = {
  commands: WmuxCommandConfig[];
};

export type WmuxConfigSource = {
  kind: WmuxConfigSourceKind;
  path: string;
  found: boolean;
  commandCount: number;
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
};

export type SocketRpcMethod =
  | "system.ping"
  | "system.identify"
  | "system.capabilities"
  | "workspace.list"
  | "workspace.create"
  | "workspace.select"
  | "workspace.close"
  | "workspace.rename"
  | "surface.list"
  | "surface.createTerminal"
  | "surface.createBrowser"
  | "surface.focus"
  | "surface.sendText"
  | "surface.sendKey"
  | "status.notify"
  | "status.clear"
  | "status.list"
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

export type ClearStatusParams = {
  workspaceId?: string;
};

export type StatusListParams = {
  workspaceId?: string;
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
  | "browser.eval"
  | "browser.snapshot"
  | "browser.list"
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

export type BrowserRpcParams =
  | BrowserNavigateParams
  | BrowserClickParams
  | BrowserFillParams
  | BrowserEvalParams
  | BrowserSnapshotParams
  | BrowserScreenshotParams
  | BrowserListParams;

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

export type WorkspaceStatus = "idle" | "running" | "attention" | "success" | "error";

export type SurfaceType = "terminal" | "browser";

export type ShellProfile = "auto" | "pwsh" | "powershell" | "cmd" | "bash" | "zsh";

export type SocketRpcMethod = "system.ping" | "workspace.list" | "surface.sendText" | "status.notify";

export type SocketRpcRequest = {
  id: string;
  method: SocketRpcMethod | string;
  params?: unknown;
};

export type SocketRpcErrorCode =
  | "BAD_REQUEST"
  | "METHOD_NOT_FOUND"
  | "INVALID_STATE"
  | "NOT_FOUND"
  | "TIMEOUT"
  | "INTERNAL";

export type SocketRpcError = {
  code: SocketRpcErrorCode;
  message: string;
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

export type NotifyParams = {
  title: string;
  body?: string;
  workspaceId?: string;
};

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

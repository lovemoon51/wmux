import {
  Bell,
  ChevronLeft,
  ChevronRight,
  Command,
  ExternalLink,
  GitBranch,
  Globe,
  LayoutGrid,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Settings,
  SplitSquareHorizontal,
  SplitSquareVertical,
  Terminal,
  X
} from "lucide-react";
import {
  createElement,
  useCallback,
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent,
  type ReactElement
} from "react";
import type {
  BrowserClickParams,
  BrowserEvalParams,
  BrowserFillParams,
  BrowserNavigateParams,
  BrowserRpcMethod,
  BrowserScreenshotParams,
  BrowserSelectorWait,
  BrowserSurfaceSummary,
  BrowserSnapshotNode,
  BrowserSnapshotParams,
  BrowserSurfaceSelector,
  BrowserWaitUntil,
  ClearStatusParams,
  LayoutNode,
  NotifyParams,
  PersistedAppState,
  SendKeyParams,
  SendTextParams,
  ShellProfile,
  ShellProfileOption,
  SocketRpcErrorDetails,
  SocketRpcErrorCode,
  SocketRpcMethod,
  SocketRpcRequest,
  SocketRpcResponse,
  SocketSecurityMode,
  SocketSecuritySettings,
  StatusListParams,
  Surface,
  SurfaceListParams,
  SurfaceSummary,
  WmuxCommandConfig,
  WmuxLayoutConfig,
  WmuxProjectConfigResult,
  WmuxSurfaceConfig,
  Workspace,
  WorkspaceInspection,
  WorkspaceStatus,
  WorkspaceSummary
} from "@shared/types";
import { TerminalSurface } from "./components/TerminalSurface";

let nextSurfaceNumber = 1;
let nextWorkspaceNumber = 1;
let nextPaneNumber = 1;
let nextSplitNumber = 1;

type BrowserSessionState = {
  history: string[];
  historyIndex: number;
  url: string;
};

type BrowserWebviewElement = HTMLElement & {
  canGoBack?: () => boolean;
  canGoForward?: () => boolean;
  capturePage?: () => Promise<{ toDataURL: () => string }>;
  executeJavaScript?: (script: string, userGesture?: boolean) => Promise<unknown>;
  getURL?: () => string;
  goBack?: () => void;
  goForward?: () => void;
  loadURL?: (url: string) => void;
  reload?: () => void;
  setZoomFactor?: (factor: number) => void;
};

type BrowserLoadFailureEvent = Event & {
  errorCode?: number;
  errorDescription?: string;
  isMainFrame?: boolean;
  validatedURL?: string;
};

type BrowserRuntime = {
  surfaceId: string;
  runtimeId: string;
  viewId?: number;
  webview: BrowserWebviewElement;
  navigate: (url: string, waitUntil: BrowserWaitUntil, timeoutMs: number) => Promise<string>;
};

type SplitDropEdge = "top" | "right" | "bottom" | "left";

type DraggedSurfacePayload = {
  paneId: string;
  surfaceId: string;
};

type PendingTerminalCommand = {
  surfaceId: string;
  command: string;
};

type BrowserSurfaceTarget = {
  workspaceId: string;
  paneId: string;
  surface: Surface;
  isNew: boolean;
};

type WorkspaceCommandBuildResult = {
  workspace: Workspace;
  terminalCommands: PendingTerminalCommand[];
};

const browserSessions = new Map<string, BrowserSessionState>();
const browserRuntimes = new Map<string, BrowserRuntime>();

function getBrowserSessionSnapshot(): PersistedAppState["browserSessions"] {
  return Object.fromEntries(browserSessions.entries());
}

function restoreBrowserSessions(sessions: PersistedAppState["browserSessions"]): void {
  browserSessions.clear();
  Object.entries(sessions ?? {}).forEach(([surfaceId, session]) => {
    if (session.history.length > 0) {
      browserSessions.set(surfaceId, session);
    }
  });
}

function createTerminalSurface(): Surface {
  const number = nextSurfaceNumber++;
  return {
    id: `surface-terminal-${Date.now()}-${number}`,
    type: "terminal",
    name: `Terminal ${number}`,
    subtitle: "PowerShell",
    status: "idle"
  };
}

function createBrowserSurface(): Surface {
  const number = nextSurfaceNumber++;
  return {
    id: `surface-browser-${Date.now()}-${number}`,
    type: "browser",
    name: `Browser ${number}`,
    subtitle: "about:blank",
    status: "idle"
  };
}

function createPaneWithTerminal(): { paneId: string; surface: Surface; pane: Workspace["panes"][string] } {
  const number = nextPaneNumber++;
  const paneId = `pane-${Date.now()}-${number}`;
  const surface = createTerminalSurface();

  return {
    paneId,
    surface,
    pane: {
      id: paneId,
      surfaceIds: [surface.id],
      activeSurfaceId: surface.id
    }
  };
}

function splitPaneNode(node: LayoutNode, paneId: string, direction: "horizontal" | "vertical", newPaneId: string): LayoutNode {
  if (node.type === "pane") {
    if (node.id !== paneId) {
      return node;
    }

    return {
      type: "split",
      id: `split-${Date.now()}-${nextSplitNumber++}`,
      direction,
      ratio: 0.5,
      children: [node, { type: "pane", id: newPaneId }]
    };
  }

  return {
    ...node,
    children: [
      splitPaneNode(node.children[0], paneId, direction, newPaneId),
      splitPaneNode(node.children[1], paneId, direction, newPaneId)
    ]
  };
}

function splitPaneNodeAtEdge(node: LayoutNode, paneId: string, edge: SplitDropEdge, newPaneId: string): LayoutNode {
  if (node.type === "pane") {
    if (node.id !== paneId) {
      return node;
    }

    const direction = edge === "left" || edge === "right" ? "horizontal" : "vertical";
    const targetNode: LayoutNode = { type: "pane", id: paneId };
    const newNode: LayoutNode = { type: "pane", id: newPaneId };
    const children: [LayoutNode, LayoutNode] =
      edge === "left" || edge === "top" ? [newNode, targetNode] : [targetNode, newNode];

    return {
      type: "split",
      id: `split-${Date.now()}-${nextSplitNumber++}`,
      direction,
      ratio: 0.5,
      children
    };
  }

  return {
    ...node,
    children: [
      splitPaneNodeAtEdge(node.children[0], paneId, edge, newPaneId),
      splitPaneNodeAtEdge(node.children[1], paneId, edge, newPaneId)
    ]
  };
}

function updateSplitRatio(node: LayoutNode, splitId: string, ratio: number): LayoutNode {
  if (node.type === "pane") {
    return node;
  }

  if (node.id === splitId) {
    return {
      ...node,
      ratio: Math.min(0.82, Math.max(0.18, ratio))
    };
  }

  return {
    ...node,
    children: [updateSplitRatio(node.children[0], splitId, ratio), updateSplitRatio(node.children[1], splitId, ratio)]
  };
}

function countPanes(node: LayoutNode): number {
  if (node.type === "pane") {
    return 1;
  }

  return countPanes(node.children[0]) + countPanes(node.children[1]);
}

function firstPaneId(node: LayoutNode): string {
  return node.type === "pane" ? node.id : firstPaneId(node.children[0]);
}

function collectPaneIds(node: LayoutNode, paneIds: string[] = []): string[] {
  if (node.type === "pane") {
    paneIds.push(node.id);
    return paneIds;
  }

  collectPaneIds(node.children[0], paneIds);
  collectPaneIds(node.children[1], paneIds);
  return paneIds;
}

function removePaneNode(node: LayoutNode, paneId: string): LayoutNode | null {
  if (node.type === "pane") {
    return node.id === paneId ? null : node;
  }

  const firstChild = removePaneNode(node.children[0], paneId);
  const secondChild = removePaneNode(node.children[1], paneId);

  if (!firstChild) {
    return secondChild;
  }

  if (!secondChild) {
    return firstChild;
  }

  return {
    ...node,
    children: [firstChild, secondChild]
  };
}

function getDropEdge(rect: DOMRect, clientX: number, clientY: number): SplitDropEdge {
  const distances: Array<{ edge: SplitDropEdge; distance: number }> = [
    { edge: "left", distance: Math.abs(clientX - rect.left) },
    { edge: "right", distance: Math.abs(rect.right - clientX) },
    { edge: "top", distance: Math.abs(clientY - rect.top) },
    { edge: "bottom", distance: Math.abs(rect.bottom - clientY) }
  ];

  return distances.sort((first, second) => first.distance - second.distance)[0].edge;
}

function readDraggedSurfacePayload(event: DragEvent): DraggedSurfacePayload | null {
  const rawPayload = event.dataTransfer.getData("application/x-wmux-surface");
  if (!rawPayload) {
    return null;
  }

  try {
    const payload = JSON.parse(rawPayload) as Partial<DraggedSurfacePayload>;
    return payload.paneId && payload.surfaceId ? { paneId: payload.paneId, surfaceId: payload.surfaceId } : null;
  } catch {
    return null;
  }
}

function createWorkspace(): Workspace {
  const number = nextWorkspaceNumber++;
  const workspaceId = `workspace-new-${Date.now()}-${number}`;
  const paneId = `${workspaceId}-pane-terminal`;
  const surfaceId = `${workspaceId}-surface-terminal`;

  return {
    id: workspaceId,
    name: `Workspace ${number}`,
    cwd: "D:/IdeaProject/codex/wmux",
    branch: "main",
    ports: [],
    status: "idle",
    notice: "new workspace",
    activePaneId: paneId,
    layout: { type: "pane", id: paneId },
    panes: {
      [paneId]: {
        id: paneId,
        surfaceIds: [surfaceId],
        activeSurfaceId: surfaceId
      }
    },
    surfaces: {
      [surfaceId]: {
        id: surfaceId,
        type: "terminal",
        name: "Terminal",
        subtitle: "PowerShell",
        status: "idle"
      }
    }
  };
}

const statusLabels: Record<WorkspaceStatus, string> = {
  idle: "Idle",
  running: "Running",
  attention: "Needs input",
  success: "Done",
  error: "Error"
};

const statusClass: Record<WorkspaceStatus, string> = {
  idle: "statusIdle",
  running: "statusRunning",
  attention: "statusAttention",
  success: "statusSuccess",
  error: "statusError"
};

const socketSecurityModeLabels: Record<SocketSecurityMode, string> = {
  off: "Off",
  wmuxOnly: "wmuxOnly",
  token: "Token",
  allowAll: "allowAll"
};

const socketSecurityModes: SocketSecurityMode[] = ["wmuxOnly", "token", "off", "allowAll"];

const initialWorkspaces: Workspace[] = [
  {
    id: "workspace-api",
    name: "API Server",
    cwd: "D:/IdeaProject/codex/wmux",
    branch: "main",
    ports: [8787],
    status: "running",
    notice: "uvicorn ready on 8787",
    activePaneId: "pane-terminal",
    layout: {
      type: "split",
      id: "split-root",
      direction: "horizontal",
      ratio: 0.58,
      children: [
        { type: "pane", id: "pane-terminal" },
        {
          type: "split",
          id: "split-right",
          direction: "vertical",
          ratio: 0.54,
          children: [
            { type: "pane", id: "pane-preview" },
            { type: "pane", id: "pane-tests" }
          ]
        }
      ]
    },
    panes: {
      "pane-terminal": {
        id: "pane-terminal",
        surfaceIds: ["surface-agent", "surface-shell"],
        activeSurfaceId: "surface-agent"
      },
      "pane-preview": {
        id: "pane-preview",
        surfaceIds: ["surface-browser"],
        activeSurfaceId: "surface-browser"
      },
      "pane-tests": {
        id: "pane-tests",
        surfaceIds: ["surface-tests"],
        activeSurfaceId: "surface-tests"
      }
    },
    surfaces: {
      "surface-agent": {
        id: "surface-agent",
        type: "terminal",
        name: "Codex Agent",
        subtitle: "working on workspace scaffold",
        status: "running"
      },
      "surface-shell": {
        id: "surface-shell",
        type: "terminal",
        name: "Shell",
        subtitle: "PowerShell",
        status: "idle"
      },
      "surface-browser": {
        id: "surface-browser",
        type: "browser",
        name: "Preview",
        subtitle: "about:blank",
        status: "idle"
      },
      "surface-tests": {
        id: "surface-tests",
        type: "terminal",
        name: "Tests",
        subtitle: "npm run type-check",
        status: "attention"
      }
    }
  },
  {
    id: "workspace-frontend",
    name: "Frontend",
    cwd: "wmux/apps/desktop",
    branch: "ui-shell",
    ports: [5173],
    status: "attention",
    notice: "review browser focus behavior",
    activePaneId: "pane-frontend",
    layout: { type: "pane", id: "pane-frontend" },
    panes: {
      "pane-frontend": {
        id: "pane-frontend",
        surfaceIds: ["surface-dev"],
        activeSurfaceId: "surface-dev"
      }
    },
    surfaces: {
      "surface-dev": {
        id: "surface-dev",
        type: "terminal",
        name: "Dev Server",
        subtitle: "npm run dev",
        status: "running"
      }
    }
  },
  {
    id: "workspace-docs",
    name: "Docs",
    cwd: "wmux/docs",
    branch: "main",
    ports: [],
    status: "success",
    notice: "requirements drafted",
    activePaneId: "pane-docs",
    layout: { type: "pane", id: "pane-docs" },
    panes: {
      "pane-docs": {
        id: "pane-docs",
        surfaceIds: ["surface-docs"],
        activeSurfaceId: "surface-docs"
      }
    },
    surfaces: {
      "surface-docs": {
        id: "surface-docs",
        type: "terminal",
        name: "Docs",
        subtitle: "markdown plan",
        status: "success"
      }
    }
  }
];

function hydrateCreationCounters(workspaces: Workspace[]): void {
  const surfaceCount = workspaces.reduce((count, workspace) => count + Object.keys(workspace.surfaces).length, 0);
  const paneCount = workspaces.reduce((count, workspace) => count + Object.keys(workspace.panes).length, 0);
  const splitCount = workspaces.reduce((count, workspace) => count + countSplitNodes(workspace.layout), 0);

  nextWorkspaceNumber = Math.max(nextWorkspaceNumber, workspaces.length + 1);
  nextSurfaceNumber = Math.max(nextSurfaceNumber, surfaceCount + 1);
  nextPaneNumber = Math.max(nextPaneNumber, paneCount + 1);
  nextSplitNumber = Math.max(nextSplitNumber, splitCount + 1);
}

function countSplitNodes(node: LayoutNode): number {
  if (node.type === "pane") {
    return 0;
  }

  return 1 + countSplitNodes(node.children[0]) + countSplitNodes(node.children[1]);
}

function appendCommandNewline(command: string): string {
  return command.endsWith("\n") || command.endsWith("\r") ? command : `${command}\n`;
}

function resolveWorkspaceCwd(cwd?: string): string {
  if (!cwd || cwd === ".") {
    return "D:/IdeaProject/codex/wmux";
  }

  return cwd;
}

function createConfiguredSurface(config: WmuxSurfaceConfig, fallbackName: string): Surface {
  const number = nextSurfaceNumber++;
  const isTerminal = config.type === "terminal";
  const fallbackSubtitle = isTerminal ? "PowerShell" : (config.url ?? "about:blank");

  return {
    id: `surface-${config.type}-${Date.now()}-${number}`,
    type: config.type,
    name: config.name?.trim() || fallbackName,
    subtitle: fallbackSubtitle,
    status: config.type === "terminal" && config.command ? "running" : "idle"
  };
}

function clampSplitRatio(value: number | undefined): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return 0.5;
  }

  return Math.min(0.82, Math.max(0.18, value));
}

function createWorkspaceFromCommand(command: WmuxCommandConfig): WorkspaceCommandBuildResult {
  const workspaceNumber = nextWorkspaceNumber++;
  const workspaceId = `workspace-command-${Date.now()}-${workspaceNumber}`;
  const panes: Workspace["panes"] = {};
  const surfaces: Workspace["surfaces"] = {};
  const terminalCommands: PendingTerminalCommand[] = [];
  let activePaneId = "";
  let focusedSurfaceId = "";

  const createPaneFromConfig = (surfaceConfigs: WmuxSurfaceConfig[]): string => {
    const paneNumber = nextPaneNumber++;
    const paneId = `${workspaceId}-pane-${paneNumber}`;
    const nextSurfaceIds = surfaceConfigs.map((surfaceConfig, surfaceIndex) => {
      const surface = createConfiguredSurface(
        surfaceConfig,
        `${surfaceConfig.type === "browser" ? "Browser" : "Terminal"} ${surfaceIndex + 1}`
      );
      surfaces[surface.id] = surface;

      if (surfaceConfig.type === "browser") {
        browserSessions.set(surface.id, {
          history: [surfaceConfig.url ?? "about:blank"],
          historyIndex: 0,
          url: surfaceConfig.url ?? "about:blank"
        });
      }

      if (surfaceConfig.type === "terminal" && surfaceConfig.command) {
        terminalCommands.push({ surfaceId: surface.id, command: surfaceConfig.command });
      }

      if (surfaceConfig.focus) {
        activePaneId = paneId;
        focusedSurfaceId = surface.id;
      }

      return surface.id;
    });

    panes[paneId] = {
      id: paneId,
      surfaceIds: nextSurfaceIds,
      activeSurfaceId: focusedSurfaceId && nextSurfaceIds.includes(focusedSurfaceId) ? focusedSurfaceId : nextSurfaceIds[0]
    };

    if (!activePaneId) {
      activePaneId = paneId;
    }

    return paneId;
  };

  const createLayoutNode = (layoutConfig: WmuxLayoutConfig): LayoutNode => {
    if ("pane" in layoutConfig) {
      return { type: "pane", id: createPaneFromConfig(layoutConfig.pane.surfaces) };
    }

    return {
      type: "split",
      id: `split-command-${Date.now()}-${nextSplitNumber++}`,
      direction: layoutConfig.direction,
      ratio: clampSplitRatio(layoutConfig.split),
      children: [createLayoutNode(layoutConfig.children[0]), createLayoutNode(layoutConfig.children[1])]
    };
  };

  const defaultLayout: WmuxLayoutConfig = command.workspace?.layout ?? {
    pane: {
      surfaces: [
        {
          type: "terminal",
          name: "Terminal",
          command: command.command,
          focus: true
        }
      ]
    }
  };
  const layout = createLayoutNode(defaultLayout);
  const firstPane = activePaneId || firstPaneId(layout);

  return {
    workspace: {
      id: workspaceId,
      name: command.workspace?.name?.trim() || command.name,
      cwd: resolveWorkspaceCwd(command.workspace?.cwd),
      branch: "main",
      ports: [],
      status: terminalCommands.length > 0 ? "running" : "idle",
      notice: `已从 wmux.json 创建：${command.name}`,
      activePaneId: firstPane,
      layout,
      panes,
      surfaces
    },
    terminalCommands
  };
}

function commandMatchesQuery(command: WmuxCommandConfig, query: string): boolean {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return true;
  }

  const haystack = [command.name, command.description, command.command, ...(command.keywords ?? [])]
    .filter((value): value is string => Boolean(value))
    .join(" ")
    .toLowerCase();
  return haystack.includes(normalizedQuery);
}

function getCommandTypeLabel(command: WmuxCommandConfig): string {
  if (command.workspace) {
    return "Workspace";
  }

  return "Terminal";
}

function createSocketSuccessResponse(id: string, result: unknown): SocketRpcResponse {
  return { id, ok: true, result };
}

function createSocketErrorResponse(
  id: string,
  code: SocketRpcErrorCode,
  message: string,
  details?: SocketRpcErrorDetails
): SocketRpcResponse {
  return { id, ok: false, error: { code, message, details } };
}

function getActiveTerminalSurface(workspace: Workspace, preferredSurfaceId?: string): Surface | null {
  if (preferredSurfaceId) {
    const preferredSurface = workspace.surfaces[preferredSurfaceId];
    return preferredSurface?.type === "terminal" ? preferredSurface : null;
  }

  const activePane = workspace.panes[workspace.activePaneId];
  const activeSurface = activePane ? workspace.surfaces[activePane.activeSurfaceId] : undefined;
  if (activeSurface?.type === "terminal") {
    return activeSurface;
  }

  const fallbackSurfaceId = activePane?.surfaceIds.find((surfaceId) => workspace.surfaces[surfaceId]?.type === "terminal");
  return fallbackSurfaceId ? workspace.surfaces[fallbackSurfaceId] : null;
}

const terminalKeySequences: Record<string, string> = {
  enter: "\r",
  return: "\r",
  tab: "\t",
  escape: "\x1b",
  esc: "\x1b",
  backspace: "\x7f",
  delete: "\x1b[3~",
  del: "\x1b[3~",
  up: "\x1b[A",
  arrowup: "\x1b[A",
  down: "\x1b[B",
  arrowdown: "\x1b[B",
  right: "\x1b[C",
  arrowright: "\x1b[C",
  left: "\x1b[D",
  arrowleft: "\x1b[D",
  "ctrl+c": "\x03",
  "ctrl-c": "\x03",
  "ctrl+d": "\x04",
  "ctrl-d": "\x04",
  "ctrl+l": "\x0c",
  "ctrl-l": "\x0c"
};

function normalizeTerminalKey(key: string): string {
  return key.trim().toLowerCase();
}

function getTerminalKeySequence(key: string): string | null {
  return terminalKeySequences[normalizeTerminalKey(key)] ?? null;
}

const socketCapabilities: SocketRpcMethod[] = [
  "system.ping",
  "system.identify",
  "system.capabilities",
  "workspace.list",
  "surface.list",
  "surface.sendText",
  "surface.sendKey",
  "status.notify",
  "status.clear",
  "status.list",
  "browser.navigate",
  "browser.click",
  "browser.fill",
  "browser.eval",
  "browser.snapshot",
  "browser.list",
  "browser.screenshot"
];

function isBrowserRpcMethod(method: string): method is BrowserRpcMethod {
  return (
    method === "browser.navigate" ||
    method === "browser.click" ||
    method === "browser.fill" ||
    method === "browser.eval" ||
    method === "browser.snapshot" ||
    method === "browser.list" ||
    method === "browser.screenshot"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function createBrowserError(
  code: SocketRpcErrorCode,
  message: string,
  details?: SocketRpcErrorDetails
): Error & { code: SocketRpcErrorCode; details?: SocketRpcErrorDetails } {
  const error = new Error(message) as Error & { code: SocketRpcErrorCode; details?: SocketRpcErrorDetails };
  error.code = code;
  error.details = details;
  return error;
}

function getBrowserTimeout(params: unknown, fallback: number): number {
  if (isRecord(params) && typeof params.timeoutMs === "number" && Number.isFinite(params.timeoutMs) && params.timeoutMs > 0) {
    return Math.min(Math.floor(params.timeoutMs), 60_000);
  }

  return fallback;
}

function readBrowserWaitUntil(params: unknown): BrowserWaitUntil {
  if (isRecord(params) && (params.waitUntil === "none" || params.waitUntil === "domcontentloaded" || params.waitUntil === "load")) {
    return params.waitUntil;
  }

  return "domcontentloaded";
}

function readSelectorWait(params: unknown): BrowserSelectorWait {
  if (isRecord(params) && (params.wait === "visible" || params.wait === "attached" || params.wait === "none")) {
    return params.wait;
  }

  return "visible";
}

function getBrowserSurfaces(workspace: Workspace): Array<{ surface: Surface; paneId: string; workspaceId: string }> {
  return Object.values(workspace.panes).flatMap((pane) =>
    pane.surfaceIds
      .map((surfaceId) => workspace.surfaces[surfaceId])
      .filter((surface): surface is Surface => surface?.type === "browser")
      .map((surface) => ({ surface, paneId: pane.id, workspaceId: workspace.id }))
  );
}

function isIgnorableBrowserLoadFailure(event: BrowserLoadFailureEvent, expectedUrl: string): boolean {
  return (
    event.errorCode === -3 ||
    event.errorDescription === "ERR_ABORTED" ||
    event.isMainFrame === false ||
    event.validatedURL === "about:blank" ||
    event.validatedURL === expectedUrl
  );
}

async function createBrowserSurfaceSummaries(
  workspaces: Workspace[],
  activeWorkspaceId: string,
  workspaceId?: string
): Promise<BrowserSurfaceSummary[]> {
  const targetWorkspaces = workspaceId ? workspaces.filter((workspace) => workspace.id === workspaceId) : workspaces;
  return Promise.all(
    targetWorkspaces.flatMap((workspace) =>
      getBrowserSurfaces(workspace).map(async ({ surface, paneId }) => {
        const runtime = browserRuntimes.get(surface.id);
        const activePane = workspace.panes[workspace.activePaneId];
        const title = runtime
          ? await executeBrowserJavaScript<string>(runtime, "document.title", 1000).catch(() => undefined)
          : undefined;
        return {
          surfaceId: surface.id,
          workspaceId: workspace.id,
          workspaceName: workspace.name,
          paneId,
          active: workspace.id === activeWorkspaceId && activePane?.activeSurfaceId === surface.id,
          url: runtime?.webview.getURL?.() || surface.subtitle || "about:blank",
          title
        };
      })
    )
  );
}

async function createAmbiguousBrowserError(
  message: string,
  workspaces: Workspace[],
  activeWorkspaceId: string,
  workspaceId: string,
  extraDetails?: SocketRpcErrorDetails
): Promise<Error & { code: SocketRpcErrorCode; details?: SocketRpcErrorDetails }> {
  return createBrowserError("AMBIGUOUS_TARGET", message, {
    ...extraDetails,
    workspaceId,
    candidates: await createBrowserSurfaceSummaries(workspaces, activeWorkspaceId, workspaceId)
  });
}

async function resolveBrowserSurface(
  workspaces: Workspace[],
  activeWorkspaceId: string,
  selector: BrowserSurfaceSelector
): Promise<{ surface: Surface; paneId: string; workspace: Workspace } | null> {
  const activeWorkspace = workspaces.find((workspace) => workspace.id === activeWorkspaceId) ?? workspaces[0];
  if (!activeWorkspace) {
    throw createBrowserError("INVALID_STATE", "没有可用 workspace");
  }

  if (selector.surfaceId) {
    for (const workspace of workspaces) {
      const surface = workspace.surfaces[selector.surfaceId];
      if (!surface) {
        continue;
      }
      if (surface.type !== "browser") {
        throw createBrowserError("SURFACE_TYPE_MISMATCH", "指定 surface 不是 browser", { surfaceId: selector.surfaceId });
      }
      const pane = Object.values(workspace.panes).find((currentPane) => currentPane.surfaceIds.includes(surface.id));
      if (!pane) {
        throw createBrowserError("NOT_FOUND", "找不到 browser surface 所在 pane", { surfaceId: selector.surfaceId });
      }
      return { surface, paneId: pane.id, workspace };
    }
    throw createBrowserError("NOT_FOUND", "找不到 browser surface", { surfaceId: selector.surfaceId });
  }

  if (selector.paneId) {
    const workspace = workspaces.find((item) => Boolean(item.panes[selector.paneId ?? ""]));
    const pane = workspace?.panes[selector.paneId];
    if (!workspace || !pane) {
      throw createBrowserError("NOT_FOUND", "找不到 pane", { paneId: selector.paneId });
    }
    const activeSurface = workspace.surfaces[pane.activeSurfaceId];
    if (activeSurface?.type === "browser") {
      return { surface: activeSurface, paneId: pane.id, workspace };
    }
    const browserSurfaces = pane.surfaceIds
      .map((surfaceId) => workspace.surfaces[surfaceId])
      .filter((surface): surface is Surface => surface?.type === "browser");
    if (browserSurfaces.length === 1) {
      return { surface: browserSurfaces[0], paneId: pane.id, workspace };
    }
    if (browserSurfaces.length > 1) {
      throw await createAmbiguousBrowserError(
        "pane 中存在多个 browser surface，请指定 --surface",
        workspaces,
        activeWorkspaceId,
        workspace.id,
        { paneId: pane.id }
      );
    }
    return null;
  }

  const targetWorkspace = selector.workspaceId
    ? workspaces.find((workspace) => workspace.id === selector.workspaceId)
    : activeWorkspace;
  if (!targetWorkspace) {
    throw createBrowserError("NOT_FOUND", "找不到 workspace", { workspaceId: selector.workspaceId });
  }

  const browserSurfaces = getBrowserSurfaces(targetWorkspace);
  if (!selector.workspaceId && selector.active !== true && browserSurfaces.length > 1) {
    throw await createAmbiguousBrowserError(
      "当前 workspace 中存在多个 browser surface，请指定 --surface",
      workspaces,
      activeWorkspaceId,
      targetWorkspace.id
    );
  }

  const activePane = targetWorkspace.panes[targetWorkspace.activePaneId];
  const activeSurface = activePane ? targetWorkspace.surfaces[activePane.activeSurfaceId] : undefined;
  if (activePane && activeSurface?.type === "browser") {
    return { surface: activeSurface, paneId: activePane.id, workspace: targetWorkspace };
  }

  if (browserSurfaces.length === 1) {
    return {
      surface: browserSurfaces[0].surface,
      paneId: browserSurfaces[0].paneId,
      workspace: targetWorkspace
    };
  }
  if (browserSurfaces.length > 1) {
    throw await createAmbiguousBrowserError(
      "当前 workspace 中存在多个 browser surface，请指定 --surface",
      workspaces,
      activeWorkspaceId,
      targetWorkspace.id
    );
  }

  return null;
}

function createBrowserSurfaceInWorkspace(
  workspaces: Workspace[],
  activeWorkspaceId: string,
  selector: BrowserSurfaceSelector,
  url: string
): { workspaces: Workspace[]; surface: Surface; paneId: string; workspaceId: string } {
  const targetWorkspaceId = selector.workspaceId ?? activeWorkspaceId;
  const targetWorkspace = workspaces.find((workspace) => workspace.id === targetWorkspaceId) ?? workspaces[0];
  if (!targetWorkspace) {
    throw createBrowserError("INVALID_STATE", "没有可用 workspace");
  }

  const paneId = selector.paneId ?? targetWorkspace.activePaneId;
  const pane = targetWorkspace.panes[paneId];
  if (!pane) {
    throw createBrowserError("NOT_FOUND", "找不到用于创建 browser 的 pane", { paneId });
  }

  const surface = { ...createBrowserSurface(), subtitle: normalizeBrowserUrl(url) };
  browserSessions.set(surface.id, {
    history: [surface.subtitle ?? "about:blank"],
    historyIndex: 0,
    url: surface.subtitle ?? "about:blank"
  });

  return {
    surface,
    paneId,
    workspaceId: targetWorkspace.id,
    workspaces: workspaces.map((workspace) =>
      workspace.id === targetWorkspace.id
        ? {
            ...workspace,
            activePaneId: paneId,
            panes: {
              ...workspace.panes,
              [paneId]: {
                ...pane,
                surfaceIds: [...pane.surfaceIds, surface.id],
                activeSurfaceId: surface.id
              }
            },
            surfaces: {
              ...workspace.surfaces,
              [surface.id]: surface
            }
          }
        : workspace
    )
  };
}

function findOrCreateBrowserSurfaceForWorkspace(workspace: Workspace, url: string): { workspace: Workspace; target: BrowserSurfaceTarget } {
  const normalizedUrl = normalizeBrowserUrl(url);
  const activePane = workspace.panes[workspace.activePaneId];
  const activeSurface = activePane ? workspace.surfaces[activePane.activeSurfaceId] : undefined;

  if (activePane && activeSurface?.type === "browser") {
    return {
      workspace: {
        ...workspace,
        panes: {
          ...workspace.panes,
          [activePane.id]: {
            ...activePane,
            activeSurfaceId: activeSurface.id
          }
        }
      },
      target: { workspaceId: workspace.id, paneId: activePane.id, surface: activeSurface, isNew: false }
    };
  }

  const browserSurfaces = Object.values(workspace.panes).flatMap((pane) =>
    pane.surfaceIds
      .map((surfaceId) => workspace.surfaces[surfaceId])
      .filter((surface): surface is Surface => Boolean(surface) && surface.type === "browser")
      .map((surface) => ({ pane, surface }))
  );

  if (browserSurfaces.length === 1) {
    const { pane, surface } = browserSurfaces[0];
    return {
      workspace: {
        ...workspace,
        activePaneId: pane.id,
        panes: {
          ...workspace.panes,
          [pane.id]: {
            ...pane,
            activeSurfaceId: surface.id
          }
        }
      },
      target: { workspaceId: workspace.id, paneId: pane.id, surface, isNew: false }
    };
  }

  if (!activePane) {
    throw createBrowserError("INVALID_STATE", "当前 workspace 没有可用 pane");
  }

  const surface = { ...createBrowserSurface(), subtitle: normalizedUrl };
  browserSessions.set(surface.id, {
    history: [normalizedUrl],
    historyIndex: 0,
    url: normalizedUrl
  });

  return {
    workspace: {
      ...workspace,
      activePaneId: activePane.id,
      panes: {
        ...workspace.panes,
        [activePane.id]: {
          ...activePane,
          surfaceIds: [...activePane.surfaceIds, surface.id],
          activeSurfaceId: surface.id
        }
      },
      surfaces: {
        ...workspace.surfaces,
        [surface.id]: surface
      }
    },
    target: { workspaceId: workspace.id, paneId: activePane.id, surface, isNew: true }
  };
}

async function waitForBrowserRuntime(surfaceId: string, timeoutMs: number): Promise<BrowserRuntime> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const runtime = browserRuntimes.get(surfaceId);
    if (runtime) {
      return runtime;
    }
    await new Promise((resolve) => window.setTimeout(resolve, 50));
  }

  throw createBrowserError("TIMEOUT", "browser webview 未在超时内就绪", { surfaceId, timeoutMs });
}

function ensureNoCreateForNonNavigate(method: BrowserRpcMethod, params: unknown): void {
  if (method !== "browser.navigate" && isRecord(params) && params.createIfMissing === true) {
    throw createBrowserError("BAD_REQUEST", "createIfMissing is only supported by browser.navigate", { method });
  }
}

async function executeBrowserJavaScript<T>(runtime: BrowserRuntime, script: string, timeoutMs: number): Promise<T> {
  if (!runtime.webview.executeJavaScript) {
    throw createBrowserError("BROWSER_ERROR", "当前 webview 不支持 executeJavaScript", { surfaceId: runtime.surfaceId });
  }

  return Promise.race([
    runtime.webview.executeJavaScript(script, true) as Promise<T>,
    new Promise<T>((_resolve, reject) =>
      window.setTimeout(
        () => reject(createBrowserError("TIMEOUT", "browser script 执行超时", { surfaceId: runtime.surfaceId, timeoutMs })),
        timeoutMs
      )
    )
  ]);
}

function serializeForInjectedScript(value: unknown): string {
  return JSON.stringify(value ?? null).replaceAll("</script", "<\\/script");
}

function getSelectorActionScript(action: "click" | "fill", selector: string, wait: BrowserSelectorWait, timeoutMs: number, text?: string): string {
  return `(() => new Promise((resolve, reject) => {
    const selector = ${serializeForInjectedScript(selector)};
    const wait = ${serializeForInjectedScript(wait)};
    const timeoutMs = ${timeoutMs};
    const text = ${serializeForInjectedScript(text ?? "")};
    const startedAt = Date.now();
    const isVisible = (element) => {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0;
    };
    const tick = () => {
      const matches = Array.from(document.querySelectorAll(selector));
      const element = matches.find((item) => wait !== "visible" || isVisible(item));
      if (!element && Date.now() - startedAt < timeoutMs) {
        window.setTimeout(tick, 50);
        return;
      }
      if (!element) {
        reject(Object.assign(new Error("selector did not appear before timeout"), { code: "TIMEOUT", matched: matches.length }));
        return;
      }
      try {
        if (${serializeForInjectedScript(action)} === "click") {
          element.scrollIntoView({ block: "center", inline: "center" });
          element.click();
          resolve({ matched: matches.length, url: location.href });
          return;
        }
        const editable = element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element.isContentEditable;
        if (!editable) {
          reject(Object.assign(new Error("target is not fillable"), { code: "BAD_REQUEST" }));
          return;
        }
        element.focus();
        if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
          element.value = text;
        } else {
          element.textContent = text;
        }
        element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
        element.dispatchEvent(new Event("change", { bubbles: true }));
        resolve({ matched: matches.length, valueLength: text.length });
      } catch (error) {
        reject(error);
      }
    };
    tick();
  }))()`;
}

function getSnapshotScript(params: BrowserSnapshotParams): string {
  return `(() => {
    const rootSelector = ${serializeForInjectedScript(params.selector)};
    const format = ${serializeForInjectedScript(params.format ?? "text")};
    const includeHidden = ${params.includeHidden === true};
    const maxTextLength = ${Math.max(1, Math.floor(params.maxTextLength ?? 2000))};
    const root = rootSelector ? document.querySelector(rootSelector) : document.body;
    if (!root) {
      throw Object.assign(new Error("snapshot selector not found"), { code: "TIMEOUT" });
    }
    const isVisible = (element) => {
      if (includeHidden || !(element instanceof HTMLElement)) return true;
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0;
    };
    const selectorFor = (element) => {
      if (!(element instanceof Element)) return undefined;
      if (element.id) return "#" + CSS.escape(element.id);
      const tag = element.tagName.toLowerCase();
      const parent = element.parentElement;
      if (!parent) return tag;
      const index = Array.from(parent.children).filter((item) => item.tagName === element.tagName).indexOf(element) + 1;
      return index > 1 ? tag + ":nth-of-type(" + index + ")" : tag;
    };
    const roleFor = (element) => {
      const explicit = element.getAttribute("role");
      if (explicit) return explicit;
      const tag = element.tagName.toLowerCase();
      if (tag === "button") return "button";
      if (tag === "a") return "link";
      if (tag === "input" || tag === "textarea") return "textbox";
      if (/^h[1-6]$/.test(tag)) return "heading";
      return undefined;
    };
    const textFor = (element) => {
      const text = (element.innerText || element.textContent || "").replace(/\\s+/g, " ").trim();
      return text ? text.slice(0, maxTextLength) : undefined;
    };
    const buildNode = (element) => {
      if (!(element instanceof Element) || !isVisible(element)) return null;
      const children = Array.from(element.children).map(buildNode).filter(Boolean);
      const node = {
        role: roleFor(element),
        tag: element.tagName.toLowerCase(),
        id: element.id || undefined,
        name: element.getAttribute("aria-label") || element.getAttribute("name") || undefined,
        text: textFor(element),
        selector: selectorFor(element),
        children: children.length ? children : undefined
      };
      return node;
    };
    const node = buildNode(root);
    if (format === "json") {
      return { title: document.title, url: location.href, snapshot: node };
    }
    const lines = ["title: " + document.title, "url: " + location.href];
    const walk = (item, depth) => {
      if (!item) return;
      const text = item.text ? " \\"" + item.text.replaceAll("\\"", "\\\\\\"") + "\\"" : "";
      const selector = item.selector ? " selector=\\"" + item.selector.replaceAll("\\"", "\\\\\\"") + "\\"" : "";
      lines.push("  ".repeat(depth) + item.tag + text + selector);
      for (const child of item.children || []) walk(child, depth + 1);
    };
    walk(node, 0);
    return { title: document.title, url: location.href, snapshot: lines.join("\\n") };
  })()`;
}

function getValueType(value: unknown): "null" | "boolean" | "number" | "string" | "object" | "array" {
  if (value === null || value === undefined) {
    return "null";
  }
  if (Array.isArray(value)) {
    return "array";
  }
  const valueType = typeof value;
  if (valueType === "boolean" || valueType === "number" || valueType === "string") {
    return valueType;
  }
  return "object";
}

async function runBrowserRpc(
  method: BrowserRpcMethod,
  params: unknown,
  workspaces: Workspace[],
  activeWorkspaceId: string,
  createSurface: (selector: BrowserSurfaceSelector, url: string) => Promise<{ surface: Surface; paneId: string; workspaceId: string }>
): Promise<unknown> {
  ensureNoCreateForNonNavigate(method, params);
  if (method === "browser.list") {
    const listParams = isRecord(params) ? params : {};
    const workspaceId = typeof listParams.workspaceId === "string" ? listParams.workspaceId : undefined;
    return { browsers: await createBrowserSurfaceSummaries(workspaces, activeWorkspaceId, workspaceId) };
  }

  const selector = (isRecord(params) ? params : {}) as BrowserSurfaceSelector;
  const forceCreate = method === "browser.navigate" && isRecord(params) && params.forceCreate === true;
  let resolved = forceCreate ? null : await resolveBrowserSurface(workspaces, activeWorkspaceId, selector);
  if ((!resolved || forceCreate) && method === "browser.navigate" && selector.createIfMissing === true) {
    const navigateParams = params as Partial<BrowserNavigateParams>;
    if (typeof navigateParams.url !== "string" || !navigateParams.url.trim()) {
      throw createBrowserError("BAD_REQUEST", "browser.navigate 需要 url");
    }
    const created = await createSurface(selector, navigateParams.url);
    const runtime = await waitForBrowserRuntime(created.surface.id, getBrowserTimeout(params, 10_000));
    const finalUrl = await runtime.navigate(navigateParams.url, readBrowserWaitUntil(params), getBrowserTimeout(params, 10_000));
    const titleResult = await executeBrowserJavaScript<string>(runtime, "document.title", 1000).catch(() => "");
    return { surfaceId: created.surface.id, workspaceId: created.workspaceId, paneId: created.paneId, url: finalUrl, title: titleResult };
  }

  if (!resolved) {
    throw createBrowserError("NOT_FOUND", "找不到 browser surface");
  }

  const runtime = await waitForBrowserRuntime(resolved.surface.id, getBrowserTimeout(params, method === "browser.screenshot" ? 10_000 : 5000));
  const commonResult = { surfaceId: resolved.surface.id, workspaceId: resolved.workspace.id, paneId: resolved.paneId };

  if (method === "browser.navigate") {
    const navigateParams = params as Partial<BrowserNavigateParams>;
    if (typeof navigateParams.url !== "string" || !navigateParams.url.trim()) {
      throw createBrowserError("BAD_REQUEST", "browser.navigate 需要 url");
    }
    const timeoutMs = getBrowserTimeout(params, 10_000);
    const finalUrl = await runtime.navigate(navigateParams.url, readBrowserWaitUntil(params), timeoutMs);
    const title = await executeBrowserJavaScript<string>(runtime, "document.title", 1000).catch(() => "");
    return { ...commonResult, url: finalUrl, title };
  }

  if (method === "browser.click") {
    const clickParams = params as Partial<BrowserClickParams>;
    if (typeof clickParams.selector !== "string" || !clickParams.selector.trim()) {
      throw createBrowserError("BAD_REQUEST", "browser.click 需要 selector");
    }
    const timeoutMs = getBrowserTimeout(params, 5000);
    const result = await executeBrowserJavaScript<{ matched: number; url: string }>(
      runtime,
      getSelectorActionScript("click", clickParams.selector, readSelectorWait(params), timeoutMs),
      timeoutMs + 500
    );
    return { ...commonResult, selector: clickParams.selector, matched: result.matched, clicked: true, url: result.url };
  }

  if (method === "browser.fill") {
    const fillParams = params as Partial<BrowserFillParams>;
    if (typeof fillParams.selector !== "string" || !fillParams.selector.trim() || typeof fillParams.text !== "string") {
      throw createBrowserError("BAD_REQUEST", "browser.fill 需要 selector 和 text");
    }
    const timeoutMs = getBrowserTimeout(params, 5000);
    const result = await executeBrowserJavaScript<{ matched: number; valueLength: number }>(
      runtime,
      getSelectorActionScript("fill", fillParams.selector, readSelectorWait(params), timeoutMs, fillParams.text),
      timeoutMs + 500
    );
    return { ...commonResult, selector: fillParams.selector, filled: true, valueLength: result.valueLength };
  }

  if (method === "browser.eval") {
    const evalParams = params as Partial<BrowserEvalParams>;
    if (typeof evalParams.script !== "string" || !evalParams.script.trim()) {
      throw createBrowserError("BAD_REQUEST", "browser.eval 需要 script");
    }
    const value = await executeBrowserJavaScript(runtime, evalParams.script, getBrowserTimeout(params, 5000));
    return { ...commonResult, value: value ?? null, valueType: getValueType(value) };
  }

  if (method === "browser.snapshot") {
    const snapshotParams = (isRecord(params) ? params : {}) as BrowserSnapshotParams;
    const result = await executeBrowserJavaScript<{ title: string; url: string; snapshot: string | BrowserSnapshotNode }>(
      runtime,
      getSnapshotScript(snapshotParams),
      getBrowserTimeout(params, 5000)
    );
    return { ...commonResult, url: result.url, title: result.title, format: snapshotParams.format ?? "text", snapshot: result.snapshot };
  }

  const screenshotParams = (isRecord(params) ? params : {}) as BrowserScreenshotParams;
  if (screenshotParams.fullPage) {
    throw createBrowserError("UNSUPPORTED", "P0 暂不支持 fullPage screenshot");
  }
  if (screenshotParams.selector) {
    throw createBrowserError("UNSUPPORTED", "P0 暂不支持 selector screenshot");
  }
  if (screenshotParams.format && screenshotParams.format !== "png" && screenshotParams.format !== "jpeg") {
    throw createBrowserError("BAD_REQUEST", "screenshot format 必须是 png 或 jpeg");
  }
  if (!runtime.webview.capturePage) {
    throw createBrowserError("BROWSER_ERROR", "当前 webview 不支持 capturePage", { surfaceId: runtime.surfaceId });
  }
  const image = await Promise.race([
    runtime.webview.capturePage(),
    new Promise<never>((_resolve, reject) =>
      window.setTimeout(
        () => reject(createBrowserError("TIMEOUT", "browser screenshot 超时", { surfaceId: runtime.surfaceId })),
        getBrowserTimeout(params, 10_000)
      )
    )
  ]);
  const mimeType = screenshotParams.format === "jpeg" ? "image/jpeg" : "image/png";
  const dataUrl = image.toDataURL().replace(/^data:image\/png/, `data:${mimeType}`);
  const base64 = dataUrl.split(",")[1] ?? "";
  const url = runtime.webview.getURL?.() ?? "";
  if (screenshotParams.path) {
    const written = await window.wmux?.browser.writeScreenshot({
      path: screenshotParams.path,
      base64,
      format: screenshotParams.format ?? "png"
    });
    return { ...commonResult, url, path: written?.path ?? screenshotParams.path, mimeType, bytes: written?.bytes ?? base64.length };
  }

  return { ...commonResult, url, mimeType, bytes: base64.length, base64 };
}

function createWorkspaceSummaries(workspaces: Workspace[], activeWorkspaceId: string): WorkspaceSummary[] {
  return workspaces.map((workspace) => {
    const activePane = workspace.panes[workspace.activePaneId];

    return {
      id: workspace.id,
      name: workspace.name,
      cwd: workspace.cwd,
      status: workspace.status,
      active: workspace.id === activeWorkspaceId,
      activePaneId: workspace.activePaneId,
      activeSurfaceId: activePane?.activeSurfaceId,
      notice: workspace.notice
    };
  });
}

function createSurfaceSummaries(workspaces: Workspace[], activeWorkspaceId: string, workspaceId?: string): SurfaceSummary[] {
  const targetWorkspaces = workspaceId ? workspaces.filter((workspace) => workspace.id === workspaceId) : workspaces;
  return targetWorkspaces.flatMap((workspace) =>
    Object.values(workspace.panes).flatMap((pane) =>
      pane.surfaceIds
        .map((surfaceId) => workspace.surfaces[surfaceId])
        .filter((surface): surface is Surface => Boolean(surface))
        .map((surface) => ({
          surfaceId: surface.id,
          type: surface.type,
          workspaceId: workspace.id,
          workspaceName: workspace.name,
          paneId: pane.id,
          active: workspace.id === activeWorkspaceId && workspace.activePaneId === pane.id && pane.activeSurfaceId === surface.id,
          name: surface.name,
          status: surface.status,
          subtitle: surface.subtitle
        }))
    )
  );
}

function shouldApplyWorkspaceInspection(workspace: Workspace, inspection: WorkspaceInspection): boolean {
  const nextBranch = inspection.branch;
  const nextPorts = inspection.ports;
  return workspace.branch !== nextBranch || workspace.ports.join(",") !== nextPorts.join(",");
}

function shouldIgnoreGlobalShortcut(event: KeyboardEvent): boolean {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  if (target.closest("input, textarea, select, [contenteditable='true'], .terminalHost, webview")) {
    return true;
  }

  return false;
}

export function App(): ReactElement {
  const [workspaces, setWorkspaces] = useState(initialWorkspaces);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState(workspaces[0].id);
  const [hasHydratedPersistedState, setHasHydratedPersistedState] = useState(false);
  const [editingWorkspaceId, setEditingWorkspaceId] = useState<string | null>(null);
  const [workspaceNameDraft, setWorkspaceNameDraft] = useState("");
  const [appVersion, setAppVersion] = useState("dev");
  const [shellProfile, setShellProfile] = useState<ShellProfile>("auto");
  const [shellOptions, setShellOptions] = useState<ShellProfileOption[]>([
    { id: "auto", label: "Auto" },
    { id: "powershell", label: "Windows PowerShell" },
    { id: "cmd", label: "CMD" }
  ]);
  const [projectConfig, setProjectConfig] = useState<WmuxProjectConfigResult | null>(null);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [commandQuery, setCommandQuery] = useState("");
  const [selectedCommandIndex, setSelectedCommandIndex] = useState(0);
  const [pendingTerminalCommands, setPendingTerminalCommands] = useState<PendingTerminalCommand[]>([]);
  const [trustedCommandConfigPath, setTrustedCommandConfigPath] = useState<string | null>(null);
  const [pendingCommandConfirmation, setPendingCommandConfirmation] = useState<WmuxCommandConfig | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [securitySettings, setSecuritySettings] = useState<SocketSecuritySettings | null>(null);
  const [securityModeDraft, setSecurityModeDraft] = useState<SocketSecurityMode>("wmuxOnly");

  useEffect(() => {
    void window.wmux?.getVersion().then(setAppVersion).catch(() => setAppVersion("dev"));
    void window.wmux?.getSecurityState?.()
      .then((state) => {
        if (!state) {
          return;
        }

        setSecuritySettings(state);
        setSecurityModeDraft(state.configuredMode);
        if (state.activeMode !== "allowAll" || !state.warning) {
          return;
        }
        setWorkspaces((items) =>
          items.map((workspace, index) =>
            index === 0
              ? {
                  ...workspace,
                  status: "attention",
                  notice: state.warning
                }
              : workspace
          )
        );
      })
      .catch(() => undefined);
    void window.wmux?.terminal
      .listShells()
      .then((options) => {
        setShellOptions(options);
        if (!options.some((option) => option.id === shellProfileRef.current)) {
          setShellProfile("auto");
        }
      })
      .catch(() => {
        setShellOptions([
          { id: "auto", label: "Auto" },
          { id: "powershell", label: "Windows PowerShell" },
          { id: "cmd", label: "CMD" }
        ]);
      });
  }, []);

  useEffect(() => {
    let isMounted = true;
    void window.wmux?.config
      .loadProjectConfig()
      .then((config) => {
        if (isMounted) {
          setProjectConfig(config);
        }
      })
      .catch((error) => {
        if (isMounted) {
          setProjectConfig({
            path: "wmux.json",
            found: true,
            config: { commands: [] },
            errors: [`读取项目配置失败：${error instanceof Error ? error.message : String(error)}`]
          });
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    let isMounted = true;

    void window.wmux?.workspace
      .loadState()
      .then((state) => {
        if (!isMounted || !state?.workspaces?.length) {
          return;
        }

        hydrateCreationCounters(state.workspaces);
        restoreBrowserSessions(state.browserSessions);
        setWorkspaces(state.workspaces);
        setActiveWorkspaceId(
          state.workspaces.some((workspace) => workspace.id === state.activeWorkspaceId)
            ? state.activeWorkspaceId
            : state.workspaces[0].id
        );
      })
      .finally(() => {
        if (isMounted) {
          setHasHydratedPersistedState(true);
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (!hasHydratedPersistedState) {
      return;
    }

    const saveTimer = window.setTimeout(() => {
      void window.wmux?.workspace.saveState({
        version: 1,
        activeWorkspaceId,
        workspaces,
        browserSessions: getBrowserSessionSnapshot()
      });
    }, 200);

    return () => window.clearTimeout(saveTimer);
  }, [activeWorkspaceId, hasHydratedPersistedState, workspaces]);

  const projectCommands = projectConfig?.config.commands ?? [];
  const filteredCommands = projectCommands.filter((command) => commandMatchesQuery(command, commandQuery));
  const normalizedSelectedCommandIndex = filteredCommands.length
    ? Math.min(selectedCommandIndex, filteredCommands.length - 1)
    : 0;
  const configStatusText = projectConfig?.found
    ? `${projectCommands.length} 个项目命令`
    : "未发现 wmux.json";
  const configErrorText = projectConfig?.errors.join("；");

  const activeWorkspace = workspaces.find((workspace) => workspace.id === activeWorkspaceId) ?? workspaces[0];
  const workspacesRef = useRef(workspaces);
  const activeWorkspaceIdRef = useRef(activeWorkspaceId);
  const shellProfileRef = useRef(shellProfile);

  useEffect(() => {
    workspacesRef.current = workspaces;
  }, [workspaces]);

  useEffect(() => {
    activeWorkspaceIdRef.current = activeWorkspaceId;
  }, [activeWorkspaceId]);

  useEffect(() => {
    shellProfileRef.current = shellProfile;
  }, [shellProfile]);

  useEffect(() => {
    if (!hasHydratedPersistedState) {
      return;
    }

    let isCancelled = false;
    const uniqueCwds = [...new Set(workspaces.map((workspace) => workspace.cwd))];

    void Promise.all(
      uniqueCwds.map((cwd) =>
        window.wmux?.workspace
          .inspectCwd(cwd)
          .then((inspection) => ({ cwd, inspection }))
          .catch(() => null)
      )
    ).then((results) => {
      if (isCancelled) {
        return;
      }

      const inspectionByCwd = new Map<string, WorkspaceInspection>();
      results.forEach((result) => {
        if (result?.inspection) {
          inspectionByCwd.set(result.cwd, result.inspection);
        }
      });
      if (!inspectionByCwd.size) {
        return;
      }

      setWorkspaces((currentWorkspaces) =>
        currentWorkspaces.map((workspace) => {
          const inspection = inspectionByCwd.get(workspace.cwd);
          if (!inspection || !shouldApplyWorkspaceInspection(workspace, inspection)) {
            return workspace;
          }

          return {
            ...workspace,
            branch: inspection.branch,
            ports: inspection.ports
          };
        })
      );
    });

    return () => {
      isCancelled = true;
    };
  }, [hasHydratedPersistedState, workspaces.map((workspace) => workspace.cwd).join("\n")]);

  useEffect(() => {
    if (selectedCommandIndex > normalizedSelectedCommandIndex) {
      setSelectedCommandIndex(normalizedSelectedCommandIndex);
    }
  }, [normalizedSelectedCommandIndex, selectedCommandIndex]);

  useEffect(() => {
    if (!pendingTerminalCommands.length) {
      return;
    }

    const timer = window.setTimeout(() => {
      pendingTerminalCommands.forEach((pendingCommand) => {
        window.wmux?.terminal.input({
          id: `${pendingCommand.surfaceId}:${shellProfileRef.current}`,
          data: appendCommandNewline(pendingCommand.command)
        });
      });
      setPendingTerminalCommands([]);
    }, 1200);

    return () => window.clearTimeout(timer);
  }, [pendingTerminalCommands]);

  const openCommandPalette = (): void => {
    setCommandPaletteOpen(true);
    setCommandQuery("");
    setSelectedCommandIndex(0);
  };

  const closeCommandPalette = (): void => {
    setCommandPaletteOpen(false);
    setCommandQuery("");
    setSelectedCommandIndex(0);
  };

  const runSimpleCommand = (command: WmuxCommandConfig): void => {
    if (!command.command) {
      return;
    }

    const terminalSurface = getActiveTerminalSurface(activeWorkspace);
    if (terminalSurface) {
      window.wmux?.terminal.input({
        id: `${terminalSurface.id}:${shellProfileRef.current}`,
        data: appendCommandNewline(command.command)
      });
      updateActiveWorkspace((workspace) => ({
        ...workspace,
        status: "running",
        notice: `已运行命令：${command.name}`
      }));
      return;
    }

    const pane = activeWorkspace.panes[activeWorkspace.activePaneId];
    const surface = createTerminalSurface();
    setWorkspaces((currentWorkspaces) =>
      currentWorkspaces.map((workspace) =>
        workspace.id === activeWorkspace.id
          ? {
              ...workspace,
              status: "running",
              notice: `已运行命令：${command.name}`,
              panes: {
                ...workspace.panes,
                [workspace.activePaneId]: {
                  ...pane,
                  surfaceIds: [...pane.surfaceIds, surface.id],
                  activeSurfaceId: surface.id
                }
              },
              surfaces: {
                ...workspace.surfaces,
                [surface.id]: surface
              }
            }
          : workspace
      )
    );
    setPendingTerminalCommands((items) => [...items, { surfaceId: surface.id, command: command.command ?? "" }]);
  };

  const runWorkspaceCommand = (command: WmuxCommandConfig): void => {
    const buildResult = createWorkspaceFromCommand(command);
    setWorkspaces((currentWorkspaces) => [...currentWorkspaces, buildResult.workspace]);
    setActiveWorkspaceId(buildResult.workspace.id);
    setPendingTerminalCommands((items) => [...items, ...buildResult.terminalCommands]);
  };

  const executeProjectCommand = (command: WmuxCommandConfig): void => {
    if (command.workspace) {
      runWorkspaceCommand(command);
    } else {
      runSimpleCommand(command);
    }
  };

  const runProjectCommand = (command: WmuxCommandConfig): void => {
    const configPath = projectConfig?.path;
    if (projectConfig?.found && configPath && trustedCommandConfigPath !== configPath) {
      setPendingCommandConfirmation(command);
      return;
    }

    executeProjectCommand(command);
    closeCommandPalette();
  };

  const confirmProjectCommand = (): void => {
    const command = pendingCommandConfirmation;
    if (!command) {
      return;
    }

    if (projectConfig?.path) {
      setTrustedCommandConfigPath(projectConfig.path);
    }
    executeProjectCommand(command);
    setPendingCommandConfirmation(null);
    closeCommandPalette();
  };

  const handleSaveSecurityMode = (): void => {
    void window.wmux
      ?.setSecurityMode(securityModeDraft)
      .then((settings) => {
        setSecuritySettings(settings);
        setSecurityModeDraft(settings.configuredMode);
      })
      .catch(() => undefined);
  };

  const updateActiveWorkspace = (updater: (workspace: Workspace) => Workspace): void => {
    setWorkspaces((currentWorkspaces) =>
      currentWorkspaces.map((workspace) => (workspace.id === activeWorkspace.id ? updater(workspace) : workspace))
    );
  };

  const clearWorkspaceStatus = useCallback((workspaceId: string): void => {
    setWorkspaces((currentWorkspaces) =>
      currentWorkspaces.map((workspace) =>
        workspace.id === workspaceId
          ? {
              ...workspace,
              status: "idle",
              notice: undefined
            }
          : workspace
      )
    );
  }, []);

  useEffect(() => {
    const removeSocketRequestListener = window.wmux?.socket.onRequest((request: SocketRpcRequest) => {
      const currentWorkspaces = workspacesRef.current;
      const currentActiveWorkspaceId = activeWorkspaceIdRef.current;
      const currentWorkspace =
        currentWorkspaces.find((workspace) => workspace.id === currentActiveWorkspaceId) ?? currentWorkspaces[0];

      if (!currentWorkspace) {
        window.wmux?.socket.respond(createSocketErrorResponse(request.id, "INVALID_STATE", "没有可用 workspace"));
        return;
      }

      if (request.method === "system.identify") {
        const activePane = currentWorkspace.panes[currentWorkspace.activePaneId];
        const activeSurface = activePane ? currentWorkspace.surfaces[activePane.activeSurfaceId] : undefined;
        window.wmux?.socket.respond(
          createSocketSuccessResponse(request.id, {
            app: "wmux",
            workspaceId: currentWorkspace.id,
            workspaceName: currentWorkspace.name,
            paneId: activePane?.id ?? currentWorkspace.activePaneId,
            surfaceId: activeSurface?.id ?? activePane?.activeSurfaceId,
            surfaceType: activeSurface?.type,
            cwd: currentWorkspace.cwd,
            status: currentWorkspace.status
          })
        );
        return;
      }

      if (request.method === "system.capabilities") {
        window.wmux?.socket.respond(
          createSocketSuccessResponse(request.id, {
            methods: socketCapabilities
          })
        );
        return;
      }

      if (request.method === "workspace.list") {
        window.wmux?.socket.respond(
          createSocketSuccessResponse(request.id, {
            workspaces: createWorkspaceSummaries(currentWorkspaces, currentActiveWorkspaceId)
          })
        );
        return;
      }

      if (request.method === "surface.list") {
        const params = (request.params ?? {}) as Partial<SurfaceListParams>;
        if (params.workspaceId && !currentWorkspaces.some((workspace) => workspace.id === params.workspaceId)) {
          window.wmux?.socket.respond(
            createSocketErrorResponse(request.id, "NOT_FOUND", "找不到 workspace", {
              workspaceId: params.workspaceId
            })
          );
          return;
        }

        window.wmux?.socket.respond(
          createSocketSuccessResponse(request.id, {
            surfaces: createSurfaceSummaries(currentWorkspaces, currentActiveWorkspaceId, params.workspaceId)
          })
        );
        return;
      }

      if (request.method === "surface.sendText") {
        const params = (request.params ?? {}) as Partial<SendTextParams>;
        if (typeof params.text !== "string") {
          window.wmux?.socket.respond(createSocketErrorResponse(request.id, "BAD_REQUEST", "sendText 需要 text 字符串"));
          return;
        }

        const terminalSurface = getActiveTerminalSurface(currentWorkspace, params.surfaceId);
        if (!terminalSurface) {
          window.wmux?.socket.respond(createSocketErrorResponse(request.id, "NOT_FOUND", "当前 workspace 没有 terminal surface"));
          return;
        }

        window.wmux?.terminal.input({ id: `${terminalSurface.id}:${shellProfileRef.current}`, data: params.text });
        window.wmux?.socket.respond(
          createSocketSuccessResponse(request.id, {
            surfaceId: terminalSurface.id,
            bytes: params.text.length
          })
        );
        return;
      }

      if (request.method === "surface.sendKey") {
        const params = (request.params ?? {}) as Partial<SendKeyParams>;
        if (typeof params.key !== "string" || !params.key.trim()) {
          window.wmux?.socket.respond(createSocketErrorResponse(request.id, "BAD_REQUEST", "sendKey 需要 key 字符串"));
          return;
        }

        const sequence = getTerminalKeySequence(params.key);
        if (!sequence) {
          window.wmux?.socket.respond(
            createSocketErrorResponse(request.id, "BAD_REQUEST", `不支持的 terminal key：${params.key}`, {
              key: params.key,
              supportedKeys: Object.keys(terminalKeySequences)
            })
          );
          return;
        }

        const terminalSurface = getActiveTerminalSurface(currentWorkspace, params.surfaceId);
        if (!terminalSurface) {
          window.wmux?.socket.respond(createSocketErrorResponse(request.id, "NOT_FOUND", "当前 workspace 没有 terminal surface"));
          return;
        }

        window.wmux?.terminal.input({ id: `${terminalSurface.id}:${shellProfileRef.current}`, data: sequence });
        window.wmux?.socket.respond(
          createSocketSuccessResponse(request.id, {
            surfaceId: terminalSurface.id,
            key: normalizeTerminalKey(params.key),
            bytes: sequence.length
          })
        );
        return;
      }

      if (request.method === "status.notify") {
        const params = (request.params ?? {}) as Partial<NotifyParams>;
        if (typeof params.title !== "string" || !params.title.trim()) {
          window.wmux?.socket.respond(createSocketErrorResponse(request.id, "BAD_REQUEST", "notify 需要 title"));
          return;
        }

        const targetWorkspaceId = params.workspaceId ?? currentActiveWorkspaceId;
        const notice = params.body?.trim() ? `${params.title}: ${params.body}` : params.title;
        setWorkspaces((items) =>
          items.map((workspace) =>
            workspace.id === targetWorkspaceId
              ? {
                  ...workspace,
                  status: "attention",
                  notice
                }
              : workspace
          )
        );
        window.wmux?.socket.respond(createSocketSuccessResponse(request.id, { workspaceId: targetWorkspaceId, notice }));
        return;
      }

      if (request.method === "status.clear") {
        const params = (request.params ?? {}) as Partial<ClearStatusParams>;
        const targetWorkspaceId = params.workspaceId ?? currentActiveWorkspaceId;
        const targetWorkspace = currentWorkspaces.find((workspace) => workspace.id === targetWorkspaceId);
        if (!targetWorkspace) {
          window.wmux?.socket.respond(
            createSocketErrorResponse(request.id, "NOT_FOUND", "找不到 workspace", {
              workspaceId: targetWorkspaceId
            })
          );
          return;
        }

        setWorkspaces((items) =>
          items.map((workspace) =>
            workspace.id === targetWorkspaceId
              ? {
                  ...workspace,
                  status: "idle",
                  notice: undefined
                }
              : workspace
          )
        );
        window.wmux?.socket.respond(createSocketSuccessResponse(request.id, { workspaceId: targetWorkspaceId, status: "idle" }));
        return;
      }

      if (request.method === "status.list") {
        const params = (request.params ?? {}) as Partial<StatusListParams>;
        const summaries = createWorkspaceSummaries(currentWorkspaces, currentActiveWorkspaceId);
        const statuses = params.workspaceId
          ? summaries.filter((workspace) => workspace.id === params.workspaceId)
          : summaries;

        if (params.workspaceId && statuses.length === 0) {
          window.wmux?.socket.respond(
            createSocketErrorResponse(request.id, "NOT_FOUND", "找不到 workspace", {
              workspaceId: params.workspaceId
            })
          );
          return;
        }

        window.wmux?.socket.respond(createSocketSuccessResponse(request.id, { statuses }));
        return;
      }

      if (isBrowserRpcMethod(request.method)) {
        void runBrowserRpc(
          request.method,
          request.params,
          workspacesRef.current,
          activeWorkspaceIdRef.current,
          async (selector, url) =>
            new Promise((resolve, reject) => {
              setWorkspaces((currentWorkspaces) => {
                try {
                  const created = createBrowserSurfaceInWorkspace(currentWorkspaces, activeWorkspaceIdRef.current, selector, url);
                  window.setTimeout(
                    () =>
                      resolve({
                        surface: created.surface,
                        paneId: created.paneId,
                        workspaceId: created.workspaceId
                      }),
                    0
                  );
                  return created.workspaces;
                } catch (error) {
                  reject(error);
                  return currentWorkspaces;
                }
              });
            })
        )
          .then((result) => {
            window.wmux?.socket.respond(createSocketSuccessResponse(request.id, result));
          })
          .catch((error) => {
            const code =
              error instanceof Error && "code" in error && typeof error.code === "string"
                ? (error.code as SocketRpcErrorCode)
                : "BROWSER_ERROR";
            const details =
              error instanceof Error && "details" in error && isRecord(error.details)
                ? (error.details as SocketRpcErrorDetails)
                : undefined;
            window.wmux?.socket.respond(
              createSocketErrorResponse(request.id, code, error instanceof Error ? error.message : String(error), {
                ...details,
                method: request.method
              })
            );
          });
        return;
      }

      window.wmux?.socket.respond(createSocketErrorResponse(request.id, "METHOD_NOT_FOUND", `未知方法：${request.method}`));
    });

    return () => removeSocketRequestListener?.();
  }, []);

  const handleCreateWorkspace = (): void => {
    const workspace = createWorkspace();
    setWorkspaces((currentWorkspaces) => [...currentWorkspaces, workspace]);
    setActiveWorkspaceId(workspace.id);
  };

  const handleStartRenameWorkspace = (workspace: Workspace): void => {
    setEditingWorkspaceId(workspace.id);
    setWorkspaceNameDraft(workspace.name);
    setActiveWorkspaceId(workspace.id);
  };

  const handleCommitRenameWorkspace = (): void => {
    if (!editingWorkspaceId) {
      return;
    }

    const nextName = workspaceNameDraft.trim();
    setWorkspaces((currentWorkspaces) =>
      currentWorkspaces.map((workspace) =>
        workspace.id === editingWorkspaceId && nextName ? { ...workspace, name: nextName } : workspace
      )
    );
    setEditingWorkspaceId(null);
    setWorkspaceNameDraft("");
  };

  const handleCancelRenameWorkspace = (): void => {
    setEditingWorkspaceId(null);
    setWorkspaceNameDraft("");
  };

  const handleCloseWorkspace = (workspaceId: string): void => {
    if (workspaces.length <= 1) {
      return;
    }

    const closedIndex = workspaces.findIndex((workspace) => workspace.id === workspaceId);
    const nextWorkspaces = workspaces.filter((workspace) => workspace.id !== workspaceId);
    const fallbackWorkspace =
      workspaceId === activeWorkspaceId
        ? nextWorkspaces[Math.max(0, Math.min(closedIndex, nextWorkspaces.length - 1))]
        : undefined;

    setWorkspaces(nextWorkspaces);
    if (fallbackWorkspace) {
      setActiveWorkspaceId(fallbackWorkspace.id);
    }
    if (editingWorkspaceId === workspaceId) {
      handleCancelRenameWorkspace();
    }
  };

  const handleAddTerminalSurface = (paneId: string): void => {
    updateActiveWorkspace((workspace) => {
      const pane = workspace.panes[paneId];
      const surface = createTerminalSurface();

      return {
        ...workspace,
        activePaneId: paneId,
        panes: {
          ...workspace.panes,
          [paneId]: {
            ...pane,
            surfaceIds: [...pane.surfaceIds, surface.id],
            activeSurfaceId: surface.id
          }
        },
        surfaces: {
          ...workspace.surfaces,
          [surface.id]: surface
        }
      };
    });
  };

  const handleAddBrowserSurface = (paneId: string): void => {
    updateActiveWorkspace((workspace) => {
      const pane = workspace.panes[paneId];
      const surface = createBrowserSurface();

      return {
        ...workspace,
        activePaneId: paneId,
        panes: {
          ...workspace.panes,
          [paneId]: {
            ...pane,
            surfaceIds: [...pane.surfaceIds, surface.id],
            activeSurfaceId: surface.id
          }
        },
        surfaces: {
          ...workspace.surfaces,
          [surface.id]: surface
        }
      };
    });
  };

  const handleOpenTerminalUrl = (url: string): void => {
    const normalizedUrl = normalizeBrowserUrl(url);
    const currentWorkspaces = workspacesRef.current;
    const targetWorkspaceId = activeWorkspaceIdRef.current;
    const targetWorkspace = currentWorkspaces.find((workspace) => workspace.id === targetWorkspaceId) ?? currentWorkspaces[0];
    if (!targetWorkspace) {
      return;
    }

    let openResult: { workspace: Workspace; target: BrowserSurfaceTarget };
    try {
      openResult = findOrCreateBrowserSurfaceForWorkspace(targetWorkspace, normalizedUrl);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setWorkspaces((items) =>
        items.map((workspace) =>
          workspace.id === targetWorkspace.id
            ? {
                ...workspace,
                status: "error",
                notice: `Browser link failed: ${message}`
              }
            : workspace
        )
      );
      return;
    }

    setWorkspaces((currentWorkspaces) =>
      currentWorkspaces.map((workspace) => {
        if (workspace.id !== openResult.target.workspaceId) {
          return workspace;
        }

        return {
          ...openResult.workspace,
          status: "running",
          notice: `Opening terminal link: ${normalizedUrl}`,
          surfaces: {
            ...openResult.workspace.surfaces,
            [openResult.target.surface.id]: {
              ...openResult.workspace.surfaces[openResult.target.surface.id],
              subtitle: normalizedUrl
            }
          }
        };
      })
    );

    window.setTimeout(() => {
      const surfaceId = openResult.target.surface.id;

      void waitForBrowserRuntime(surfaceId, 10_000)
        .then((runtime) => runtime.navigate(normalizedUrl, "domcontentloaded", 10_000))
        .catch((error) => {
          const message = error instanceof Error ? error.message : String(error);
          setWorkspaces((currentWorkspaces) =>
            currentWorkspaces.map((workspace) =>
              workspace.id === activeWorkspaceIdRef.current
                ? {
                    ...workspace,
                    status: "error",
                    notice: `Browser link failed: ${message}`
                  }
                : workspace
            )
          );
        });
    }, 0);
  };

  const handleSelectSurface = (paneId: string, surfaceId: string): void => {
    updateActiveWorkspace((workspace) => {
      const pane = workspace.panes[paneId];

      return {
        ...workspace,
        activePaneId: paneId,
        panes: {
          ...workspace.panes,
          [paneId]: {
            ...pane,
            activeSurfaceId: surfaceId
          }
        }
      };
    });
  };

  const handleUpdateSurfaceSubtitle = (surfaceId: string, subtitle: string): void => {
    setWorkspaces((currentWorkspaces) =>
      currentWorkspaces.map((workspace) => {
        const surface = workspace.surfaces[surfaceId];
        if (!surface || surface.subtitle === subtitle) {
          return workspace;
        }

        return {
          ...workspace,
          surfaces: {
            ...workspace.surfaces,
            [surfaceId]: {
              ...surface,
              subtitle
            }
          }
        };
      })
    );
  };

  const handleCloseSurface = (paneId: string, surfaceId: string): void => {
    updateActiveWorkspace((workspace) => {
      const pane = workspace.panes[paneId];
      if (pane.surfaceIds.length <= 1) {
        return workspace;
      }

      const surfaceIndex = pane.surfaceIds.indexOf(surfaceId);
      const nextSurfaceIds = pane.surfaceIds.filter((id) => id !== surfaceId);
      const fallbackSurfaceId =
        pane.activeSurfaceId === surfaceId
          ? nextSurfaceIds[Math.max(0, Math.min(surfaceIndex, nextSurfaceIds.length - 1))]
          : pane.activeSurfaceId;
      const remainingSurfaces = Object.fromEntries(
        Object.entries(workspace.surfaces).filter(([currentSurfaceId]) => currentSurfaceId !== surfaceId)
      );

      return {
        ...workspace,
        activePaneId: paneId,
        panes: {
          ...workspace.panes,
          [paneId]: {
            ...pane,
            surfaceIds: nextSurfaceIds,
            activeSurfaceId: fallbackSurfaceId
          }
        },
        surfaces: remainingSurfaces
      };
    });
  };

  const handleCloseActiveSurface = (): void => {
    const activePane = activeWorkspace.panes[activeWorkspace.activePaneId];
    if (!activePane) {
      return;
    }

    if (activePane.surfaceIds.length > 1) {
      handleCloseSurface(activeWorkspace.activePaneId, activePane.activeSurfaceId);
      return;
    }

    handleClosePane(activeWorkspace.activePaneId);
  };

  const handleSelectWorkspaceByOffset = (offset: number): void => {
    if (workspaces.length <= 1) {
      return;
    }

    const currentIndex = Math.max(
      0,
      workspaces.findIndex((workspace) => workspace.id === activeWorkspaceId)
    );
    const nextIndex = (currentIndex + offset + workspaces.length) % workspaces.length;
    setActiveWorkspaceId(workspaces[nextIndex].id);
  };

  const handleSplitActivePane = (direction: "horizontal" | "vertical"): void => {
    updateActiveWorkspace((workspace) => {
      const { paneId, pane, surface } = createPaneWithTerminal();

      return {
        ...workspace,
        activePaneId: paneId,
        layout: splitPaneNode(workspace.layout, workspace.activePaneId, direction, paneId),
        panes: {
          ...workspace.panes,
          [paneId]: pane
        },
        surfaces: {
          ...workspace.surfaces,
          [surface.id]: surface
        }
      };
    });
  };

  const handleDropSurfaceToPane = (targetPaneId: string, edge: SplitDropEdge, payload: DraggedSurfacePayload): void => {
    updateActiveWorkspace((workspace) => {
      const sourcePane = workspace.panes[payload.paneId];
      const targetPane = workspace.panes[targetPaneId];
      const surface = workspace.surfaces[payload.surfaceId];

      if (!sourcePane || !targetPane || !surface || !sourcePane.surfaceIds.includes(payload.surfaceId)) {
        return workspace;
      }

      if (payload.paneId === targetPaneId && sourcePane.surfaceIds.length <= 1) {
        return workspace;
      }

      const newPaneId = `pane-dropped-${Date.now()}-${nextPaneNumber++}`;
      const isMovingWholePane = sourcePane.surfaceIds.length === 1;

      if (isMovingWholePane) {
        const layoutWithoutSourcePane = removePaneNode(workspace.layout, payload.paneId);
        if (!layoutWithoutSourcePane) {
          return workspace;
        }

        const remainingPanes = Object.fromEntries(
          Object.entries(workspace.panes).filter(([currentPaneId]) => currentPaneId !== payload.paneId)
        );

        return {
          ...workspace,
          activePaneId: newPaneId,
          layout: splitPaneNodeAtEdge(layoutWithoutSourcePane, targetPaneId, edge, newPaneId),
          panes: {
            ...remainingPanes,
            [newPaneId]: {
              id: newPaneId,
              surfaceIds: [payload.surfaceId],
              activeSurfaceId: payload.surfaceId
            }
          }
        };
      }

      const sourceSurfaceIndex = sourcePane.surfaceIds.indexOf(payload.surfaceId);
      const nextSourceSurfaceIds = sourcePane.surfaceIds.filter((surfaceId) => surfaceId !== payload.surfaceId);
      const nextSourceActiveSurfaceId =
        sourcePane.activeSurfaceId === payload.surfaceId
          ? nextSourceSurfaceIds[Math.max(0, Math.min(sourceSurfaceIndex, nextSourceSurfaceIds.length - 1))]
          : sourcePane.activeSurfaceId;

      return {
        ...workspace,
        activePaneId: newPaneId,
        layout: splitPaneNodeAtEdge(workspace.layout, targetPaneId, edge, newPaneId),
        panes: {
          ...workspace.panes,
          [payload.paneId]: {
            ...sourcePane,
            surfaceIds: nextSourceSurfaceIds,
            activeSurfaceId: nextSourceActiveSurfaceId
          },
          [newPaneId]: {
            id: newPaneId,
            surfaceIds: [payload.surfaceId],
            activeSurfaceId: payload.surfaceId
          }
        }
      };
    });
  };

  const handleResizeSplit = (splitId: string, ratio: number): void => {
    updateActiveWorkspace((workspace) => ({
      ...workspace,
      layout: updateSplitRatio(workspace.layout, splitId, ratio)
    }));
  };

  const handleClosePane = (paneId: string): void => {
    updateActiveWorkspace((workspace) => {
      if (countPanes(workspace.layout) <= 1) {
        return workspace;
      }

      const nextLayout = removePaneNode(workspace.layout, paneId);
      if (!nextLayout) {
        return workspace;
      }

      const pane = workspace.panes[paneId];
      const closedSurfaceIds = new Set(pane?.surfaceIds ?? []);
      const remainingPanes = Object.fromEntries(
        Object.entries(workspace.panes).filter(([currentPaneId]) => currentPaneId !== paneId)
      );
      const remainingSurfaces = Object.fromEntries(
        Object.entries(workspace.surfaces).filter(([surfaceId]) => !closedSurfaceIds.has(surfaceId))
      );
      const nextPaneIds = collectPaneIds(nextLayout);
      const nextActivePaneId =
        workspace.activePaneId === paneId ? nextPaneIds[0] ?? firstPaneId(nextLayout) : workspace.activePaneId;

      return {
        ...workspace,
        activePaneId: nextActivePaneId,
        layout: nextLayout,
        panes: remainingPanes,
        surfaces: remainingSurfaces
      };
    });
  };

  useEffect(() => {
    const handleGlobalKeyDown = (event: KeyboardEvent): void => {
      const key = event.key.toLowerCase();
      const isPrimary = event.ctrlKey || event.metaKey;
      const isPlain = !event.ctrlKey && !event.metaKey && !event.altKey;

      if (isPrimary && key === "k") {
        event.preventDefault();
        openCommandPalette();
        return;
      }

      if (shouldIgnoreGlobalShortcut(event)) {
        return;
      }

      if (isPrimary && event.shiftKey && key === "n") {
        event.preventDefault();
        handleCreateWorkspace();
        return;
      }

      if (isPrimary && ((event.altKey && key === "arrowright") || (!event.altKey && key === "pagedown"))) {
        event.preventDefault();
        handleSelectWorkspaceByOffset(1);
        return;
      }

      if (isPrimary && ((event.altKey && key === "arrowleft") || (!event.altKey && key === "pageup"))) {
        event.preventDefault();
        handleSelectWorkspaceByOffset(-1);
        return;
      }

      if (isPrimary && event.shiftKey && key === "enter") {
        event.preventDefault();
        handleAddTerminalSurface(activeWorkspace.activePaneId);
        return;
      }

      if (isPrimary && event.shiftKey && key === "b") {
        event.preventDefault();
        handleAddBrowserSurface(activeWorkspace.activePaneId);
        return;
      }

      if (isPrimary && event.altKey && key === "arrowdown") {
        event.preventDefault();
        handleSplitActivePane("vertical");
        return;
      }

      if (isPrimary && event.altKey && key === "arrowup") {
        event.preventDefault();
        handleSplitActivePane("horizontal");
        return;
      }

      if (isPlain && key === "f2") {
        event.preventDefault();
        handleStartRenameWorkspace(activeWorkspace);
        return;
      }

      if (isPrimary && key === "w") {
        event.preventDefault();
        handleCloseActiveSurface();
      }
    };

    window.addEventListener("keydown", handleGlobalKeyDown);
    return () => window.removeEventListener("keydown", handleGlobalKeyDown);
  }, [activeWorkspace, activeWorkspaceId, workspaces, workspaceNameDraft, editingWorkspaceId]);

  return (
    <main className="appShell">
      <WorkspaceSidebar
        workspaces={workspaces}
        activeWorkspaceId={activeWorkspace.id}
        editingWorkspaceId={editingWorkspaceId}
        workspaceNameDraft={workspaceNameDraft}
        onSelect={setActiveWorkspaceId}
        onCreate={handleCreateWorkspace}
        onStartRename={handleStartRenameWorkspace}
        onRenameDraftChange={setWorkspaceNameDraft}
        onCommitRename={handleCommitRenameWorkspace}
        onCancelRename={handleCancelRenameWorkspace}
        onClose={handleCloseWorkspace}
        onClearStatus={clearWorkspaceStatus}
        onOpenCommandPalette={openCommandPalette}
        settingsOpen={settingsOpen}
        notificationsOpen={notificationsOpen}
        securityModeDraft={securityModeDraft}
        securitySettings={securitySettings}
        onToggleNotifications={() => {
          setNotificationsOpen((isOpen) => !isOpen);
          setSettingsOpen(false);
        }}
        onToggleSettings={() => {
          setSettingsOpen((isOpen) => !isOpen);
          setNotificationsOpen(false);
        }}
        onSecurityModeDraftChange={setSecurityModeDraft}
        onSaveSecurityMode={handleSaveSecurityMode}
      />
      <section className="workspaceArea">
        <TitleBar
          workspace={activeWorkspace}
          version={appVersion}
          shellProfile={shellProfile}
          shellOptions={shellOptions}
          onShellProfileChange={setShellProfile}
          onAddTerminal={() => handleAddTerminalSurface(activeWorkspace.activePaneId)}
          onAddBrowser={() => handleAddBrowserSurface(activeWorkspace.activePaneId)}
          onSplitHorizontal={() => handleSplitActivePane("horizontal")}
          onSplitVertical={() => handleSplitActivePane("vertical")}
          onOpenCommandPalette={openCommandPalette}
        />
        <div className="surfaceStage">
          <LayoutRenderer
            workspace={activeWorkspace}
            node={activeWorkspace.layout}
            shellProfile={shellProfile}
            onAddTerminalSurface={handleAddTerminalSurface}
            onSelectSurface={handleSelectSurface}
            onCloseSurface={handleCloseSurface}
            onActivatePane={(paneId) => updateActiveWorkspace((workspace) => ({ ...workspace, activePaneId: paneId }))}
            onResizeSplit={handleResizeSplit}
            onClosePane={handleClosePane}
            onDropSurfaceToPane={handleDropSurfaceToPane}
            onUpdateSurfaceSubtitle={handleUpdateSurfaceSubtitle}
            onOpenTerminalUrl={handleOpenTerminalUrl}
          />
        </div>
      </section>
      <CommandPalette
        commands={filteredCommands}
        configError={configErrorText}
        configStatus={configStatusText}
        isOpen={commandPaletteOpen}
        query={commandQuery}
        selectedIndex={normalizedSelectedCommandIndex}
        onClose={closeCommandPalette}
        onQueryChange={(value) => {
          setCommandQuery(value);
          setSelectedCommandIndex(0);
        }}
        onRun={runProjectCommand}
        onSelectedIndexChange={setSelectedCommandIndex}
      />
      <ProjectCommandConfirmDialog
        command={pendingCommandConfirmation}
        configPath={projectConfig?.path}
        onCancel={() => setPendingCommandConfirmation(null)}
        onConfirm={confirmProjectCommand}
      />
    </main>
  );
}

function ProjectCommandConfirmDialog({
  command,
  configPath,
  onCancel,
  onConfirm
}: {
  command: WmuxCommandConfig | null;
  configPath?: string;
  onCancel: () => void;
  onConfirm: () => void;
}): ReactElement | null {
  if (!command) {
    return null;
  }

  return (
    <div className="confirmOverlay" role="presentation" onMouseDown={onCancel}>
      <section
        className="confirmDialog"
        role="dialog"
        aria-modal="true"
        aria-label="Confirm project command"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="confirmDialogHeader">
          <Command size={18} />
          <h2>Run project command?</h2>
        </div>
        <p>{command.name}</p>
        <p className="confirmDialogMeta">{configPath ?? "wmux.json"}</p>
        <div className="confirmDialogActions">
          <button className="toolbarButton" type="button" onClick={onCancel}>
            Cancel
          </button>
          <button className="commandButton" type="button" onClick={onConfirm}>
            Run project command
          </button>
        </div>
      </section>
    </div>
  );
}

function CommandPalette({
  commands,
  configError,
  configStatus,
  isOpen,
  query,
  selectedIndex,
  onClose,
  onQueryChange,
  onRun,
  onSelectedIndexChange
}: {
  commands: WmuxCommandConfig[];
  configError?: string;
  configStatus: string;
  isOpen: boolean;
  query: string;
  selectedIndex: number;
  onClose: () => void;
  onQueryChange: (value: string) => void;
  onRun: (command: WmuxCommandConfig) => void;
  onSelectedIndexChange: (index: number) => void;
}): ReactElement | null {
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    window.setTimeout(() => inputRef.current?.focus(), 0);
  }, [isOpen]);

  if (!isOpen) {
    return null;
  }

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      onSelectedIndexChange(commands.length ? (selectedIndex + 1) % commands.length : 0);
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      onSelectedIndexChange(commands.length ? (selectedIndex - 1 + commands.length) % commands.length : 0);
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      const command = commands[selectedIndex];
      if (command) {
        onRun(command);
      }
    }
  };

  return (
    <div className="commandPaletteOverlay" role="presentation" onMouseDown={onClose}>
      <section
        className="commandPalette"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="commandPaletteHeader">
          <Command size={18} />
          <input
            ref={inputRef}
            aria-label="Command search"
            value={query}
            placeholder="搜索 wmux 命令或工作区布局"
            onChange={(event) => onQueryChange(event.target.value)}
            onKeyDown={handleKeyDown}
          />
          <kbd>Esc</kbd>
        </div>
        <div className="commandPaletteStatus">
          <span>{configStatus}</span>
          {configError && <span className="commandPaletteError">{configError}</span>}
        </div>
        <div className="commandPaletteList" role="listbox" aria-label="Command results">
          {commands.length ? (
            commands.map((command, index) => (
              <button
                className={`commandPaletteItem ${index === selectedIndex ? "commandPaletteItemActive" : ""}`}
                key={`${command.name}-${index}`}
                type="button"
                role="option"
                aria-selected={index === selectedIndex}
                onMouseEnter={() => onSelectedIndexChange(index)}
                onClick={() => onRun(command)}
              >
                <span className="commandPaletteItemIcon">
                  {command.workspace ? <LayoutGrid size={16} /> : <Terminal size={16} />}
                </span>
                <span className="commandPaletteItemMain">
                  <span className="commandPaletteItemTitle">{command.name}</span>
                  <span className="commandPaletteItemDescription">
                    {command.description ?? command.command ?? command.workspace?.name ?? "项目自定义命令"}
                  </span>
                </span>
                <span className="commandPaletteItemMeta">{getCommandTypeLabel(command)}</span>
              </button>
            ))
          ) : (
            <div className="commandPaletteEmpty">没有匹配的项目命令</div>
          )}
        </div>
      </section>
    </div>
  );
}

function WorkspaceSidebar({
  workspaces,
  activeWorkspaceId,
  editingWorkspaceId,
  workspaceNameDraft,
  onSelect,
  onCreate,
  onStartRename,
  onRenameDraftChange,
  onCommitRename,
  onCancelRename,
  onClose,
  onClearStatus,
  onOpenCommandPalette,
  settingsOpen,
  notificationsOpen,
  securityModeDraft,
  securitySettings,
  onToggleNotifications,
  onToggleSettings,
  onSecurityModeDraftChange,
  onSaveSecurityMode
}: {
  workspaces: Workspace[];
  activeWorkspaceId: string;
  editingWorkspaceId: string | null;
  workspaceNameDraft: string;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onStartRename: (workspace: Workspace) => void;
  onRenameDraftChange: (value: string) => void;
  onCommitRename: () => void;
  onCancelRename: () => void;
  onClose: (id: string) => void;
  onClearStatus: (id: string) => void;
  onOpenCommandPalette: () => void;
  settingsOpen: boolean;
  notificationsOpen: boolean;
  securityModeDraft: SocketSecurityMode;
  securitySettings: SocketSecuritySettings | null;
  onToggleNotifications: () => void;
  onToggleSettings: () => void;
  onSecurityModeDraftChange: (mode: SocketSecurityMode) => void;
  onSaveSecurityMode: () => void;
}): ReactElement {
  const notificationItems = workspaces.filter((workspace) => Boolean(workspace.notice));

  return (
    <aside className="sidebar">
      <div className="brandRow">
        <div className="brandMark">
          <LayoutGrid size={17} />
        </div>
        <div>
          <div className="brandName">wmux</div>
          <div className="brandSub">agent workspace</div>
        </div>
      </div>

      <button className="searchButton" type="button" onClick={onOpenCommandPalette}>
        <Search size={15} />
        <span>Search workspace</span>
        <kbd>⌘K</kbd>
      </button>

      <div className="sidebarSectionHeader">
        <span>Workspaces</span>
        <button className="iconButton" type="button" aria-label="New workspace" onClick={onCreate}>
          <Plus size={15} />
        </button>
      </div>

      <div className="workspaceList">
        {workspaces.map((workspace) => {
          const isEditing = workspace.id === editingWorkspaceId;
          return (
            <div
              className={`workspaceItem ${workspace.id === activeWorkspaceId ? "workspaceItemActive" : ""}`}
              key={workspace.id}
            >
              {isEditing ? (
                <div className="workspaceSelect">
                  <span className={`statusRing ${statusClass[workspace.status]}`} />
                  <span className="workspaceMain">
                    <span className="workspaceTitleRow">
                      <input
                        className="workspaceNameInput"
                        aria-label="Workspace name"
                        value={workspaceNameDraft}
                        autoFocus
                        onChange={(event) => onRenameDraftChange(event.target.value)}
                        onKeyDown={(event) => {
                          event.stopPropagation();
                          if (event.key === "Enter") {
                            event.preventDefault();
                            onCommitRename();
                          }
                          if (event.key === "Escape") {
                            event.preventDefault();
                            onCancelRename();
                          }
                        }}
                      />
                      <span className="workspaceStatus">{statusLabels[workspace.status]}</span>
                    </span>
                    <span className="workspacePath">{workspace.cwd}</span>
                    <span className="workspaceMeta">
                      {workspace.branch && (
                        <span className="metaPill">
                          <GitBranch size={12} />
                          {workspace.branch}
                        </span>
                      )}
                      {workspace.ports.map((port) => (
                        <span className="metaPill" key={port}>
                          :{port}
                        </span>
                      ))}
                    </span>
                    {workspace.notice && <span className="workspaceNotice">{workspace.notice}</span>}
                  </span>
                </div>
              ) : (
                <button
                  className="workspaceSelect"
                  type="button"
                  aria-label={`Open workspace ${workspace.name}`}
                  onClick={() => onSelect(workspace.id)}
                  onDoubleClick={() => onStartRename(workspace)}
                  onKeyDown={(event) => {
                    if (event.key === "F2") {
                      event.preventDefault();
                      onStartRename(workspace);
                    }
                  }}
                >
                <span className={`statusRing ${statusClass[workspace.status]}`} />
                <span className="workspaceMain">
                  <span className="workspaceTitleRow">
                    <span className="workspaceName">{workspace.name}</span>
                    <span className="workspaceStatus">{statusLabels[workspace.status]}</span>
                  </span>
                  <span className="workspacePath">{workspace.cwd}</span>
                  <span className="workspaceMeta">
                    {workspace.branch && (
                      <span className="metaPill">
                        <GitBranch size={12} />
                        {workspace.branch}
                      </span>
                    )}
                    {workspace.ports.map((port) => (
                      <span className="metaPill" key={port}>
                        :{port}
                      </span>
                    ))}
                  </span>
                  {workspace.notice && <span className="workspaceNotice">{workspace.notice}</span>}
                </span>
                </button>
              )}
              <div className="workspaceActions">
                <button
                  className="workspaceActionButton"
                  type="button"
                  aria-label={`Rename workspace ${workspace.name}`}
                  title={`Rename ${workspace.name}`}
                  onMouseDown={(event) => {
                    event.stopPropagation();
                    onStartRename(workspace);
                  }}
                  onClick={(event) => {
                    event.stopPropagation();
                    onStartRename(workspace);
                  }}
                >
                  <Pencil size={13} />
                </button>
                <button
                  className="workspaceActionButton"
                  type="button"
                  aria-label={`Close workspace ${workspace.name}`}
                  title={`Close ${workspace.name}`}
                  disabled={workspaces.length <= 1}
                  onClick={(event) => {
                    event.stopPropagation();
                    onClose(workspace.id);
                  }}
                >
                  <X size={14} />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="sidebarFooter">
        <button
          className="utilityButton"
          type="button"
          aria-expanded={notificationsOpen}
          onClick={onToggleNotifications}
        >
          <Bell size={15} />
          <span>Notifications</span>
          <span className="utilityCount">{notificationItems.length}</span>
        </button>
        {notificationsOpen && (
          <div className="notificationPanel" aria-label="Notifications panel">
            {notificationItems.length ? (
              notificationItems.map((workspace) => (
                <div
                  className="notificationItem"
                  key={workspace.id}
                >
                  <span className={`statusRing ${statusClass[workspace.status]}`} />
                  <span className="notificationMain">
                    <span className="notificationTitleRow">
                      <span className="notificationWorkspace">{workspace.name}</span>
                      <span className="notificationStatus">{statusLabels[workspace.status]}</span>
                    </span>
                    <span className="notificationText">{workspace.notice}</span>
                  </span>
                  <button
                    className="notificationOpenButton"
                    type="button"
                    onClick={() => onSelect(workspace.id)}
                  >
                    Open
                  </button>
                  <button
                    className="notificationClearButton"
                    type="button"
                    aria-label={`Clear notification ${workspace.name}`}
                    onClick={() => onClearStatus(workspace.id)}
                  >
                    Clear
                  </button>
                </div>
              ))
            ) : (
              <div className="notificationEmpty">No workspace notifications</div>
            )}
          </div>
        )}
        <button className="utilityButton" type="button" aria-expanded={settingsOpen} onClick={onToggleSettings}>
          <Settings size={15} />
          <span>Settings</span>
        </button>
        {settingsOpen && (
          <div className="settingsPanel" aria-label="Settings panel">
            <label className="settingsField">
              <span>Socket security</span>
              <select
                aria-label="Socket security mode"
                value={securityModeDraft}
                onChange={(event) => onSecurityModeDraftChange(event.target.value as SocketSecurityMode)}
              >
                {socketSecurityModes.map((mode) => (
                  <option key={mode} value={mode}>
                    {socketSecurityModeLabels[mode]}
                  </option>
                ))}
              </select>
            </label>
            <div className="settingsMeta">
              Active: {socketSecurityModeLabels[securitySettings?.activeMode ?? "wmuxOnly"]}
              {securitySettings?.pendingRestart ? " / restart required" : ""}
            </div>
            {securityModeDraft === "allowAll" && (
              <div className="settingsWarning">allowAll accepts local socket requests without token.</div>
            )}
            <button className="utilityButton settingsSaveButton" type="button" onClick={onSaveSecurityMode}>
              Save
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}

function TitleBar({
  workspace,
  version,
  shellProfile,
  shellOptions,
  onShellProfileChange,
  onAddTerminal,
  onAddBrowser,
  onSplitHorizontal,
  onSplitVertical,
  onOpenCommandPalette
}: {
  workspace: Workspace;
  version: string;
  shellProfile: ShellProfile;
  shellOptions: ShellProfileOption[];
  onShellProfileChange: (profile: ShellProfile) => void;
  onAddTerminal: () => void;
  onAddBrowser: () => void;
  onSplitHorizontal: () => void;
  onSplitVertical: () => void;
  onOpenCommandPalette: () => void;
}): ReactElement {
  return (
    <header className="titleBar">
      <div className="trafficSpacer" />
      <div className="titleIdentity">
        <span className={`statusDot ${statusClass[workspace.status]}`} />
        <div>
          <h1>{workspace.name}</h1>
          <p>{workspace.cwd}</p>
        </div>
      </div>
      <div className="titleActions">
        <button className="commandButton" type="button" onClick={onOpenCommandPalette}>
          <Command size={15} />
          <span>Command</span>
        </button>
        <button className="toolbarButton" type="button" aria-label="Split horizontally" onClick={onSplitHorizontal}>
          <SplitSquareHorizontal size={15} />
          <span>Split</span>
        </button>
        <button className="toolbarButton" type="button" aria-label="Split vertically" onClick={onSplitVertical}>
          <SplitSquareVertical size={15} />
        </button>
        <button className="toolbarButton" type="button" onClick={onAddTerminal}>
          <Terminal size={15} />
          <span>Terminal</span>
        </button>
        <button className="toolbarButton" type="button" aria-label="Browser" onClick={onAddBrowser}>
          <Globe size={15} />
          <span>Browser</span>
        </button>
        <label className="shellSelectLabel">
          <Terminal size={14} />
          <select
            aria-label="Terminal shell"
            value={shellProfile}
            onChange={(event) => onShellProfileChange(event.target.value as ShellProfile)}
          >
            {shellOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <span className="versionText">v{version}</span>
      </div>
    </header>
  );
}

function LayoutRenderer({
  workspace,
  node,
  shellProfile,
  onAddTerminalSurface,
  onSelectSurface,
  onCloseSurface,
  onActivatePane,
  onResizeSplit,
  onClosePane,
  onDropSurfaceToPane,
  onUpdateSurfaceSubtitle,
  onOpenTerminalUrl
}: {
  workspace: Workspace;
  node: LayoutNode;
  shellProfile: ShellProfile;
  onAddTerminalSurface: (paneId: string) => void;
  onSelectSurface: (paneId: string, surfaceId: string) => void;
  onCloseSurface: (paneId: string, surfaceId: string) => void;
  onActivatePane: (paneId: string) => void;
  onResizeSplit: (splitId: string, ratio: number) => void;
  onClosePane: (paneId: string) => void;
  onDropSurfaceToPane: (targetPaneId: string, edge: SplitDropEdge, payload: DraggedSurfacePayload) => void;
  onUpdateSurfaceSubtitle: (surfaceId: string, subtitle: string) => void;
  onOpenTerminalUrl: (url: string) => void;
}): ReactElement {
  if (node.type === "pane") {
    return (
      <PaneView
        workspace={workspace}
        paneId={node.id}
        shellProfile={shellProfile}
        onAddTerminalSurface={onAddTerminalSurface}
        onSelectSurface={onSelectSurface}
        onCloseSurface={onCloseSurface}
        onActivatePane={onActivatePane}
        onClosePane={onClosePane}
        onDropSurfaceToPane={onDropSurfaceToPane}
        onUpdateSurfaceSubtitle={onUpdateSurfaceSubtitle}
        onOpenTerminalUrl={onOpenTerminalUrl}
      />
    );
  }

  return (
    <div
      className={`split split-${node.direction}`}
      style={
        {
          "--split-ratio": `${node.ratio * 100}%`
        } as React.CSSProperties
      }
    >
      <LayoutRenderer
        workspace={workspace}
        node={node.children[0]}
        shellProfile={shellProfile}
        onAddTerminalSurface={onAddTerminalSurface}
        onSelectSurface={onSelectSurface}
        onCloseSurface={onCloseSurface}
        onActivatePane={onActivatePane}
        onResizeSplit={onResizeSplit}
        onClosePane={onClosePane}
        onDropSurfaceToPane={onDropSurfaceToPane}
        onUpdateSurfaceSubtitle={onUpdateSurfaceSubtitle}
        onOpenTerminalUrl={onOpenTerminalUrl}
      />
      <SplitHandle node={node} onResizeSplit={onResizeSplit} />
      <LayoutRenderer
        workspace={workspace}
        node={node.children[1]}
        shellProfile={shellProfile}
        onAddTerminalSurface={onAddTerminalSurface}
        onSelectSurface={onSelectSurface}
        onCloseSurface={onCloseSurface}
        onActivatePane={onActivatePane}
        onResizeSplit={onResizeSplit}
        onClosePane={onClosePane}
        onDropSurfaceToPane={onDropSurfaceToPane}
        onUpdateSurfaceSubtitle={onUpdateSurfaceSubtitle}
        onOpenTerminalUrl={onOpenTerminalUrl}
      />
    </div>
  );
}

function SplitHandle({
  node,
  onResizeSplit
}: {
  node: Extract<LayoutNode, { type: "split" }>;
  onResizeSplit: (splitId: string, ratio: number) => void;
}): ReactElement {
  const handlePointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    event.preventDefault();
    const splitElement = event.currentTarget.parentElement;
    if (!splitElement) {
      return;
    }

    const rect = splitElement.getBoundingClientRect();
    const pointerId = event.pointerId;
    event.currentTarget.setPointerCapture(pointerId);

    const handlePointerMove = (moveEvent: globalThis.PointerEvent): void => {
      const ratio =
        node.direction === "horizontal"
          ? (moveEvent.clientX - rect.left) / Math.max(1, rect.width)
          : (moveEvent.clientY - rect.top) / Math.max(1, rect.height);
      onResizeSplit(node.id, ratio);
    };

    const handlePointerUp = (): void => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp, { once: true });
  };

  return (
    <div
      className="splitHandle"
      role="separator"
      aria-label={`Resize ${node.direction} split`}
      aria-orientation={node.direction === "horizontal" ? "vertical" : "horizontal"}
      onPointerDown={handlePointerDown}
    />
  );
}

function PaneView({
  workspace,
  paneId,
  shellProfile,
  onAddTerminalSurface,
  onSelectSurface,
  onCloseSurface,
  onActivatePane,
  onClosePane,
  onDropSurfaceToPane,
  onUpdateSurfaceSubtitle,
  onOpenTerminalUrl
}: {
  workspace: Workspace;
  paneId: string;
  shellProfile: ShellProfile;
  onAddTerminalSurface: (paneId: string) => void;
  onSelectSurface: (paneId: string, surfaceId: string) => void;
  onCloseSurface: (paneId: string, surfaceId: string) => void;
  onActivatePane: (paneId: string) => void;
  onClosePane: (paneId: string) => void;
  onDropSurfaceToPane: (targetPaneId: string, edge: SplitDropEdge, payload: DraggedSurfacePayload) => void;
  onUpdateSurfaceSubtitle: (surfaceId: string, subtitle: string) => void;
  onOpenTerminalUrl: (url: string) => void;
}): ReactElement {
  const pane = workspace.panes[paneId];
  const surfaces = pane.surfaceIds.map((id) => workspace.surfaces[id]);
  const activeSurface = workspace.surfaces[pane.activeSurfaceId];
  const [dropEdge, setDropEdge] = useState<SplitDropEdge | null>(null);

  const handleDragOver = (event: DragEvent<HTMLElement>): void => {
    if (!event.dataTransfer.types.includes("application/x-wmux-surface")) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDropEdge(getDropEdge(event.currentTarget.getBoundingClientRect(), event.clientX, event.clientY));
  };

  const handleDrop = (event: DragEvent<HTMLElement>): void => {
    const payload = readDraggedSurfacePayload(event);
    if (!payload || !dropEdge) {
      setDropEdge(null);
      return;
    }

    event.preventDefault();
    onDropSurfaceToPane(paneId, dropEdge, payload);
    setDropEdge(null);
  };

  return (
    <section
      className={`pane ${workspace.activePaneId === paneId ? "paneActive" : ""} ${
        dropEdge ? `paneDrop paneDrop-${dropEdge}` : ""
      }`}
      aria-label={`Pane ${paneId}`}
      onMouseDown={() => onActivatePane(paneId)}
      onDragOver={handleDragOver}
      onDragLeave={() => setDropEdge(null)}
      onDrop={handleDrop}
    >
      <SurfaceTabs
        surfaces={surfaces}
        activeSurfaceId={activeSurface.id}
        canClose={surfaces.length > 1}
        onAdd={() => onAddTerminalSurface(paneId)}
        onSelect={(surfaceId) => {
          onActivatePane(paneId);
          onSelectSurface(paneId, surfaceId);
        }}
        onClose={(surfaceId) => onCloseSurface(paneId, surfaceId)}
        onClosePane={() => onClosePane(paneId)}
        onDragSurfaceStart={(surfaceId, event) => {
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("application/x-wmux-surface", JSON.stringify({ paneId, surfaceId }));
          event.dataTransfer.setData("text/plain", surfaceId);
        }}
      />
      <div className="surfaceBodyStack">
        {surfaces.map((surface) => (
          <div
            className={`surfaceBodyFrame ${surface.id === activeSurface.id ? "surfaceBodyFrameActive" : ""}`}
            key={surface.id}
          >
            <SurfaceBody
              surface={surface}
              cwd={workspace.cwd}
              shellProfile={shellProfile}
              onUpdateSurfaceSubtitle={onUpdateSurfaceSubtitle}
              onOpenTerminalUrl={onOpenTerminalUrl}
            />
          </div>
        ))}
      </div>
    </section>
  );
}

function SurfaceTabs({
  surfaces,
  activeSurfaceId,
  canClose,
  onAdd,
  onSelect,
  onClose,
  onClosePane,
  onDragSurfaceStart
}: {
  surfaces: Surface[];
  activeSurfaceId: string;
  canClose: boolean;
  onAdd: () => void;
  onSelect: (surfaceId: string) => void;
  onClose: (surfaceId: string) => void;
  onClosePane: () => void;
  onDragSurfaceStart: (surfaceId: string, event: DragEvent<HTMLButtonElement>) => void;
}): ReactElement {
  return (
    <div className="surfaceTabs">
      {surfaces.map((surface) => {
        const Icon = surface.type === "browser" ? Globe : Terminal;
        return (
          <button
            className={`surfaceTab ${surface.id === activeSurfaceId ? "surfaceTabActive" : ""}`}
            key={surface.id}
            type="button"
            aria-label={surface.name}
            draggable
            title={`Drag ${surface.name} to split`}
            onDragStart={(event) => onDragSurfaceStart(surface.id, event)}
            onClick={() => onSelect(surface.id)}
          >
            <Icon size={14} />
            <span className={`tabStatus ${statusClass[surface.status]}`} />
            <span>{surface.name}</span>
            {canClose && (
              <span
                className="tabCloseButton"
                role="button"
                tabIndex={0}
                aria-label={`Close ${surface.name}`}
                title={`Close ${surface.name}`}
                onClick={(event) => {
                  event.stopPropagation();
                  onClose(surface.id);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    event.stopPropagation();
                    onClose(surface.id);
                  }
                }}
              >
                <X className="tabClose" size={13} aria-hidden="true" />
              </span>
            )}
          </button>
        );
      })}
      <button className="surfaceAdd" type="button" aria-label="Add terminal surface" onClick={onAdd}>
        <Plus size={14} />
      </button>
      <button className="paneCloseButton" type="button" aria-label="Close pane" title="Close pane" onClick={onClosePane}>
        <X size={14} />
      </button>
    </div>
  );
}

function SurfaceBody({
  surface,
  cwd,
  shellProfile,
  onUpdateSurfaceSubtitle,
  onOpenTerminalUrl
}: {
  surface: Surface;
  cwd: string;
  shellProfile: ShellProfile;
  onUpdateSurfaceSubtitle: (surfaceId: string, subtitle: string) => void;
  onOpenTerminalUrl: (url: string) => void;
}): ReactElement {
  if (surface.type === "browser") {
    return <BrowserSurface surface={surface} onUpdateSurfaceSubtitle={onUpdateSurfaceSubtitle} />;
  }

  return <TerminalSurface surface={surface} cwd={cwd} shell={shellProfile} onOpenUrl={onOpenTerminalUrl} />;
}

function normalizeBrowserUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "about:blank";
  }

  if (/^(about:|data:|file:|https?:)/i.test(trimmed)) {
    return trimmed;
  }

  if (trimmed.includes(".") || trimmed.includes("localhost")) {
    return `https://${trimmed}`;
  }

  return `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`;
}

function getBrowserAutoZoomFactor(viewportWidth: number): number {
  if (viewportWidth >= 960) {
    return 1;
  }

  return Math.max(0.55, Math.min(1, viewportWidth / 980));
}

function BrowserSurface({
  surface,
  onUpdateSurfaceSubtitle
}: {
  surface: Surface;
  onUpdateSurfaceSubtitle: (surfaceId: string, subtitle: string) => void;
}): ReactElement {
  const initialUrl = normalizeBrowserUrl(surface.subtitle ?? "https://example.com");
  const session = browserSessions.get(surface.id) ?? { history: [initialUrl], historyIndex: 0, url: initialUrl };
  const webviewRef = useRef<BrowserWebviewElement | null>(null);
  const webviewReadyRef = useRef(false);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const browserHistoryRef = useRef(session.history);
  const browserHistoryIndexRef = useRef(session.historyIndex);
  const desiredUrlRef = useRef(session.url);
  const [url, setUrl] = useState(session.url);
  const [draftUrl, setDraftUrl] = useState(session.url);
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);
  const [viewportSize, setViewportSize] = useState<{ width: number; height: number } | null>(null);

  const applyBrowserZoom = useCallback((): void => {
    if (!webviewReadyRef.current) {
      return;
    }

    const viewportWidth = viewportRef.current?.getBoundingClientRect().width ?? viewportSize?.width ?? 960;
    try {
      webviewRef.current?.setZoomFactor?.(getBrowserAutoZoomFactor(viewportWidth));
    } catch {
      webviewReadyRef.current = false;
    }
  }, [viewportSize?.width]);

  const persistBrowserSession = useCallback((nextUrl: string): void => {
    browserSessions.set(surface.id, {
      history: browserHistoryRef.current,
      historyIndex: browserHistoryIndexRef.current,
      url: nextUrl
    });
  }, [surface.id]);

  useEffect(() => {
    const webview = webviewRef.current;
    if (!webview) {
      return;
    }

    const handleDomReady = (): void => {
      webviewReadyRef.current = true;
      applyBrowserZoom();
    };

    const syncNavigationState = (): void => {
      const nextUrl = webview.getURL?.() || url;
      if (nextUrl === "about:blank" && desiredUrlRef.current !== "about:blank") {
        return;
      }

      const hasLocalBack = browserHistoryIndexRef.current > 0;
      const hasLocalForward = browserHistoryIndexRef.current < browserHistoryRef.current.length - 1;
      desiredUrlRef.current = nextUrl;
      setUrl(nextUrl);
      setDraftUrl(nextUrl);
      setCanGoBack(Boolean(webview.canGoBack?.()) || hasLocalBack);
      setCanGoForward(Boolean(webview.canGoForward?.()) || hasLocalForward);
      persistBrowserSession(nextUrl);
      onUpdateSurfaceSubtitle(surface.id, nextUrl);
      applyBrowserZoom();
    };

    webview.addEventListener("dom-ready", handleDomReady);
    webview.addEventListener("did-navigate", syncNavigationState);
    webview.addEventListener("did-navigate-in-page", syncNavigationState);
    webview.addEventListener("did-finish-load", syncNavigationState);

    return () => {
      webviewReadyRef.current = false;
      webview.removeEventListener("dom-ready", handleDomReady);
      webview.removeEventListener("did-navigate", syncNavigationState);
      webview.removeEventListener("did-navigate-in-page", syncNavigationState);
      webview.removeEventListener("did-finish-load", syncNavigationState);
    };
  }, [applyBrowserZoom, onUpdateSurfaceSubtitle, persistBrowserSession, surface.id, url]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) {
      return;
    }

    const updateViewportSize = (): void => {
      const rect = viewport.getBoundingClientRect();
      setViewportSize({
        width: Math.max(1, Math.floor(rect.width)),
        height: Math.max(1, Math.floor(rect.height))
      });
    };

    const resizeObserver = new ResizeObserver(updateViewportSize);
    resizeObserver.observe(viewport);
    updateViewportSize();

    return () => {
      resizeObserver.disconnect();
    };
  }, []);

  useEffect(() => {
    applyBrowserZoom();
  }, [applyBrowserZoom, viewportSize?.width, url]);

  const navigate = useCallback(
    (nextUrl: string): void => {
      const normalizedUrl = normalizeBrowserUrl(nextUrl);
      const nextHistory = browserHistoryRef.current.slice(0, browserHistoryIndexRef.current + 1);
      if (nextHistory[nextHistory.length - 1] !== normalizedUrl) {
        nextHistory.push(normalizedUrl);
      }
      browserHistoryRef.current = nextHistory;
      browserHistoryIndexRef.current = nextHistory.length - 1;
      desiredUrlRef.current = normalizedUrl;
      setUrl(normalizedUrl);
      setDraftUrl(normalizedUrl);
      setCanGoBack(browserHistoryIndexRef.current > 0);
      setCanGoForward(false);
      persistBrowserSession(normalizedUrl);
      onUpdateSurfaceSubtitle(surface.id, normalizedUrl);
      const currentUrl = webviewRef.current?.getURL?.();
      if (currentUrl !== normalizedUrl) {
        webviewRef.current?.loadURL?.(normalizedUrl);
      }
    },
    [onUpdateSurfaceSubtitle, persistBrowserSession, surface.id]
  );

  const navigateBrowserRuntime = useCallback(
    (nextUrl: string, waitUntil: BrowserWaitUntil, timeoutMs: number): Promise<string> => {
      const normalizedUrl = normalizeBrowserUrl(nextUrl);
      return new Promise((resolve, reject) => {
        const webview = webviewRef.current;
        if (!webview?.loadURL) {
          reject(createBrowserError("BROWSER_ERROR", "browser webview 尚未就绪", { surfaceId: surface.id }));
          return;
        }

        let settled = false;
        const cleanup = (): void => {
          webview.removeEventListener("did-fail-load", handleFailLoad);
          webview.removeEventListener("did-finish-load", handleLoad);
          webview.removeEventListener("dom-ready", handleDomContentLoaded);
          window.clearTimeout(timer);
        };
        const settle = (callback: () => void): void => {
          if (settled) {
            return;
          }
          settled = true;
          cleanup();
          callback();
        };
        const handleFailLoad = (event: Event): void => {
          const failure = event as BrowserLoadFailureEvent;
          if (isIgnorableBrowserLoadFailure(failure, normalizedUrl)) {
            return;
          }
          settle(() =>
            reject(
              createBrowserError("BROWSER_ERROR", failure.errorDescription || "browser navigation failed", {
                surfaceId: surface.id,
                url: normalizedUrl
              })
            )
          );
        };
        const handleDomContentLoaded = (): void => {
          if (waitUntil === "domcontentloaded") {
            settle(() => resolve(webview.getURL?.() ?? normalizedUrl));
          }
        };
        const handleLoad = (): void => {
          if (waitUntil === "load") {
            settle(() => resolve(webview.getURL?.() ?? normalizedUrl));
          }
        };
        const timer = window.setTimeout(() => {
          settle(() =>
            reject(
              createBrowserError("TIMEOUT", "browser navigation timeout", {
                surfaceId: surface.id,
                url: normalizedUrl,
                timeoutMs
              })
            )
          );
        }, timeoutMs);

        webview.addEventListener("did-fail-load", handleFailLoad);
        webview.addEventListener("did-finish-load", handleLoad);
        webview.addEventListener("dom-ready", handleDomContentLoaded);
        navigate(normalizedUrl);
        if (waitUntil === "none") {
          window.setTimeout(() => settle(() => resolve(normalizedUrl)), 0);
        }
      });
    },
    [navigate, surface.id]
  );

  useEffect(() => {
    const webview = webviewRef.current;
    if (!webview) {
      return;
    }

    browserRuntimes.set(surface.id, {
      surfaceId: surface.id,
      runtimeId: surface.id,
      webview,
      navigate: navigateBrowserRuntime
    });

    return () => {
      const currentRuntime = browserRuntimes.get(surface.id);
      if (currentRuntime?.webview === webview) {
        browserRuntimes.delete(surface.id);
      }
    };
  }, [navigateBrowserRuntime, surface.id]);

  const loadHistoryEntry = (index: number): void => {
    const nextUrl = browserHistoryRef.current[index];
    if (!nextUrl) {
      return;
    }

    browserHistoryIndexRef.current = index;
    desiredUrlRef.current = nextUrl;
    setUrl(nextUrl);
    setDraftUrl(nextUrl);
    setCanGoBack(index > 0 || Boolean(webviewRef.current?.canGoBack?.()));
    setCanGoForward(index < browserHistoryRef.current.length - 1 || Boolean(webviewRef.current?.canGoForward?.()));
    persistBrowserSession(nextUrl);
    onUpdateSurfaceSubtitle(surface.id, nextUrl);
    webviewRef.current?.loadURL?.(nextUrl);
  };

  const handleBack = (): void => {
    if (browserHistoryIndexRef.current > 0) {
      loadHistoryEntry(browserHistoryIndexRef.current - 1);
      return;
    }

    webviewRef.current?.goBack?.();
  };

  const handleForward = (): void => {
    if (browserHistoryIndexRef.current < browserHistoryRef.current.length - 1) {
      loadHistoryEntry(browserHistoryIndexRef.current + 1);
      return;
    }

    webviewRef.current?.goForward?.();
  };

  const handleSubmit = (event: FormEvent): void => {
    event.preventDefault();
    navigate(draftUrl);
  };

  return (
    <div className="browserSurface">
      <form className="browserToolbar" onSubmit={handleSubmit}>
        <button
          className="iconButton"
          type="button"
          aria-label="Back"
          disabled={!canGoBack}
          onClick={handleBack}
        >
          <ChevronLeft size={15} />
        </button>
        <button
          className="iconButton"
          type="button"
          aria-label="Forward"
          disabled={!canGoForward}
          onClick={handleForward}
        >
          <ChevronRight size={15} />
        </button>
        <button className="iconButton" type="button" aria-label="Reload" onClick={() => webviewRef.current?.reload?.()}>
          <RefreshCw size={14} />
        </button>
        <label className="addressField">
          <Globe size={14} />
          <input
            aria-label="Browser address"
            value={draftUrl}
            onChange={(event) => setDraftUrl(event.target.value)}
            onFocus={(event) => event.currentTarget.select()}
          />
        </label>
        <button className="iconButton" type="button" aria-label="Open externally" onClick={() => window.open(url)}>
          <ExternalLink size={14} />
        </button>
      </form>
      <div className="browserViewport" ref={viewportRef}>
        {createElement("webview", {
          ref: webviewRef,
          className: "browserWebview",
          src: url,
          allowpopups: "false",
          partition: `persist:${surface.id}`,
          style: viewportSize
            ? {
                width: `${viewportSize.width}px`,
                height: `${viewportSize.height}px`
              }
            : undefined
        })}
      </div>
    </div>
  );
}

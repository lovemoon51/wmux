import {
  Bell,
  Activity,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Command,
  ExternalLink,
  GitBranch,
  GitPullRequest,
  Globe,
  LayoutGrid,
  Pencil,
  Plus,
  RefreshCw,
  ScrollText,
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
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent,
  type ReactElement
} from "react";
import type { SearchAddon } from "@xterm/addon-search";
import type {
  AppUpdateStatus,
  AiSettings,
  AiStreamEvent,
  BrowserClickParams,
  BrowserConsoleEntry,
  BrowserStorageArea,
  BrowserStorageEntry,
  BrowserStorageGetParams,
  BrowserStorageListParams,
  BrowserStorageSetParams,
  BrowserEvalParams,
  BrowserFillParams,
  BrowserNavigateParams,
  BrowserPressParams,
  BrowserRpcMethod,
  BrowserScreenshotParams,
  BrowserSelectorWait,
  BrowserSurfaceSummary,
  BrowserSnapshotNode,
  BrowserSnapshotParams,
  BrowserSurfaceSelector,
  BrowserTypeParams,
  BrowserWaitParams,
  BrowserWaitUntil,
  ClearStatusParams,
  LayoutNode,
  NotifyParams,
  PersistedAppState,
  PullRequestSummary,
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
  Block,
  BlockEvent,
  BlockGetParams,
  BlockListParams,
  BlockRerunParams,
  PaletteCommand,
  PaletteOpenParams,
  PaletteRunParams,
  Pane,
  StatusListParams,
  StatusSetParams,
  Surface,
  SurfaceCreateBrowserParams,
  SurfaceCreateNotebookParams,
  SurfaceCreateTerminalParams,
  SurfaceFocusParams,
  SurfaceListParams,
  SurfaceSplitParams,
  SurfaceSummary,
  WmuxCommandConfig,
  WmuxLayoutConfig,
  WmuxProjectConfigResult,
  WmuxSurfaceConfig,
  Workspace,
  WorkspaceCloseParams,
  WorkspaceCreateParams,
  WorkspaceInspection,
  WorkspaceListParams,
  WorkspaceRenameParams,
  WorkspaceSelectParams,
  WorkspaceStatus,
  WorkspaceSummary,
  TerminalNotificationPayload
} from "@shared/types";
import {
  rankPaletteCommands,
  recordRecentCommandUsage,
  type PaletteRecentUsageStore
} from "./lib/commandRegistry";
import { searchBlockHistory } from "./lib/blockHistorySearch";
import { getWorkspaceUnreadCount } from "./lib/workspaceUnread";
import { detectTerminalAttentionPrompt } from "./lib/terminalAttention";
import { createNotebookSurface } from "./lib/notebookSurface";
import {
  isWorkspaceStatus,
  statusClass,
  statusLabels,
  withWorkspaceStatusEvent
} from "./lib/workspaceStatusEvents";
import { TerminalSurface, setTerminalSearchHandlers, writeTerminalInputDraft } from "./components/TerminalSurface";
import { NotebookSurface } from "./components/NotebookSurface";
import { TerminalStatusBar, type TerminalStatusBarProps } from "./components/StatusBar";
import {
  createWorkflowArgDefaults,
  getWorkflowCommandTemplate,
  isWorkflowCommand,
  renderWorkflowCommand,
  validateWorkflowArgs
} from "./lib/workflowTemplate";
import { ArgsPromptDialog } from "./components/ArgsPromptDialog";
import { HistorySearch } from "./components/HistorySearch";
import { AiExplainPanel } from "./components/AiExplainPanel";
import { AiSettingsForm } from "./components/AiSettings";
import { ThemePicker } from "./components/ThemePicker";
import {
  applyThemeToDocument,
  builtInThemes,
  defaultThemeId,
  getThemeById,
  importThemesFromJson,
  mergeCustomThemes,
  normalizePersistedCustomThemes,
  serializeCustomThemes,
  type TerminalTheme,
  type ThemeImportResult,
  type WmuxTheme
} from "./lib/themes";

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

type BrowserConsoleMessageEvent = Event & {
  level?: unknown;
  message?: string;
  line?: number;
  sourceId?: string;
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
  waitForLoadState: (waitUntil: BrowserWaitUntil, timeoutMs: number) => Promise<string>;
  consoleEntries: BrowserConsoleEntry[];
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

type PendingProjectCommandConfirmation = {
  command: WmuxCommandConfig;
  reason: "trust" | "restart";
  existingWorkspaceId?: string;
};

type PendingWorkflowCommand = {
  command: WmuxCommandConfig;
  values: Record<string, string>;
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

type BlockSnapshot = Block & {
  surfaceName?: string;
  workspaceName?: string;
};

type AiExplainState = {
  requestId: string;
  block: BlockSnapshot;
  text: string;
  status: "streaming" | "done" | "error";
  error?: string;
};

type AiSuggestionState = {
  requestId: string;
  prompt: string;
  surfaceId: string;
  text: string;
  status: "streaming" | "done" | "error";
  error?: string;
};

const browserSessions = new Map<string, BrowserSessionState>();
const browserRuntimes = new Map<string, BrowserRuntime>();
const maxBrowserConsoleEntries = 200;

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

function createTerminalSurface(options: { name?: string; cwd?: string } = {}): Surface {
  const number = nextSurfaceNumber++;
  const cwd = options.cwd ? resolveWorkspaceCwd(options.cwd) : undefined;
  return {
    id: `surface-terminal-${Date.now()}-${number}`,
    type: "terminal",
    name: options.name?.trim() || `Terminal ${number}`,
    subtitle: cwd ?? "PowerShell",
    status: "idle"
  };
}

function createBrowserSurface(options: { name?: string; url?: string } = {}): Surface {
  const number = nextSurfaceNumber++;
  const url = options.url ? normalizeBrowserUrl(options.url) : "about:blank";
  return {
    id: `surface-browser-${Date.now()}-${number}`,
    type: "browser",
    name: options.name?.trim() || `Browser ${number}`,
    subtitle: url,
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

function createWorkspace(options: { name?: string; cwd?: string } = {}): Workspace {
  const number = nextWorkspaceNumber++;
  const workspaceId = `workspace-new-${Date.now()}-${number}`;
  const paneId = `${workspaceId}-pane-terminal`;
  const surfaceId = `${workspaceId}-surface-terminal`;
  const cwd = resolveWorkspaceCwd(options.cwd);

  return {
    id: workspaceId,
    name: options.name?.trim() || `Workspace ${number}`,
    cwd,
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

// 未读数 = recentEvents 中事件时间晚于 lastViewedAt 的条目数；缺 lastViewedAt 视为全部未读
// 注意：recentEvents 上限 maxWorkspaceStatusEvents（4），未读 badge 因此实际范围 0..4
// 实现已抽取到 src/renderer/src/lib/workspaceUnread.ts 以便单元测试

const socketSecurityModeLabels: Record<SocketSecurityMode, string> = {
  off: "Off",
  wmuxOnly: "wmuxOnly",
  token: "Token",
  allowAll: "allowAll"
};

const socketSecurityModes: SocketSecurityMode[] = ["wmuxOnly", "token", "off", "allowAll"];

const defaultAiSettings: AiSettings = {
  enabled: false,
  endpoint: "https://api.openai.com/v1",
  model: "gpt-4o-mini",
  redactSecrets: true,
  maxOutputBytes: 4096
};

const initialWorkspaces: Workspace[] = [
  {
    id: "workspace-api",
    name: "API Server",
    cwd: "D:/IdeaProject/codex/wmux",
    branch: "main",
    ports: [8787],
    status: "running",
    notice: "uvicorn ready on 8787",
    recentEvents: [
      {
        id: "event-api-ready",
        at: "2026-05-01T00:00:00.000Z",
        status: "running",
        message: "uvicorn ready on 8787"
      }
    ],
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

function getWorkspaceCommandIdentity(command: WmuxCommandConfig): { name: string; cwd: string } {
  return {
    name: command.workspace?.name?.trim() || command.name,
    cwd: resolveWorkspaceCwd(command.workspace?.cwd)
  };
}

function createConfiguredSurface(config: WmuxSurfaceConfig, fallbackName: string): Surface {
  const number = nextSurfaceNumber++;
  if (config.type === "notebook") {
    return createNotebookSurface({ number, name: config.name?.trim() || fallbackName, notebookId: config.notebookId });
  }

  const fallbackSubtitle =
    config.type === "terminal"
      ? "PowerShell"
      : (config.url ?? "about:blank");

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
        `${surfaceConfig.type === "browser" ? "Browser" : surfaceConfig.type === "notebook" ? "Notebook" : "Terminal"} ${
          surfaceIndex + 1
        }`
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

function getPaletteCategoryLabel(category: PaletteCommand["category"]): string {
  const labels: Record<PaletteCommand["category"], string> = {
    workspace: "Workspaces",
    surface: "Surfaces",
    project: "Project Commands",
    workflow: "Workflows",
    block: "Blocks",
    ai: "AI Suggestions",
    settings: "Settings"
  };
  return labels[category];
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

function findSurfaceById(workspaces: Workspace[], surfaceId: string): { workspace: Workspace; paneId: string; surface: Surface } | null {
  for (const workspace of workspaces) {
    const surface = workspace.surfaces[surfaceId];
    if (!surface) {
      continue;
    }

    const pane = Object.values(workspace.panes).find((item) => item.surfaceIds.includes(surface.id));
    if (pane) {
      return { workspace, paneId: pane.id, surface };
    }
  }

  return null;
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

function readAiSuggestions(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:[-*]|\d+\.)\s*/, "").replace(/^`{1,3}|`{1,3}$/g, "").trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"))
    .slice(0, 3);
}

const socketCapabilities: SocketRpcMethod[] = [
  "system.ping",
  "system.identify",
  "system.capabilities",
  "config.list",
  "palette.open",
  "palette.run",
  "workspace.list",
  "workspace.create",
  "workspace.select",
  "workspace.close",
  "workspace.rename",
  "surface.list",
  "surface.createTerminal",
  "surface.createBrowser",
  "surface.createNotebook",
  "surface.split",
  "surface.focus",
  "surface.sendText",
  "surface.sendKey",
  "status.notify",
  "status.set",
  "status.clear",
  "status.list",
  "block.list",
  "block.get",
  "block.rerun",
  "ai.explain",
  "ai.suggest",
  "browser.navigate",
  "browser.click",
  "browser.fill",
  "browser.type",
  "browser.press",
  "browser.wait",
  "browser.eval",
  "browser.snapshot",
  "browser.list",
  "browser.console.list",
  "browser.errors.list",
  "browser.cookies.list",
  "browser.storage.list",
  "browser.storage.get",
  "browser.storage.set",
  "browser.screenshot"
];

function isBrowserRpcMethod(method: string): method is BrowserRpcMethod {
  return (
    method === "browser.navigate" ||
    method === "browser.click" ||
    method === "browser.fill" ||
    method === "browser.type" ||
    method === "browser.press" ||
    method === "browser.wait" ||
    method === "browser.eval" ||
    method === "browser.snapshot" ||
    method === "browser.list" ||
    method === "browser.console.list" ||
    method === "browser.errors.list" ||
    method === "browser.cookies.list" ||
    method === "browser.storage.list" ||
    method === "browser.storage.get" ||
    method === "browser.storage.set" ||
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

function readBrowserWaitUntilOrNone(params: unknown): BrowserWaitUntil {
  if (isRecord(params) && (params.waitUntil === "none" || params.waitUntil === "domcontentloaded" || params.waitUntil === "load")) {
    return params.waitUntil;
  }

  return "none";
}

function readSelectorWait(params: unknown): BrowserSelectorWait {
  if (isRecord(params) && (params.wait === "visible" || params.wait === "attached" || params.wait === "none")) {
    return params.wait;
  }

  return "visible";
}

function readBrowserLogLimit(params: unknown): number {
  if (isRecord(params) && typeof params.limit === "number" && Number.isFinite(params.limit) && params.limit > 0) {
    return Math.min(Math.floor(params.limit), maxBrowserConsoleEntries);
  }

  return 50;
}

function normalizeBrowserConsoleLevel(level: unknown): BrowserConsoleEntry["level"] {
  if (level === "debug" || level === "info" || level === "log" || level === "warn" || level === "error") {
    return level;
  }
  if (level === "warning") {
    return "warn";
  }
  const numericLevel = typeof level === "number" ? level : typeof level === "string" ? Number(level) : Number.NaN;
  if (Number.isFinite(numericLevel)) {
    if (numericLevel === 1) {
      return "info";
    }
    if (numericLevel === 2) {
      return "warn";
    }
    if (numericLevel === 3) {
      return "error";
    }
  }

  return "log";
}

function appendBrowserConsoleEntry(runtime: BrowserRuntime, entry: Omit<BrowserConsoleEntry, "id" | "at">): void {
  runtime.consoleEntries.push({
    id: `browser-console-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    at: new Date().toISOString(),
    ...entry
  });
  if (runtime.consoleEntries.length > maxBrowserConsoleEntries) {
    runtime.consoleEntries.splice(0, runtime.consoleEntries.length - maxBrowserConsoleEntries);
  }
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

function getWaitForSelectorScript(selector: string, wait: BrowserSelectorWait, timeoutMs: number): string {
  return `(() => new Promise((resolve, reject) => {
    const selector = ${serializeForInjectedScript(selector)};
    const wait = ${serializeForInjectedScript(wait)};
    const timeoutMs = ${timeoutMs};
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
      resolve({ matched: matches.length, selector, url: location.href });
    };
    tick();
  }))()`;
}

function getKeyboardActionScript(
  action: "type" | "press",
  selector: string,
  wait: BrowserSelectorWait,
  timeoutMs: number,
  value: string
): string {
  return `(() => new Promise((resolve, reject) => {
    const selector = ${serializeForInjectedScript(selector)};
    const wait = ${serializeForInjectedScript(wait)};
    const timeoutMs = ${timeoutMs};
    const value = ${serializeForInjectedScript(value)};
    const action = ${serializeForInjectedScript(action)};
    const startedAt = Date.now();
    const isVisible = (element) => {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0;
    };
    const keyMap = {
      enter: { key: "Enter", code: "Enter" },
      tab: { key: "Tab", code: "Tab" },
      escape: { key: "Escape", code: "Escape" },
      esc: { key: "Escape", code: "Escape" },
      backspace: { key: "Backspace", code: "Backspace" },
      delete: { key: "Delete", code: "Delete" },
      arrowleft: { key: "ArrowLeft", code: "ArrowLeft" },
      left: { key: "ArrowLeft", code: "ArrowLeft" },
      arrowright: { key: "ArrowRight", code: "ArrowRight" },
      right: { key: "ArrowRight", code: "ArrowRight" },
      arrowup: { key: "ArrowUp", code: "ArrowUp" },
      up: { key: "ArrowUp", code: "ArrowUp" },
      arrowdown: { key: "ArrowDown", code: "ArrowDown" },
      down: { key: "ArrowDown", code: "ArrowDown" }
    };
    const editableValue = (element) =>
      element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement
        ? element.value
        : element.isContentEditable
          ? element.textContent ?? ""
          : "";
    const setEditableValue = (element, nextValue) => {
      if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
        element.value = nextValue;
        return true;
      }
      if (element.isContentEditable) {
        element.textContent = nextValue;
        return true;
      }
      return false;
    };
    const dispatchKey = (element, type, keyInfo) => {
      element.dispatchEvent(new KeyboardEvent(type, { bubbles: true, cancelable: true, key: keyInfo.key, code: keyInfo.code }));
    };
    const dispatchInput = (element, inputType, data) => {
      element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType, data }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
    };
    const pressKey = (element, rawKey) => {
      const keyInfo = keyMap[String(rawKey).trim().toLowerCase()] ?? { key: String(rawKey), code: String(rawKey) };
      dispatchKey(element, "keydown", keyInfo);
      if (keyInfo.key === "Backspace") {
        const current = editableValue(element);
        if (setEditableValue(element, current.slice(0, -1))) dispatchInput(element, "deleteContentBackward", null);
      } else if (keyInfo.key === "Delete") {
        const current = editableValue(element);
        if (setEditableValue(element, current.slice(1))) dispatchInput(element, "deleteContentForward", null);
      } else if (keyInfo.key === "Enter") {
        if (element instanceof HTMLTextAreaElement || element.isContentEditable) {
          const current = editableValue(element);
          if (setEditableValue(element, current + "\\n")) dispatchInput(element, "insertLineBreak", "\\n");
        } else if (element instanceof HTMLElement) {
          element.closest("form")?.requestSubmit?.();
        }
      } else if (keyInfo.key === "Tab" && element instanceof HTMLElement) {
        element.blur();
      } else if (keyInfo.key.length === 1) {
        const current = editableValue(element);
        if (setEditableValue(element, current + keyInfo.key)) dispatchInput(element, "insertText", keyInfo.key);
      }
      dispatchKey(element, "keyup", keyInfo);
      return keyInfo.key;
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
      if (!(element instanceof HTMLElement)) {
        reject(Object.assign(new Error("target is not an HTMLElement"), { code: "BAD_REQUEST" }));
        return;
      }
      element.focus();
      if (action === "type") {
        if (!setEditableValue(element, editableValue(element) + value)) {
          reject(Object.assign(new Error("target is not editable"), { code: "BAD_REQUEST" }));
          return;
        }
        dispatchInput(element, "insertText", value);
        resolve({ matched: matches.length, selector, typed: true, valueLength: value.length });
        return;
      }
      const key = pressKey(element, value);
      resolve({ matched: matches.length, selector, pressed: true, key });
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

function readBrowserStorageArea(params: unknown): BrowserStorageArea {
  const rawArea = isRecord(params) && typeof params.area === "string" ? params.area : "local";
  if (rawArea === "local" || rawArea === "session") {
    return rawArea;
  }
  throw createBrowserError("BAD_REQUEST", "browser storage area 必须是 local 或 session");
}

function getBrowserCookiesListScript(): string {
  return `(() => {
    const cookies = document.cookie
      ? document.cookie.split(";").map((item) => item.trim()).filter(Boolean)
      : [];
    return {
      url: location.href,
      cookies: cookies.map((item) => {
        const separator = item.indexOf("=");
        const rawName = separator >= 0 ? item.slice(0, separator) : item;
        const rawValue = separator >= 0 ? item.slice(separator + 1) : "";
        const decode = (value) => {
          try {
            return decodeURIComponent(value);
          } catch {
            return value;
          }
        };
        return {
          name: decode(rawName),
          value: decode(rawValue),
          url: location.href
        };
      })
    };
  })()`;
}

function getBrowserStorageListScript(area: BrowserStorageArea): string {
  return `(() => {
    const area = ${serializeForInjectedScript(area)};
    const storage = area === "session" ? window.sessionStorage : window.localStorage;
    const entries = [];
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key !== null) {
        entries.push({ key, value: storage.getItem(key) ?? "" });
      }
    }
    entries.sort((left, right) => left.key.localeCompare(right.key));
    return { url: location.href, area, entries };
  })()`;
}

function getBrowserStorageGetScript(area: BrowserStorageArea, key: string): string {
  return `(() => {
    const area = ${serializeForInjectedScript(area)};
    const key = ${serializeForInjectedScript(key)};
    const storage = area === "session" ? window.sessionStorage : window.localStorage;
    const value = storage.getItem(key);
    return { url: location.href, area, key, value, exists: value !== null };
  })()`;
}

function getBrowserStorageSetScript(area: BrowserStorageArea, key: string, value: string): string {
  return `(() => {
    const area = ${serializeForInjectedScript(area)};
    const key = ${serializeForInjectedScript(key)};
    const value = ${serializeForInjectedScript(value)};
    const storage = area === "session" ? window.sessionStorage : window.localStorage;
    storage.setItem(key, value);
    return { url: location.href, area, key, valueLength: value.length };
  })()`;
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

  if (method === "browser.console.list" || method === "browser.errors.list") {
    const limit = readBrowserLogLimit(params);
    const entries =
      method === "browser.errors.list"
        ? runtime.consoleEntries.filter((entry) => entry.level === "error")
        : runtime.consoleEntries;
    return {
      ...commonResult,
      entries: entries.slice(-limit)
    };
  }

  if (method === "browser.cookies.list") {
    const timeoutMs = getBrowserTimeout(params, 5000);
    const result = await executeBrowserJavaScript<{ url: string; cookies: Array<{ name: string; value: string; url: string }> }>(
      runtime,
      getBrowserCookiesListScript(),
      timeoutMs
    );
    return { ...commonResult, url: result.url, cookies: result.cookies };
  }

  if (method === "browser.storage.list") {
    const storageParams = (isRecord(params) ? params : {}) as BrowserStorageListParams;
    const area = readBrowserStorageArea(storageParams);
    const timeoutMs = getBrowserTimeout(params, 5000);
    const result = await executeBrowserJavaScript<{ url: string; area: BrowserStorageArea; entries: BrowserStorageEntry[] }>(
      runtime,
      getBrowserStorageListScript(area),
      timeoutMs
    );
    return { ...commonResult, url: result.url, area: result.area, entries: result.entries };
  }

  if (method === "browser.storage.get") {
    const storageParams = (isRecord(params) ? params : {}) as Partial<BrowserStorageGetParams>;
    if (typeof storageParams.key !== "string" || !storageParams.key) {
      throw createBrowserError("BAD_REQUEST", "browser storage get 需要 key");
    }
    const area = readBrowserStorageArea(storageParams);
    const timeoutMs = getBrowserTimeout(params, 5000);
    const result = await executeBrowserJavaScript<{
      url: string;
      area: BrowserStorageArea;
      key: string;
      value: string | null;
      exists: boolean;
    }>(runtime, getBrowserStorageGetScript(area, storageParams.key), timeoutMs);
    return { ...commonResult, url: result.url, area: result.area, key: result.key, value: result.value, exists: result.exists };
  }

  if (method === "browser.storage.set") {
    const storageParams = (isRecord(params) ? params : {}) as Partial<BrowserStorageSetParams>;
    if (typeof storageParams.key !== "string" || !storageParams.key || typeof storageParams.value !== "string") {
      throw createBrowserError("BAD_REQUEST", "browser storage set 需要 key 和 value");
    }
    const area = readBrowserStorageArea(storageParams);
    const timeoutMs = getBrowserTimeout(params, 5000);
    const result = await executeBrowserJavaScript<{ url: string; area: BrowserStorageArea; key: string; valueLength: number }>(
      runtime,
      getBrowserStorageSetScript(area, storageParams.key, storageParams.value),
      timeoutMs
    );
    return { ...commonResult, url: result.url, area: result.area, key: result.key, valueLength: result.valueLength };
  }

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

  if (method === "browser.type") {
    const typeParams = params as Partial<BrowserTypeParams>;
    if (typeof typeParams.selector !== "string" || !typeParams.selector.trim() || typeof typeParams.text !== "string") {
      throw createBrowserError("BAD_REQUEST", "browser.type 需要 selector 和 text");
    }
    const timeoutMs = getBrowserTimeout(params, 5000);
    const result = await executeBrowserJavaScript<{ matched: number; selector: string; typed: true; valueLength: number }>(
      runtime,
      getKeyboardActionScript("type", typeParams.selector, readSelectorWait(params), timeoutMs, typeParams.text),
      timeoutMs + 500
    );
    return { ...commonResult, selector: result.selector, matched: result.matched, typed: true, valueLength: result.valueLength };
  }

  if (method === "browser.press") {
    const pressParams = params as Partial<BrowserPressParams>;
    if (typeof pressParams.selector !== "string" || !pressParams.selector.trim() || typeof pressParams.key !== "string" || !pressParams.key.trim()) {
      throw createBrowserError("BAD_REQUEST", "browser.press 需要 selector 和 key");
    }
    const timeoutMs = getBrowserTimeout(params, 5000);
    const result = await executeBrowserJavaScript<{ matched: number; selector: string; pressed: true; key: string }>(
      runtime,
      getKeyboardActionScript("press", pressParams.selector, readSelectorWait(params), timeoutMs, pressParams.key),
      timeoutMs + 500
    );
    return { ...commonResult, selector: result.selector, matched: result.matched, pressed: true, key: result.key };
  }

  if (method === "browser.wait") {
    const waitParams = (isRecord(params) ? params : {}) as BrowserWaitParams;
    const timeoutMs = getBrowserTimeout(params, 5000);
    const waitUntil = readBrowserWaitUntilOrNone(params);
    if (typeof waitParams.selector === "string" && waitParams.selector.trim()) {
      const result = await executeBrowserJavaScript<{ matched: number; selector: string; url: string }>(
        runtime,
        getWaitForSelectorScript(waitParams.selector, readSelectorWait(params), timeoutMs),
        timeoutMs + 500
      );
      if (waitUntil !== "none") {
        const url = await runtime.waitForLoadState(waitUntil, timeoutMs);
        return { ...commonResult, selector: result.selector, matched: result.matched, wait: readSelectorWait(params), waitUntil, url };
      }
      return { ...commonResult, selector: result.selector, matched: result.matched, wait: readSelectorWait(params), waitUntil, url: result.url };
    }

    if (waitUntil === "none") {
      throw createBrowserError("BAD_REQUEST", "browser.wait 需要 selector 或 waitUntil");
    }
    const url = await runtime.waitForLoadState(waitUntil, timeoutMs);
    return { ...commonResult, waitUntil, url };
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

function createWorkspaceSummaries(workspaces: Workspace[], activeWorkspaceId: string, eventLimit?: number): WorkspaceSummary[] {
  return workspaces.map((workspace) => {
    const activePane = workspace.panes[workspace.activePaneId];
    const recentEvents =
      typeof eventLimit === "number" && Number.isFinite(eventLimit) && eventLimit > 0
        ? workspace.recentEvents?.slice(0, Math.floor(eventLimit))
        : workspace.recentEvents;

    return {
      id: workspace.id,
      name: workspace.name,
      cwd: workspace.cwd,
      status: workspace.status,
      active: workspace.id === activeWorkspaceId,
      activePaneId: workspace.activePaneId,
      activeSurfaceId: activePane?.activeSurfaceId,
      notice: workspace.notice,
      recentEvents
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
          subtitle: surface.subtitle,
          notebookId: surface.type === "notebook" ? (surface.notebookId ?? surface.id.replace(/^surface-notebook-/, "")) : undefined
        }))
    )
  );
}

function shouldApplyWorkspaceInspection(workspace: Workspace, inspection: WorkspaceInspection): boolean {
  const nextBranch = inspection.branch;
  const nextPorts = inspection.ports;
  const currentPullRequestKey = serializePullRequestForCompare(workspace.pullRequest);
  const nextPullRequestKey = serializePullRequestForCompare(inspection.pullRequest);
  return (
    workspace.branch !== nextBranch ||
    workspace.gitDirty !== inspection.gitDirty ||
    workspace.ports.join(",") !== nextPorts.join(",") ||
    currentPullRequestKey !== nextPullRequestKey ||
    workspace.venv !== inspection.venv ||
    workspace.nodeVersion !== inspection.nodeVersion
  );
}

function mergeWorkspaceInspection(workspace: Workspace, inspection: WorkspaceInspection): Workspace {
  return {
    ...workspace,
    branch: inspection.branch,
    gitDirty: inspection.gitDirty,
    ports: inspection.ports,
    pullRequest: inspection.pullRequest,
    venv: inspection.venv,
    nodeVersion: inspection.nodeVersion
  };
}

function serializePullRequestForCompare(value: PullRequestSummary | undefined): string {
  if (!value) {
    return "";
  }
  return `${value.number}|${value.state}|${value.title ?? ""}|${value.url ?? ""}`;
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

function attachSurfaceToPane(workspace: Workspace, paneId: string, pane: Pane, surface: Surface): Workspace {
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
}

function isEditableTextTarget(target: EventTarget | null): target is HTMLInputElement | HTMLTextAreaElement {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
}

function setNativeInputValue(target: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const prototype = target instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
  descriptor?.set?.call(target, value);
}

function pasteClipboardTextIntoEditable(target: HTMLInputElement | HTMLTextAreaElement): void {
  const text = window.wmux?.clipboard.readText() ?? "";
  if (!text) {
    return;
  }

  const start = target.selectionStart ?? target.value.length;
  const end = target.selectionEnd ?? start;
  const nextValue = `${target.value.slice(0, start)}${text}${target.value.slice(end)}`;
  setNativeInputValue(target, nextValue);
  target.setSelectionRange(start + text.length, start + text.length);
  target.dispatchEvent(new InputEvent("input", { bubbles: true, data: text, inputType: "insertFromPaste" }));
}

function handleEditableContextMenu(event: ReactMouseEvent<HTMLElement>): void {
  if (!(event.target instanceof HTMLElement) || event.target.closest(".terminalHost") || !isEditableTextTarget(event.target)) {
    return;
  }

  event.preventDefault();
  pasteClipboardTextIntoEditable(event.target);
}

export function App(): ReactElement {
  const [workspaces, setWorkspaces] = useState(initialWorkspaces);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState(workspaces[0].id);
  const [hasHydratedPersistedState, setHasHydratedPersistedState] = useState(false);
  const [editingWorkspaceId, setEditingWorkspaceId] = useState<string | null>(null);
  const [workspaceNameDraft, setWorkspaceNameDraft] = useState("");
  const [appVersion, setAppVersion] = useState("dev");
  const [appUpdateStatus, setAppUpdateStatus] = useState<AppUpdateStatus>({ state: "idle" });
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
  const [paletteRecentUsage, setPaletteRecentUsage] = useState<PaletteRecentUsageStore>({});
  const [pendingTerminalCommands, setPendingTerminalCommands] = useState<PendingTerminalCommand[]>([]);
  const [trustedCommandConfigPaths, setTrustedCommandConfigPaths] = useState<string[]>([]);
  const [pendingCommandConfirmation, setPendingCommandConfirmation] =
    useState<PendingProjectCommandConfirmation | null>(null);
  const [pendingWorkflowCommand, setPendingWorkflowCommand] = useState<PendingWorkflowCommand | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [securitySettings, setSecuritySettings] = useState<SocketSecuritySettings | null>(null);
  const [securityModeDraft, setSecurityModeDraft] = useState<SocketSecurityMode>("wmuxOnly");
  const [aiSettings, setAiSettings] = useState<AiSettings>(defaultAiSettings);
  const [aiSettingsDraft, setAiSettingsDraft] = useState<AiSettings>(defaultAiSettings);
  const [themeId, setThemeId] = useState(defaultThemeId);
  const [customThemes, setCustomThemes] = useState<WmuxTheme[]>([]);
  const [aiExplainState, setAiExplainState] = useState<AiExplainState | null>(null);
  const [aiSuggestionState, setAiSuggestionState] = useState<AiSuggestionState | null>(null);
  // FindBar 状态：当前活动 workspace 的活动 surface 内搜索
  const [findBarOpen, setFindBarOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [findCaseSensitive, setFindCaseSensitive] = useState(false);
  const [findRegex, setFindRegex] = useState(false);
  const [findResultIndex, setFindResultIndex] = useState(-1);
  const [findResultCount, setFindResultCount] = useState(0);
  const [historySearchOpen, setHistorySearchOpen] = useState(false);
  const [historyQuery, setHistoryQuery] = useState("");
  const [selectedHistoryIndex, setSelectedHistoryIndex] = useState(0);
  const terminalOutputBuffersRef = useRef(new Map<string, string>());
  const terminalSearchAddonsRef = useRef(new Map<string, SearchAddon>());
  const blockSnapshotsRef = useRef(new Map<string, BlockSnapshot>());
  const paletteCommandsRef = useRef<PaletteCommand[]>([]);
  const runPaletteCommandRef = useRef<(command: PaletteCommand) => void>(() => undefined);

  useEffect(() => {
    void window.wmux?.getVersion().then(setAppVersion).catch(() => setAppVersion("dev"));
    // 自动更新状态：拿首屏快照 + 订阅后续广播
    void window.wmux?.update?.getStatus().then(setAppUpdateStatus).catch(() => undefined);
    const unsubscribeUpdate = window.wmux?.update?.onStatus(setAppUpdateStatus);
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
                  notice: state.warning,
                  recentEvents: withWorkspaceStatusEvent(workspace, {
                    status: "attention",
                    message: state.warning
                  }).recentEvents
                }
              : workspace
          )
        );
      })
      .catch(() => undefined);
    void window.wmux?.ai
      ?.getSettings()
      .then((settings) => {
        setAiSettings(settings);
        setAiSettingsDraft({ ...settings, apiKey: "" });
      })
      .catch(() => undefined);
    void window.wmux?.theme
      ?.getSettings()
      .then((settings) => {
        setThemeId(settings.themeId);
        setCustomThemes(normalizePersistedCustomThemes(settings.customThemes));
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
    return () => {
      unsubscribeUpdate?.();
    };
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
  const activeWorkspace = workspaces.find((workspace) => workspace.id === activeWorkspaceId) ?? workspaces[0];
  const workspaceInspectionCwdKey = workspaces.map((workspace) => workspace.cwd).join("\n");
  const workspaceInspectionCwds = useMemo(
    () => [...new Set(workspaceInspectionCwdKey.split("\n").filter(Boolean))],
    [workspaceInspectionCwdKey]
  );
  const availableThemes = [...builtInThemes, ...customThemes];
  const activeTheme = getThemeById(availableThemes, themeId);
  const workspacesRef = useRef(workspaces);
  const activeWorkspaceIdRef = useRef(activeWorkspaceId);
  const editingWorkspaceIdRef = useRef(editingWorkspaceId);
  const shellProfileRef = useRef(shellProfile);
  const paletteRecentUsageRef = useRef(paletteRecentUsage);
  const configStatusText = projectConfig?.found
    ? `${projectCommands.length} 个命令（${projectConfig.sources
        ?.filter((source) => source.found)
        .map((source) => {
          const label =
            source.kind === "global"
              ? "全局"
              : source.kind === "workflow"
                ? "Workflow"
                : source.path.replace(/\\/g, "/").endsWith(".cmux/cmux.json") ? "项目 .cmux" : "项目";
          return `${label} ${source.commandCount}`;
        })
        .join(" / ") || "项目"}）`
    : "未发现 wmux.json 或 .cmux/cmux.json";
  const configErrorText = projectConfig?.errors.join("；");

  useEffect(() => {
    workspacesRef.current = workspaces;
  }, [workspaces]);

  useEffect(() => {
    activeWorkspaceIdRef.current = activeWorkspaceId;
  }, [activeWorkspaceId]);

  useEffect(() => {
    editingWorkspaceIdRef.current = editingWorkspaceId;
  }, [editingWorkspaceId]);

  useEffect(() => {
    shellProfileRef.current = shellProfile;
  }, [shellProfile]);

  useEffect(() => {
    paletteRecentUsageRef.current = paletteRecentUsage;
  }, [paletteRecentUsage]);

  useEffect(() => {
    applyThemeToDocument(activeTheme);
  }, [activeTheme]);

  useEffect(() => {
    if (!hasHydratedPersistedState) {
      return;
    }

    let isCancelled = false;
    const uniqueCwds = workspaceInspectionCwds;

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

          return mergeWorkspaceInspection(workspace, inspection);
        })
      );
    });

    return () => {
      isCancelled = true;
    };
  }, [hasHydratedPersistedState, workspaceInspectionCwds]);

  // 周期刷新 workspace 检视：拉取最新 branch / ports / PR 状态（gh CLI），60s 间隔
  useEffect(() => {
    if (!hasHydratedPersistedState) {
      return;
    }

    const intervalId = window.setInterval(() => {
      const uniqueCwds = [...new Set(workspaces.map((workspace) => workspace.cwd))];
      if (!uniqueCwds.length) {
        return;
      }
      void Promise.all(
        uniqueCwds.map((cwd) =>
          window.wmux?.workspace
            .inspectCwd(cwd)
            .then((inspection) => ({ cwd, inspection }))
            .catch(() => null)
        )
      ).then((results) => {
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
            return mergeWorkspaceInspection(workspace, inspection);
          })
        );
      });
    }, 60_000);

    return () => window.clearInterval(intervalId);
  }, [hasHydratedPersistedState, workspaces]);

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

  const handleInstallUpdate = (): void => {
    void window.wmux?.update?.install();
  };

  const handleCheckForUpdate = (): void => {
    void window.wmux?.update?.checkForUpdate();
  };

  const closeCommandPalette = (): void => {
    setCommandPaletteOpen(false);
    setCommandQuery("");
    setSelectedCommandIndex(0);
  };

  const closeWorkflowPrompt = (): void => {
    setPendingWorkflowCommand(null);
  };

  const openHistorySearch = useCallback((): void => {
    setHistorySearchOpen(true);
    setHistoryQuery("");
    setSelectedHistoryIndex(0);
  }, []);

  const closeHistorySearch = (): void => {
    setHistorySearchOpen(false);
    setHistoryQuery("");
    setSelectedHistoryIndex(0);
  };

  // FindBar：注册 SearchAddon、打开/关闭、上一个/下一个匹配
  const handleTerminalSearchReady = useCallback(
    (surfaceId: string, addon: SearchAddon): (() => void) => {
      terminalSearchAddonsRef.current.set(surfaceId, addon);
      // 订阅匹配数变化，更新 FindBar 计数（仅活动 surface 的事件被采纳）
      const disposable = addon.onDidChangeResults?.((event) => {
        const activeWorkspaceState =
          workspacesRef.current.find((workspace) => workspace.id === activeWorkspaceIdRef.current) ??
          workspacesRef.current[0];
        const activeSurface = getActiveTerminalSurface(activeWorkspaceState);
        if (activeSurface?.id !== surfaceId) {
          return;
        }
        setFindResultIndex(event.resultIndex);
        setFindResultCount(event.resultCount);
      });
      return () => {
        disposable?.dispose();
        terminalSearchAddonsRef.current.delete(surfaceId);
      };
    },
    []
  );

  const closeFindBar = useCallback((): void => {
    setFindBarOpen(false);
    setFindResultIndex(-1);
    setFindResultCount(0);
    // 清除上一次搜索的高亮，避免视觉残留
    for (const addon of terminalSearchAddonsRef.current.values()) {
      try {
        addon.clearDecorations();
      } catch {
        // addon 已 dispose
      }
    }
  }, []);

  const openFindBar = useCallback((): void => {
    setFindBarOpen(true);
  }, []);

  const findInActiveTerminal = useCallback(
    (direction: "next" | "previous", query: string): void => {
      const trimmed = query.trim();
      if (!trimmed) {
        setFindResultIndex(-1);
        setFindResultCount(0);
        return;
      }
      const activeWorkspaceState =
        workspacesRef.current.find((workspace) => workspace.id === activeWorkspaceIdRef.current) ??
        workspacesRef.current[0];
      const activeSurface = getActiveTerminalSurface(activeWorkspaceState);
      if (!activeSurface) {
        return;
      }
      const addon = terminalSearchAddonsRef.current.get(activeSurface.id);
      if (!addon) {
        return;
      }
      const options = {
        caseSensitive: findCaseSensitive,
        regex: findRegex,
        decorations: {
          matchBackground: "#3daee9",
          matchOverviewRuler: "#3daee9",
          activeMatchBackground: "#f59e0b",
          activeMatchColorOverviewRuler: "#f59e0b"
        }
      };
      try {
        if (direction === "next") {
          addon.findNext(trimmed, options);
        } else {
          addon.findPrevious(trimmed, options);
        }
      } catch {
        // regex 非法或终端已关闭，忽略
      }
    },
    [findCaseSensitive, findRegex]
  );

  // 把 SearchAddon 注册回调与 FindBar 触发器注入模块级注册表
  // 由 TerminalSurface 在挂载时直接读取，避免 4 层 prop drilling
  useEffect(() => {
    setTerminalSearchHandlers({
      onSearchReady: handleTerminalSearchReady,
      onRequestFind: () => openFindBar(),
      onRequestHistorySearch: openHistorySearch
    });
    return () => {
      setTerminalSearchHandlers({});
    };
  }, [handleTerminalSearchReady, openFindBar, openHistorySearch]);

  // 订阅 OSC 9/99/777 终端通知：复用 status.notify 路径，写入 workspace status event
  useEffect(() => {
    const cleanup = window.wmux?.terminal.onNotification?.((payload: TerminalNotificationPayload) => {
      setWorkspaces((items) => {
        const target = findSurfaceById(items, payload.surfaceId);
        if (!target) {
          return items;
        }
        const targetWorkspaceId = target.workspace.id;
        const trimmedBody = payload.body?.trim();
        const notice = trimmedBody ? `${payload.title}: ${trimmedBody}` : payload.title;
        return items.map((workspace) =>
          workspace.id === targetWorkspaceId
            ? {
                ...withWorkspaceStatusEvent(workspace, { status: "attention", message: notice }),
                status: "attention",
                notice
              }
            : workspace
        );
      });
    });
    return cleanup;
  }, []);

  useEffect(() => {
    const cleanup = window.wmux?.terminal.onBlock?.((event: BlockEvent) => {
      setWorkspaces((currentWorkspaces) => {
        const target = findSurfaceById(currentWorkspaces, event.surfaceId);
        if (!target) {
          return currentWorkspaces;
        }

        const upsertBlock = (block: Block): void => {
          blockSnapshotsRef.current.set(block.id, {
            ...block,
            workspaceId: target.workspace.id,
            workspaceName: target.workspace.name,
            surfaceName: target.surface.name
          });
        };

        if (event.type === "block:list") {
          event.blocks.forEach(upsertBlock);
        }
        if (event.type === "block:start") {
          upsertBlock({
            ...event.block,
            workspaceId: target.workspace.id
          });
        }
        if (event.type === "block:command") {
          const block = blockSnapshotsRef.current.get(event.blockId);
          if (block) {
            blockSnapshotsRef.current.set(event.blockId, { ...block, command: event.command });
          }
        }
        if (event.type === "block:end") {
          const block = blockSnapshotsRef.current.get(event.blockId);
          if (block) {
            const nextBlock: BlockSnapshot = {
              ...block,
              endedAt: event.endedAt,
              exitCode: event.exitCode,
              durationMs: Math.max(0, Date.parse(event.endedAt) - Date.parse(block.startedAt)),
              status: event.exitCode === 0 ? "success" : "error"
            };
            blockSnapshotsRef.current.set(event.blockId, nextBlock);
          }
        }

        if (event.type !== "block:end") {
          return currentWorkspaces;
        }

        const status: WorkspaceStatus = event.exitCode === 0 ? "success" : "error";
        const block = blockSnapshotsRef.current.get(event.blockId);
        const notice = block?.command ? `${block.command} → exit ${event.exitCode}` : `Command exited ${event.exitCode}`;
        return currentWorkspaces.map((workspace) =>
          workspace.id === target.workspace.id
            ? {
                ...withWorkspaceStatusEvent(workspace, { status, message: notice }),
                status,
                notice
              }
            : workspace
        );
      });
    });
    return cleanup;
  }, []);

  useEffect(() => {
    const cleanup = window.wmux?.ai?.onStream((event: AiStreamEvent) => {
      setAiExplainState((currentState) => {
        if (!currentState || currentState.requestId !== event.requestId) {
          return currentState;
        }
        if (event.type === "token") {
          return { ...currentState, text: `${currentState.text}${event.token}` };
        }
        if (event.type === "done") {
          return { ...currentState, status: "done" };
        }
        return { ...currentState, status: "error", error: event.error };
      });
      setAiSuggestionState((currentState) => {
        if (!currentState || currentState.requestId !== event.requestId) {
          return currentState;
        }
        if (event.type === "token") {
          return { ...currentState, text: `${currentState.text}${event.token}` };
        }
        if (event.type === "done") {
          return { ...currentState, status: "done" };
        }
        return { ...currentState, status: "error", error: event.error };
      });
    });

    return cleanup;
  }, []);

  // active workspace 切换时为该 workspace 标记已读时间戳：unread badge 据此清零
  useEffect(() => {
    if (!activeWorkspaceId) {
      return;
    }
    const at = new Date().toISOString();
    setWorkspaces((currentWorkspaces) =>
      currentWorkspaces.map((workspace) =>
        workspace.id === activeWorkspaceId ? { ...workspace, lastViewedAt: at } : workspace
      )
    );
  }, [activeWorkspaceId]);

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

  const findExistingCommandWorkspace = (command: WmuxCommandConfig): Workspace | undefined => {
    const identity = getWorkspaceCommandIdentity(command);
    return workspaces.find((workspace) => workspace.name === identity.name && workspace.cwd === identity.cwd);
  };

  const buildAndAddWorkspaceCommand = (command: WmuxCommandConfig, replaceWorkspaceId?: string): void => {
    const buildResult = createWorkspaceFromCommand(command);
    setWorkspaces((currentWorkspaces) => {
      if (!replaceWorkspaceId) {
        return [...currentWorkspaces, buildResult.workspace];
      }

      const replaceIndex = currentWorkspaces.findIndex((workspace) => workspace.id === replaceWorkspaceId);
      if (replaceIndex < 0) {
        return [...currentWorkspaces, buildResult.workspace];
      }

      const nextWorkspaces = currentWorkspaces.filter((workspace) => workspace.id !== replaceWorkspaceId);
      nextWorkspaces.splice(replaceIndex, 0, buildResult.workspace);
      return nextWorkspaces;
    });
    setActiveWorkspaceId(buildResult.workspace.id);
    setPendingTerminalCommands((items) => [...items, ...buildResult.terminalCommands]);
  };

  const runWorkspaceCommand = (command: WmuxCommandConfig): void => {
    const existingWorkspace = findExistingCommandWorkspace(command);
    if (existingWorkspace) {
      if (command.restart === "ignore") {
        setActiveWorkspaceId(existingWorkspace.id);
        setWorkspaces((currentWorkspaces) =>
          currentWorkspaces.map((workspace) =>
            workspace.id === existingWorkspace.id
              ? {
                  ...workspace,
                  notice: `已存在，跳过重复运行：${command.name}`
                }
              : workspace
          )
        );
        return;
      }

      if (command.restart === "confirm") {
        setActiveWorkspaceId(existingWorkspace.id);
        setPendingCommandConfirmation({ command, reason: "restart", existingWorkspaceId: existingWorkspace.id });
        return;
      }

      if (command.restart === "recreate") {
        buildAndAddWorkspaceCommand(command, existingWorkspace.id);
        return;
      }
    }

    buildAndAddWorkspaceCommand(command);
  };

  const writeCommandToActiveTerminalDraft = (commandText: string, commandName: string): boolean => {
    const terminalSurface = getActiveTerminalSurface(activeWorkspace);
    if (!terminalSurface) {
      updateActiveWorkspace((workspace) => ({
        ...workspace,
        status: "attention",
        notice: `没有可写入的终端：${commandName}`
      }));
      return false;
    }

    if (writeTerminalInputDraft(terminalSurface.id, commandText)) {
      updateActiveWorkspace((workspace) => ({
        ...workspace,
        status: "attention",
        notice: `已写入命令：${commandName}`
      }));
      return true;
    }

    window.wmux?.terminal.input({
      id: `${terminalSurface.id}:${shellProfileRef.current}`,
      data: commandText
    });
    updateActiveWorkspace((workspace) => ({
      ...workspace,
      status: "attention",
      notice: `已写入命令：${commandName}`
    }));
    return true;
  };

  const runHistoryCommand = (block: BlockSnapshot, mode: "insert" | "execute"): void => {
    const commandText = mode === "execute" ? appendCommandNewline(block.command) : block.command;
    const target = findSurfaceById(workspacesRef.current, block.surfaceId);
    if (target) {
      setActiveWorkspaceId(target.workspace.id);
      setWorkspaces((items) =>
        items.map((workspace) =>
          workspace.id === target.workspace.id
            ? {
                ...workspace,
                activePaneId: target.paneId,
                status: mode === "execute" ? "running" : "attention",
                notice: mode === "execute" ? `已运行历史命令：${block.command}` : `已写入历史命令：${block.command}`,
                panes: {
                  ...workspace.panes,
                  [target.paneId]: {
                    ...workspace.panes[target.paneId],
                    activeSurfaceId: target.surface.id
                  }
                }
              }
            : workspace
        )
      );
    }

    if (mode === "insert" && writeTerminalInputDraft(block.surfaceId, block.command)) {
      closeHistorySearch();
      return;
    }

    window.wmux?.terminal.input({
      id: `${block.surfaceId}:${shellProfileRef.current}`,
      data: commandText
    });
    closeHistorySearch();
  };

  const explainBlockWithAi = (block: Block): void => {
    const snapshot = blockSnapshotsRef.current.get(block.id) ?? block;
    const requestId = `ai-explain-${block.id}-${Date.now()}`;
    setAiExplainState({
      requestId,
      block: snapshot,
      text: "",
      status: "streaming"
    });
    void window.wmux?.ai
      ?.explain({
        requestId,
        blockId: block.id,
        surfaceId: block.surfaceId
      })
      .catch((error) => {
        setAiExplainState((currentState) =>
          currentState?.requestId === requestId
            ? {
                ...currentState,
                status: "error",
                error: error instanceof Error ? error.message : String(error)
              }
            : currentState
        );
      });
  };

  const requestAiCommandSuggestions = ({
    prompt,
    surfaceId,
    cwd,
    shell
  }: {
    prompt: string;
    surfaceId: string;
    cwd: string;
    shell: ShellProfile;
  }): void => {
    const requestId = `ai-suggest-${surfaceId}-${Date.now()}`;
    setAiSuggestionState({
      requestId,
      prompt,
      surfaceId,
      text: "",
      status: "streaming"
    });
    setCommandQuery(prompt);
    setSelectedCommandIndex(0);
    setCommandPaletteOpen(true);
    void window.wmux?.ai
      ?.suggest({
        requestId,
        prompt,
        cwd,
        shell
      })
      .catch((error) => {
        setAiSuggestionState((currentState) =>
          currentState?.requestId === requestId
            ? {
                ...currentState,
                status: "error",
                error: error instanceof Error ? error.message : String(error)
              }
            : currentState
        );
      });
  };

  const cancelAiRequest = (requestId: string): void => {
    void window.wmux?.ai?.cancel({ requestId }).catch(() => undefined);
  };

  const openWorkflowPrompt = (command: WmuxCommandConfig): void => {
    setPendingWorkflowCommand({
      command,
      values: createWorkflowArgDefaults(command.args)
    });
  };

  const updateWorkflowArgValue = (name: string, value: string): void => {
    setPendingWorkflowCommand((pendingCommand) =>
      pendingCommand
        ? {
            ...pendingCommand,
            values: {
              ...pendingCommand.values,
              [name]: value
            }
          }
        : pendingCommand
    );
  };

  const confirmWorkflowCommand = (): void => {
    const pendingCommand = pendingWorkflowCommand;
    if (!pendingCommand) {
      return;
    }

    const template = getWorkflowCommandTemplate(pendingCommand.command);
    if (!template) {
      setPendingWorkflowCommand(null);
      return;
    }

    const validation = validateWorkflowArgs(pendingCommand.command.args, pendingCommand.values, template);
    if (!validation.ok) {
      return;
    }

    const renderedCommand = renderWorkflowCommand(template, pendingCommand.values);
    if (writeCommandToActiveTerminalDraft(renderedCommand, pendingCommand.command.name)) {
      setPendingWorkflowCommand(null);
      closeCommandPalette();
    }
  };

  const executeProjectCommand = (command: WmuxCommandConfig): void => {
    if (isWorkflowCommand(command)) {
      openWorkflowPrompt(command);
      return;
    }
    if (command.workspace) {
      runWorkspaceCommand(command);
    } else {
      runSimpleCommand(command);
    }
  };

  const runProjectCommand = (command: WmuxCommandConfig): void => {
    const configPath = command.sourcePath ?? projectConfig?.path;
    if (projectConfig?.found && configPath && !trustedCommandConfigPaths.includes(configPath)) {
      setPendingCommandConfirmation({ command, reason: "trust" });
      return;
    }

    executeProjectCommand(command);
    closeCommandPalette();
  };

  const confirmProjectCommand = (): void => {
    const confirmation = pendingCommandConfirmation;
    if (!confirmation) {
      return;
    }

    if (confirmation.reason === "trust") {
      const configPath = confirmation.command.sourcePath ?? projectConfig?.path;
      if (configPath) {
        setTrustedCommandConfigPaths((paths) => (paths.includes(configPath) ? paths : [...paths, configPath]));
      }
    }
    if (confirmation.reason === "restart") {
      buildAndAddWorkspaceCommand(confirmation.command, confirmation.existingWorkspaceId);
    } else {
      executeProjectCommand(confirmation.command);
    }
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

  const handleSaveAiSettings = (): void => {
    void window.wmux?.ai
      ?.setSettings({
        enabled: aiSettingsDraft.enabled,
        endpoint: aiSettingsDraft.endpoint,
        model: aiSettingsDraft.model,
        apiKey: aiSettingsDraft.apiKey,
        redactSecrets: aiSettingsDraft.redactSecrets,
        maxOutputBytes: aiSettingsDraft.maxOutputBytes
      })
      .then((settings) => {
        setAiSettings(settings);
        setAiSettingsDraft({ ...settings, apiKey: "" });
      })
      .catch(() => undefined);
  };

  const persistThemeSettings = (nextThemeId: string, nextCustomThemes: WmuxTheme[]): void => {
    void window.wmux?.theme
      ?.setSettings({
        themeId: nextThemeId,
        customThemes: serializeCustomThemes(nextCustomThemes)
      })
      .then((settings) => {
        setThemeId(settings.themeId);
        setCustomThemes(normalizePersistedCustomThemes(settings.customThemes));
      })
      .catch(() => undefined);
  };

  const handleSelectTheme = (nextThemeId: string): void => {
    setThemeId(nextThemeId);
    persistThemeSettings(nextThemeId, customThemes);
  };

  const handleImportTheme = (content: string): ThemeImportResult => {
    const result = importThemesFromJson(content);
    if (!result.ok) {
      return result;
    }
    const nextCustomThemes = mergeCustomThemes(customThemes, result.themes);
    const nextThemeId = result.themes[0]?.id ?? themeId;
    setThemeId(nextThemeId);
    setCustomThemes(nextCustomThemes);
    persistThemeSettings(nextThemeId, nextCustomThemes);
    return result;
  };

  const buildPaletteCommands = (): PaletteCommand[] => {
    const activePane = activeWorkspace.panes[activeWorkspace.activePaneId];
    const activeSurface = activePane ? activeWorkspace.surfaces[activePane.activeSurfaceId] : undefined;
    const blockHistory = searchBlockHistory([...blockSnapshotsRef.current.values()], commandQuery, {
      includeOutput: true,
      limit: commandQuery.trim() ? 80 : 24
    });
    const aiSuggestionLines =
      aiSuggestionState?.text
        .split(/\r?\n/)
        .map((line) => line.replace(/^\s*(?:[-*]|\d+\.)\s*/, "").replace(/^`{1,3}|`{1,3}$/g, "").trim())
        .filter((line) => line && !line.startsWith("#"))
        .slice(0, 3) ?? [];
    const aiCommands: PaletteCommand[] =
      aiSuggestionState && aiSettings.enabled
        ? aiSuggestionLines.length > 0
          ? aiSuggestionLines.map((command, index) => ({
              id: `ai:suggest:${aiSuggestionState.requestId}:${index}`,
              category: "ai",
              title: command,
              subtitle: aiSuggestionState.prompt,
              keywords: [aiSuggestionState.prompt, command],
              shortcut: "AI",
              run: () => {
                writeCommandToActiveTerminalDraft(command, "AI suggestion");
                setAiSuggestionState(null);
              }
            }))
          : [
              {
                id: `ai:suggest:${aiSuggestionState.requestId}:pending`,
                category: "ai",
                title:
                  aiSuggestionState.status === "error"
                    ? `AI failed: ${aiSuggestionState.error ?? "unknown error"}`
                    : "AI is generating commands...",
                subtitle: aiSuggestionState.prompt,
                shortcut: aiSuggestionState.status === "streaming" ? "Streaming" : "AI",
                run: () => undefined
              }
            ]
        : [];
    const blockCommands = blockHistory.results
      .map(
        (block): PaletteCommand => ({
          id: `block:${block.id}`,
          category: "block",
          title: block.command || "Terminal block",
          subtitle: `${block.workspaceName ?? block.workspaceId} / ${block.surfaceName ?? block.surfaceId}${typeof block.exitCode === "number" ? ` / exit ${block.exitCode}` : ""}`,
          keywords: [
            block.exitCode === 0 ? "success" : "error",
            block.cwd ?? "",
            block.shell ?? "",
            block.command,
            block.workspaceName ?? "",
            block.surfaceName ?? ""
          ],
          run: () => {
            const target = findSurfaceById(workspacesRef.current, block.surfaceId);
            if (target) {
              setActiveWorkspaceId(target.workspace.id);
              setWorkspaces((items) =>
                items.map((workspace) =>
                  workspace.id === target.workspace.id
                    ? {
                        ...workspace,
                        activePaneId: target.paneId,
                        panes: {
                          ...workspace.panes,
                          [target.paneId]: {
                            ...workspace.panes[target.paneId],
                            activeSurfaceId: target.surface.id
                          }
                        }
                      }
                    : workspace
                )
              );
            }
          }
        })
      );

    return [
      ...workspaces.map(
        (workspace): PaletteCommand => ({
          id: `workspace:${workspace.id}`,
          category: "workspace",
          title: `Switch to ${workspace.name}`,
          subtitle: workspace.cwd,
          keywords: [workspace.name, workspace.cwd, workspace.branch ?? "", workspace.status],
          shortcut: workspace.id === activeWorkspaceId ? "current" : undefined,
          run: () => setActiveWorkspaceId(workspace.id)
        })
      ),
      {
        id: "workspace:new",
        category: "workspace",
        title: "New workspace",
        subtitle: "Create a workspace with a terminal",
        shortcut: "Ctrl+Shift+N",
        run: () => handleCreateWorkspace()
      },
      ...(activeWorkspace
        ? [
            {
              id: `workspace:rename:${activeWorkspace.id}`,
              category: "workspace" as const,
              title: "Rename current workspace",
              subtitle: activeWorkspace.name,
              shortcut: "F2",
              run: () => handleStartRenameWorkspace(activeWorkspace)
            },
            {
              id: `workspace:close:${activeWorkspace.id}`,
              category: "workspace" as const,
              title: "Close current workspace",
              subtitle: activeWorkspace.name,
              shortcut: "Ctrl+W",
              run: () => handleCloseWorkspace(activeWorkspace.id)
            }
          ]
        : []),
      {
        id: "surface:new-terminal",
        category: "surface",
        title: "New terminal surface",
        subtitle: "Add a terminal to the active pane",
        shortcut: "Ctrl+Shift+Enter",
        run: () => handleAddTerminalSurface(activeWorkspace.activePaneId)
      },
      {
        id: "surface:new-browser",
        category: "surface",
            title: "New browser surface",
            subtitle: "Add a browser to the active pane",
            shortcut: "Ctrl+Shift+B",
            run: () => handleAddBrowserSurface(activeWorkspace.activePaneId)
          },
          {
            id: "surface:new-notebook",
            category: "surface",
            title: "New notebook surface",
            subtitle: "Create a Markdown notebook in .wmux/notebooks",
            shortcut: "Ctrl+Shift+O",
            icon: "notebook",
            run: () => handleAddNotebookSurface(activeWorkspace.activePaneId)
          },
          {
            id: "surface:split-horizontal",
        category: "surface",
        title: "Split horizontally",
        subtitle: "Create a side-by-side pane",
        shortcut: "Ctrl+Alt+↑",
        run: () => handleSplitActivePane("horizontal")
      },
      {
        id: "surface:split-vertical",
        category: "surface",
        title: "Split vertically",
        subtitle: "Create a stacked pane",
        shortcut: "Ctrl+Alt+↓",
        run: () => handleSplitActivePane("vertical")
      },
      ...(activeSurface
        ? [
            {
              id: `surface:close:${activeSurface.id}`,
              category: "surface" as const,
              title: "Close active surface",
              subtitle: activeSurface.name,
              shortcut: "Ctrl+W",
              run: () => handleCloseActiveSurface()
            }
          ]
        : []),
      ...projectCommands.map(
        (command): PaletteCommand => {
          const workflow = isWorkflowCommand(command);
          const commandText = getWorkflowCommandTemplate(command);
          return {
            id: `project:${command.sourcePath ?? projectConfig?.path ?? "wmux.json"}:${command.name}`,
            category: workflow ? "workflow" : "project",
            title: command.name,
            subtitle: command.description ?? commandText ?? command.workspace?.name ?? "项目自定义命令",
            keywords: [
              command.name,
              command.description ?? "",
              command.command ?? "",
              command.commandTemplate ?? "",
              ...(command.args?.map((arg) => arg.name) ?? []),
              ...(command.keywords ?? [])
            ],
            icon: workflow ? "workflow" : command.workspace ? "workspace" : "terminal",
            args: command.args?.map((arg) => ({
              name: arg.name,
              description: arg.description,
              default: arg.default,
              required: arg.required,
              options: arg.enum
            })),
            run: () => runProjectCommand(command)
          };
        }
      ),
      ...blockCommands,
      ...aiCommands,
      {
        id: "settings:open",
        category: "settings",
        title: "Open settings",
        subtitle: "Socket security and app settings",
        run: () => {
          setSettingsOpen(true);
          setNotificationsOpen(false);
        }
      },
      {
        id: "settings:reload-config",
        category: "settings",
        title: "Reload wmux config",
        subtitle: projectConfig?.path ?? "wmux.json",
        run: () => {
          void window.wmux?.config.loadProjectConfig().then(setProjectConfig).catch(() => undefined);
        }
      }
    ];
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
              notice: undefined,
              recentEvents: undefined
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

      if (request.method === "config.list") {
        void window.wmux?.config
          .loadProjectConfig()
          .then((config) => {
            setProjectConfig(config);
            window.wmux?.socket.respond(createSocketSuccessResponse(request.id, config));
          })
          .catch((error) => {
            window.wmux?.socket.respond(
              createSocketErrorResponse(request.id, "INTERNAL", `读取项目配置失败：${error instanceof Error ? error.message : String(error)}`)
            );
          });
        return;
      }

      if (request.method === "palette.open") {
        const params = (request.params ?? {}) as Partial<PaletteOpenParams>;
        setCommandQuery(typeof params.query === "string" ? params.query : "");
        setSelectedCommandIndex(0);
        setCommandPaletteOpen(true);
        window.wmux?.socket.respond(createSocketSuccessResponse(request.id, { opened: true }));
        return;
      }

      if (request.method === "palette.run") {
        const params = (request.params ?? {}) as Partial<PaletteRunParams>;
        const commands = rankPaletteCommands(paletteCommandsRef.current, params.query ?? "", {
          recentUsage: paletteRecentUsageRef.current
        });
        const command =
          typeof params.id === "string" ? commands.find((item) => item.id === params.id) : commands[0];
        if (!command) {
          window.wmux?.socket.respond(createSocketErrorResponse(request.id, "NOT_FOUND", "找不到 palette 命令"));
          return;
        }
        runPaletteCommandRef.current(command);
        window.wmux?.socket.respond(createSocketSuccessResponse(request.id, { id: command.id, title: command.title }));
        return;
      }

      if (request.method === "workspace.list") {
        const params = (request.params ?? {}) as Partial<WorkspaceListParams>;
        const summaries = createWorkspaceSummaries(currentWorkspaces, currentActiveWorkspaceId);
        window.wmux?.socket.respond(
          createSocketSuccessResponse(request.id, {
            workspaces: params.active ? summaries.filter((workspace) => workspace.active) : summaries
          })
        );
        return;
      }

      if (request.method === "workspace.create") {
        const params = (request.params ?? {}) as Partial<WorkspaceCreateParams>;
        if (params.name !== undefined && (typeof params.name !== "string" || !params.name.trim())) {
          window.wmux?.socket.respond(createSocketErrorResponse(request.id, "BAD_REQUEST", "workspace.create name 不能为空"));
          return;
        }
        if (params.cwd !== undefined && (typeof params.cwd !== "string" || !params.cwd.trim())) {
          window.wmux?.socket.respond(createSocketErrorResponse(request.id, "BAD_REQUEST", "workspace.create cwd 不能为空"));
          return;
        }

        const workspace = createWorkspace({
          name: params.name,
          cwd: params.cwd
        });
        setWorkspaces((items) => [...items, workspace]);
        setActiveWorkspaceId(workspace.id);
        window.wmux?.socket.respond(
          createSocketSuccessResponse(request.id, {
            workspace: createWorkspaceSummaries([workspace], workspace.id)[0]
          })
        );
        return;
      }

      if (request.method === "workspace.select") {
        const params = (request.params ?? {}) as Partial<WorkspaceSelectParams>;
        if (typeof params.workspaceId !== "string" || !params.workspaceId.trim()) {
          window.wmux?.socket.respond(
            createSocketErrorResponse(request.id, "BAD_REQUEST", "workspace.select 需要 workspaceId")
          );
          return;
        }

        const targetWorkspace = currentWorkspaces.find((workspace) => workspace.id === params.workspaceId);
        if (!targetWorkspace) {
          window.wmux?.socket.respond(
            createSocketErrorResponse(request.id, "NOT_FOUND", "找不到 workspace", {
              workspaceId: params.workspaceId
            })
          );
          return;
        }

        setActiveWorkspaceId(targetWorkspace.id);
        window.wmux?.socket.respond(
          createSocketSuccessResponse(request.id, {
            workspaceId: targetWorkspace.id,
            workspaceName: targetWorkspace.name,
            activePaneId: targetWorkspace.activePaneId
          })
        );
        return;
      }

      if (request.method === "workspace.close") {
        const params = (request.params ?? {}) as Partial<WorkspaceCloseParams>;
        if (typeof params.workspaceId !== "string" || !params.workspaceId.trim()) {
          window.wmux?.socket.respond(
            createSocketErrorResponse(request.id, "BAD_REQUEST", "workspace.close 需要 workspaceId")
          );
          return;
        }

        const closedIndex = currentWorkspaces.findIndex((workspace) => workspace.id === params.workspaceId);
        if (closedIndex < 0) {
          window.wmux?.socket.respond(
            createSocketErrorResponse(request.id, "NOT_FOUND", "找不到 workspace", {
              workspaceId: params.workspaceId
            })
          );
          return;
        }
        if (currentWorkspaces.length <= 1) {
          window.wmux?.socket.respond(createSocketErrorResponse(request.id, "INVALID_STATE", "不能关闭最后一个 workspace"));
          return;
        }

        const closedWorkspace = currentWorkspaces[closedIndex];
        const nextWorkspaces = currentWorkspaces.filter((workspace) => workspace.id !== params.workspaceId);
        const fallbackWorkspace =
          params.workspaceId === currentActiveWorkspaceId
            ? nextWorkspaces[Math.max(0, Math.min(closedIndex, nextWorkspaces.length - 1))]
            : currentWorkspaces.find((workspace) => workspace.id === currentActiveWorkspaceId);

        setWorkspaces(nextWorkspaces);
        if (fallbackWorkspace) {
          setActiveWorkspaceId(fallbackWorkspace.id);
        }
        if (editingWorkspaceIdRef.current === params.workspaceId) {
          setEditingWorkspaceId(null);
          setWorkspaceNameDraft("");
        }

        window.wmux?.socket.respond(
          createSocketSuccessResponse(request.id, {
            workspaceId: closedWorkspace.id,
            workspaceName: closedWorkspace.name,
            activeWorkspaceId: fallbackWorkspace?.id
          })
        );
        return;
      }

      if (request.method === "workspace.rename") {
        const params = (request.params ?? {}) as Partial<WorkspaceRenameParams>;
        if (typeof params.workspaceId !== "string" || !params.workspaceId.trim()) {
          window.wmux?.socket.respond(
            createSocketErrorResponse(request.id, "BAD_REQUEST", "workspace.rename 需要 workspaceId")
          );
          return;
        }
        if (typeof params.name !== "string" || !params.name.trim()) {
          window.wmux?.socket.respond(createSocketErrorResponse(request.id, "BAD_REQUEST", "workspace.rename 需要 name"));
          return;
        }

        const targetWorkspace = currentWorkspaces.find((workspace) => workspace.id === params.workspaceId);
        if (!targetWorkspace) {
          window.wmux?.socket.respond(
            createSocketErrorResponse(request.id, "NOT_FOUND", "找不到 workspace", {
              workspaceId: params.workspaceId
            })
          );
          return;
        }

        const nextName = params.name.trim();
        setWorkspaces((items) =>
          items.map((workspace) => (workspace.id === targetWorkspace.id ? { ...workspace, name: nextName } : workspace))
        );
        if (editingWorkspaceIdRef.current === targetWorkspace.id) {
          setEditingWorkspaceId(null);
          setWorkspaceNameDraft("");
        }

        window.wmux?.socket.respond(
          createSocketSuccessResponse(request.id, {
            workspaceId: targetWorkspace.id,
            workspaceName: nextName,
            previousName: targetWorkspace.name
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

      if (request.method === "surface.createTerminal") {
        const params = (request.params ?? {}) as Partial<SurfaceCreateTerminalParams>;
        if (params.paneId !== undefined && (typeof params.paneId !== "string" || !params.paneId.trim())) {
          window.wmux?.socket.respond(
            createSocketErrorResponse(request.id, "BAD_REQUEST", "surface.createTerminal paneId 不能为空")
          );
          return;
        }
        if (params.name !== undefined && (typeof params.name !== "string" || !params.name.trim())) {
          window.wmux?.socket.respond(
            createSocketErrorResponse(request.id, "BAD_REQUEST", "surface.createTerminal name 不能为空")
          );
          return;
        }
        if (params.cwd !== undefined && (typeof params.cwd !== "string" || !params.cwd.trim())) {
          window.wmux?.socket.respond(
            createSocketErrorResponse(request.id, "BAD_REQUEST", "surface.createTerminal cwd 不能为空")
          );
          return;
        }

        const paneId = params.paneId?.trim() || currentWorkspace.activePaneId;
        const pane = currentWorkspace.panes[paneId];
        if (!pane) {
          window.wmux?.socket.respond(
            createSocketErrorResponse(request.id, "NOT_FOUND", "找不到 pane", {
              paneId
            })
          );
          return;
        }

        const surface = createTerminalSurface({ name: params.name, cwd: params.cwd });
        setWorkspaces((items) =>
          items.map((workspace) =>
            workspace.id === currentWorkspace.id
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
        );

        window.wmux?.socket.respond(
          createSocketSuccessResponse(request.id, {
            workspaceId: currentWorkspace.id,
            paneId,
            surfaceId: surface.id,
            surface
          })
        );
        return;
      }

      if (request.method === "surface.createBrowser") {
        const params = (request.params ?? {}) as Partial<SurfaceCreateBrowserParams>;
        if (params.paneId !== undefined && (typeof params.paneId !== "string" || !params.paneId.trim())) {
          window.wmux?.socket.respond(
            createSocketErrorResponse(request.id, "BAD_REQUEST", "surface.createBrowser paneId 不能为空")
          );
          return;
        }
        if (params.name !== undefined && (typeof params.name !== "string" || !params.name.trim())) {
          window.wmux?.socket.respond(createSocketErrorResponse(request.id, "BAD_REQUEST", "surface.createBrowser name 不能为空"));
          return;
        }
        if (params.url !== undefined && (typeof params.url !== "string" || !params.url.trim())) {
          window.wmux?.socket.respond(createSocketErrorResponse(request.id, "BAD_REQUEST", "surface.createBrowser url 不能为空"));
          return;
        }

        const paneId = params.paneId?.trim() || currentWorkspace.activePaneId;
        const pane = currentWorkspace.panes[paneId];
        if (!pane) {
          window.wmux?.socket.respond(
            createSocketErrorResponse(request.id, "NOT_FOUND", "找不到 pane", {
              paneId
            })
          );
          return;
        }

        const surface = createBrowserSurface({ name: params.name, url: params.url });
        browserSessions.set(surface.id, {
          history: [surface.subtitle ?? "about:blank"],
          historyIndex: 0,
          url: surface.subtitle ?? "about:blank"
        });
        setWorkspaces((items) =>
          items.map((workspace) =>
            workspace.id === currentWorkspace.id
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
        );

        window.wmux?.socket.respond(
          createSocketSuccessResponse(request.id, {
            workspaceId: currentWorkspace.id,
            paneId,
            surfaceId: surface.id,
            surface
          })
        );
        return;
      }

      if (request.method === "surface.createNotebook") {
        const params = (request.params ?? {}) as Partial<SurfaceCreateNotebookParams>;
        if (params.paneId !== undefined && (typeof params.paneId !== "string" || !params.paneId.trim())) {
          window.wmux?.socket.respond(
            createSocketErrorResponse(request.id, "BAD_REQUEST", "surface.createNotebook paneId 不能为空")
          );
          return;
        }
        if (params.name !== undefined && (typeof params.name !== "string" || !params.name.trim())) {
          window.wmux?.socket.respond(
            createSocketErrorResponse(request.id, "BAD_REQUEST", "surface.createNotebook name 不能为空")
          );
          return;
        }
        if (params.notebookId !== undefined && (typeof params.notebookId !== "string" || !params.notebookId.trim())) {
          window.wmux?.socket.respond(
            createSocketErrorResponse(request.id, "BAD_REQUEST", "surface.createNotebook notebookId 不能为空")
          );
          return;
        }

        const paneId = params.paneId?.trim() || currentWorkspace.activePaneId;
        const pane = currentWorkspace.panes[paneId];
        if (!pane) {
          window.wmux?.socket.respond(
            createSocketErrorResponse(request.id, "NOT_FOUND", "找不到 pane", {
              paneId
            })
          );
          return;
        }

        const surface = createNotebookSurface({
          number: nextSurfaceNumber++,
          name: params.name,
          notebookId: params.notebookId
        });
        setWorkspaces((items) =>
          items.map((workspace) =>
            workspace.id === currentWorkspace.id
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
        );

        window.wmux?.socket.respond(
          createSocketSuccessResponse(request.id, {
            workspaceId: currentWorkspace.id,
            paneId,
            surfaceId: surface.id,
            surface
          })
        );
        return;
      }

      if (request.method === "surface.split") {
        const params = (request.params ?? {}) as Partial<SurfaceSplitParams>;
        if (params.direction !== "horizontal" && params.direction !== "vertical") {
          window.wmux?.socket.respond(
            createSocketErrorResponse(request.id, "BAD_REQUEST", "surface.split 需要 direction=horizontal|vertical")
          );
          return;
        }

        const paneIdToSplit = currentWorkspace.activePaneId;
        const { paneId, pane, surface } = createPaneWithTerminal();
        setWorkspaces((items) =>
          items.map((workspace) =>
            workspace.id === currentWorkspace.id
              ? {
                  ...workspace,
                  activePaneId: paneId,
                  layout: splitPaneNode(workspace.layout, paneIdToSplit, params.direction as "horizontal" | "vertical", paneId),
                  panes: {
                    ...workspace.panes,
                    [paneId]: pane
                  },
                  surfaces: {
                    ...workspace.surfaces,
                    [surface.id]: surface
                  }
                }
              : workspace
          )
        );
        window.wmux?.socket.respond(
          createSocketSuccessResponse(request.id, {
            workspaceId: currentWorkspace.id,
            paneId,
            surfaceId: surface.id,
            surface
          })
        );
        return;
      }

      if (request.method === "surface.focus") {
        const params = (request.params ?? {}) as Partial<SurfaceFocusParams>;
        if (typeof params.surfaceId !== "string" || !params.surfaceId.trim()) {
          window.wmux?.socket.respond(createSocketErrorResponse(request.id, "BAD_REQUEST", "surface.focus 需要 surfaceId"));
          return;
        }

        const target = findSurfaceById(currentWorkspaces, params.surfaceId);

        if (!target) {
          window.wmux?.socket.respond(
            createSocketErrorResponse(request.id, "NOT_FOUND", "找不到 surface", {
              surfaceId: params.surfaceId
            })
          );
          return;
        }

        setActiveWorkspaceId(target.workspace.id);
        setWorkspaces((items) =>
          items.map((workspace) => {
            if (workspace.id !== target?.workspace.id) {
              return workspace;
            }
            const pane = workspace.panes[target.paneId];
            const surface = workspace.surfaces[target.surface.id];
            if (!pane || !surface) {
              return workspace;
            }
            return {
              ...workspace,
              activePaneId: pane.id,
              panes: {
                ...workspace.panes,
                [pane.id]: {
                  ...pane,
                  activeSurfaceId: surface.id
                }
              }
            };
          })
        );

        window.wmux?.socket.respond(
          createSocketSuccessResponse(request.id, {
            workspaceId: target.workspace.id,
            paneId: target.paneId,
            surfaceId: target.surface.id,
            surfaceType: target.surface.type
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
          if (params.surfaceId) {
            const target = findSurfaceById(currentWorkspaces, params.surfaceId);
            if (!target) {
              window.wmux?.socket.respond(
                createSocketErrorResponse(request.id, "NOT_FOUND", "找不到 surface", {
                  surfaceId: params.surfaceId
                })
              );
              return;
            }
            window.wmux?.socket.respond(
              createSocketErrorResponse(request.id, "SURFACE_TYPE_MISMATCH", "指定 surface 不是 terminal", {
                surfaceId: params.surfaceId,
                surfaceType: target.surface.type
              })
            );
            return;
          }
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
          if (params.surfaceId) {
            const target = findSurfaceById(currentWorkspaces, params.surfaceId);
            if (!target) {
              window.wmux?.socket.respond(
                createSocketErrorResponse(request.id, "NOT_FOUND", "找不到 surface", {
                  surfaceId: params.surfaceId
                })
              );
              return;
            }
            window.wmux?.socket.respond(
              createSocketErrorResponse(request.id, "SURFACE_TYPE_MISMATCH", "指定 surface 不是 terminal", {
                surfaceId: params.surfaceId,
                surfaceType: target.surface.type
              })
            );
            return;
          }
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
                  ...withWorkspaceStatusEvent(workspace, { status: "attention", message: notice }),
                  status: "attention",
                  notice
                }
              : workspace
          )
        );
        window.wmux?.socket.respond(createSocketSuccessResponse(request.id, { workspaceId: targetWorkspaceId, notice }));
        return;
      }

      if (request.method === "status.set") {
        const params = (request.params ?? {}) as Partial<StatusSetParams>;
        if (!isWorkspaceStatus(params.status)) {
          window.wmux?.socket.respond(
            createSocketErrorResponse(request.id, "BAD_REQUEST", "status 需要 idle|running|attention|success|error")
          );
          return;
        }
        const nextStatus = params.status;

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

        const notice = typeof params.notice === "string" && params.notice.trim() ? params.notice : undefined;
        setWorkspaces((items) =>
          items.map((workspace) =>
            workspace.id === targetWorkspaceId
              ? {
                  ...withWorkspaceStatusEvent(workspace, {
                    status: nextStatus,
                    message: notice ?? statusLabels[nextStatus]
                  }),
                  status: nextStatus,
                  notice
                }
              : workspace
          )
        );
        window.wmux?.socket.respond(
          createSocketSuccessResponse(request.id, { workspaceId: targetWorkspaceId, status: nextStatus, notice })
        );
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
                  notice: undefined,
                  recentEvents: undefined
                }
              : workspace
          )
        );
        window.wmux?.socket.respond(createSocketSuccessResponse(request.id, { workspaceId: targetWorkspaceId, status: "idle" }));
        return;
      }

      if (request.method === "status.list") {
        const params = (request.params ?? {}) as Partial<StatusListParams>;
        const eventLimit =
          typeof params.limit === "number" && Number.isFinite(params.limit) && params.limit > 0
            ? Math.floor(params.limit)
            : undefined;
        const summaries = createWorkspaceSummaries(currentWorkspaces, currentActiveWorkspaceId, eventLimit);
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

      if (request.method === "block.list") {
        const params = (request.params ?? {}) as Partial<BlockListParams>;
        const limit =
          typeof params.limit === "number" && Number.isFinite(params.limit) && params.limit > 0
            ? Math.min(500, Math.floor(params.limit))
            : 50;
        const blocks = [...blockSnapshotsRef.current.values()]
          .filter((block) => !params.surfaceId || block.surfaceId === params.surfaceId)
          .slice(-limit)
          .reverse();
        window.wmux?.socket.respond(createSocketSuccessResponse(request.id, { blocks }));
        return;
      }

      if (request.method === "block.get") {
        const params = (request.params ?? {}) as Partial<BlockGetParams>;
        if (typeof params.blockId !== "string" || !params.blockId.trim()) {
          window.wmux?.socket.respond(createSocketErrorResponse(request.id, "BAD_REQUEST", "block.get 需要 blockId"));
          return;
        }
        const block = blockSnapshotsRef.current.get(params.blockId);
        if (!block) {
          window.wmux?.socket.respond(createSocketErrorResponse(request.id, "NOT_FOUND", "找不到 block", { blockId: params.blockId }));
          return;
        }
        window.wmux?.socket.respond(createSocketSuccessResponse(request.id, { block }));
        return;
      }

      if (request.method === "block.rerun") {
        const params = (request.params ?? {}) as Partial<BlockRerunParams>;
        if (typeof params.blockId !== "string" || !params.blockId.trim()) {
          window.wmux?.socket.respond(createSocketErrorResponse(request.id, "BAD_REQUEST", "block.rerun 需要 blockId"));
          return;
        }
        const block = blockSnapshotsRef.current.get(params.blockId);
        if (!block) {
          window.wmux?.socket.respond(createSocketErrorResponse(request.id, "NOT_FOUND", "找不到 block", { blockId: params.blockId }));
          return;
        }
        window.wmux?.terminal.input({ id: `${block.surfaceId}:${shellProfileRef.current}`, data: block.command });
        window.wmux?.socket.respond(createSocketSuccessResponse(request.id, { blockId: block.id, surfaceId: block.surfaceId }));
        return;
      }

      if (request.method === "ai.explain") {
        const params = (request.params ?? {}) as Partial<{ blockId: string }>;
        if (typeof params.blockId !== "string" || !params.blockId.trim()) {
          window.wmux?.socket.respond(createSocketErrorResponse(request.id, "BAD_REQUEST", "ai.explain 需要 blockId"));
          return;
        }
        const block = blockSnapshotsRef.current.get(params.blockId);
        if (!block) {
          window.wmux?.socket.respond(createSocketErrorResponse(request.id, "NOT_FOUND", "找不到 block", { blockId: params.blockId }));
          return;
        }
        explainBlockWithAi(block);
        window.wmux?.socket.respond(createSocketSuccessResponse(request.id, { blockId: block.id, surfaceId: block.surfaceId }));
        return;
      }

      if (request.method === "ai.suggest") {
        const params = (request.params ?? {}) as Partial<{ prompt: string; surfaceId?: string }>;
        if (typeof params.prompt !== "string" || !params.prompt.trim()) {
          window.wmux?.socket.respond(createSocketErrorResponse(request.id, "BAD_REQUEST", "ai.suggest 需要 prompt"));
          return;
        }
        const terminalSurface = getActiveTerminalSurface(currentWorkspace, params.surfaceId);
        if (!terminalSurface) {
          window.wmux?.socket.respond(createSocketErrorResponse(request.id, "NOT_FOUND", "当前 workspace 没有 terminal surface"));
          return;
        }
        requestAiCommandSuggestions({
          prompt: params.prompt,
          surfaceId: terminalSurface.id,
          cwd: currentWorkspace.cwd,
          shell: shellProfileRef.current
        });
        window.wmux?.socket.respond(createSocketSuccessResponse(request.id, { surfaceId: terminalSurface.id }));
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

      return attachSurfaceToPane(workspace, paneId, pane, surface);
    });
  };

  const handleAddBrowserSurface = (paneId: string): void => {
    updateActiveWorkspace((workspace) => {
      const pane = workspace.panes[paneId];
      const surface = createBrowserSurface();

      return attachSurfaceToPane(workspace, paneId, pane, surface);
    });
  };

  const handleAddNotebookSurface = (paneId: string): void => {
    updateActiveWorkspace((workspace) => {
      const pane = workspace.panes[paneId];
      const surface = createNotebookSurface({ number: nextSurfaceNumber++ });

      return attachSurfaceToPane(workspace, paneId, pane, surface);
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

  const handleUpdateSurfaceStatus = (surfaceId: string, status: WorkspaceStatus, subtitle?: string): void => {
    setWorkspaces((currentWorkspaces) =>
      currentWorkspaces.map((workspace) => {
        const surface = workspace.surfaces[surfaceId];
        if (!surface) {
          return workspace;
        }
        if (surface.status === status && (subtitle === undefined || surface.subtitle === subtitle)) {
          return workspace;
        }

        return {
          ...workspace,
          surfaces: {
            ...workspace.surfaces,
            [surfaceId]: {
              ...surface,
              status,
              subtitle: subtitle ?? surface.subtitle
            }
          }
        };
      })
    );
  };

  const handleTerminalOutput = (surfaceId: string, output: string): void => {
    const previousOutput = terminalOutputBuffersRef.current.get(surfaceId) ?? "";
    const recentOutput = `${previousOutput}${output}`.slice(-1200);
    terminalOutputBuffersRef.current.set(surfaceId, recentOutput);

    const attentionPrompt = detectTerminalAttentionPrompt(recentOutput);
    if (!attentionPrompt) {
      return;
    }
    terminalOutputBuffersRef.current.set(surfaceId, "");

    setWorkspaces((currentWorkspaces) =>
      currentWorkspaces.map((workspace) => {
        const surface = workspace.surfaces[surfaceId];
        if (!surface || workspace.notice === attentionPrompt.message) {
          return workspace;
        }

        return {
          ...withWorkspaceStatusEvent(workspace, {
            status: "attention",
            message: attentionPrompt.message
          }),
          status: "attention",
          notice: attentionPrompt.message
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

  // Cmd+1~8：直接跳到第 N 个 workspace（cmux 高频快捷键）
  const handleSelectWorkspaceByIndex = (index: number): void => {
    if (index < 0 || index >= workspaces.length) {
      return;
    }
    setActiveWorkspaceId(workspaces[index].id);
  };

  // Cmd+Shift+U：跳到最新未读通知的 workspace
  const handleJumpToLatestNotification = (): void => {
    let latestAt = "";
    let latestId: string | null = null;
    for (const workspace of workspaces) {
      const firstEvent = workspace.recentEvents?.[0];
      if (firstEvent && firstEvent.at > latestAt) {
        latestAt = firstEvent.at;
        latestId = workspace.id;
      } else if (!firstEvent && workspace.notice && !latestId) {
        // 没有事件时间戳但仍有通知文本：兜底选第一个
        latestId = workspace.id;
      }
    }
    if (latestId) {
      setActiveWorkspaceId(latestId);
    }
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

  const paletteCommands = buildPaletteCommands();
  paletteCommandsRef.current = paletteCommands;
  const filteredCommands = rankPaletteCommands(paletteCommands, commandQuery, {
    recentUsage: paletteRecentUsage
  });
  const historySearch = searchBlockHistory([...blockSnapshotsRef.current.values()], historyQuery, {
    includeOutput: false,
    limit: 80
  });
  const normalizedSelectedCommandIndex = filteredCommands.length
    ? Math.min(selectedCommandIndex, filteredCommands.length - 1)
    : 0;
  const normalizedSelectedHistoryIndex = historySearch.results.length
    ? Math.min(selectedHistoryIndex, historySearch.results.length - 1)
    : 0;

  useEffect(() => {
    if (selectedCommandIndex > normalizedSelectedCommandIndex) {
      setSelectedCommandIndex(normalizedSelectedCommandIndex);
    }
  }, [normalizedSelectedCommandIndex, selectedCommandIndex]);

  useEffect(() => {
    if (selectedHistoryIndex > normalizedSelectedHistoryIndex) {
      setSelectedHistoryIndex(normalizedSelectedHistoryIndex);
    }
  }, [normalizedSelectedHistoryIndex, selectedHistoryIndex]);

  const runPaletteCommand = (command: PaletteCommand): void => {
    const nextUsage = recordRecentCommandUsage(paletteRecentUsageRef.current, command.id);
    setPaletteRecentUsage(nextUsage);
    paletteRecentUsageRef.current = nextUsage;
    void Promise.resolve(command.run()).finally(() => {
      if (!command.id.startsWith("project:") || command.category === "workflow") {
        closeCommandPalette();
      }
    });
  };
  runPaletteCommandRef.current = runPaletteCommand;

  useEffect(() => {
    const handleGlobalKeyDown = (event: KeyboardEvent): void => {
      const key = event.key.toLowerCase();
      const isPrimary = event.ctrlKey || event.metaKey;
      const isPlain = !event.ctrlKey && !event.metaKey && !event.altKey;
      const targetElement = event.target instanceof HTMLElement ? event.target : null;

      if (isPrimary && (key === "k" || key === "p")) {
        event.preventDefault();
        openCommandPalette();
        return;
      }

      if (isPrimary && !event.altKey && !event.shiftKey && key === "r") {
        event.preventDefault();
        openHistorySearch();
        return;
      }

      // Ctrl/Cmd+1~8：跳转到对应序号的 workspace（cmux 高频快捷键）
      if (isPrimary && !event.altKey && !event.shiftKey && /^[1-8]$/.test(event.key)) {
        event.preventDefault();
        handleSelectWorkspaceByIndex(Number(event.key) - 1);
        return;
      }

      // Ctrl/Cmd+Shift+U：跳到最新有未读通知的 workspace
      if (isPrimary && event.shiftKey && key === "u") {
        event.preventDefault();
        handleJumpToLatestNotification();
        return;
      }

      // Ctrl/Cmd+F：仅当活动 surface 是终端时打开 FindBar；终端聚焦时由 xterm customKeyEventHandler 处理
      if (isPrimary && !event.altKey && !event.shiftKey && key === "f") {
        const targetSurface = getActiveTerminalSurface(activeWorkspace);
        if (targetSurface) {
          event.preventDefault();
          openFindBar();
          return;
        }
      }

      if (
        isPrimary &&
        !event.altKey &&
        !event.shiftKey &&
        key === "w" &&
        !targetElement?.closest(".terminalHost")
      ) {
        event.preventDefault();
        handleCloseActiveSurface();
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

      if (isPrimary && event.shiftKey && (key === "m" || key === "o")) {
        event.preventDefault();
        handleAddNotebookSurface(activeWorkspace.activePaneId);
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

    };

    window.addEventListener("keydown", handleGlobalKeyDown);
    return () => window.removeEventListener("keydown", handleGlobalKeyDown);
    // 全局快捷键绑定依赖当前渲染态，保持这个边界便于集中审计快捷键行为。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeWorkspace, activeWorkspaceId, workspaces, workspaceNameDraft, editingWorkspaceId]);

  return (
    <main className="appShell" onContextMenu={handleEditableContextMenu}>
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
        onOpenPullRequest={handleOpenTerminalUrl}
        appUpdateStatus={appUpdateStatus}
        onInstallUpdate={handleInstallUpdate}
        onCheckForUpdate={handleCheckForUpdate}
        settingsOpen={settingsOpen}
        notificationsOpen={notificationsOpen}
        securityModeDraft={securityModeDraft}
        securitySettings={securitySettings}
        aiSettings={aiSettings}
        aiSettingsDraft={aiSettingsDraft}
        themes={availableThemes}
        activeThemeId={activeTheme.id}
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
        onAiSettingsDraftChange={setAiSettingsDraft}
        onSaveAiSettings={handleSaveAiSettings}
        onSelectTheme={handleSelectTheme}
        onImportTheme={handleImportTheme}
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
          onAddNotebook={() => handleAddNotebookSurface(activeWorkspace.activePaneId)}
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
            onAddNotebookSurface={handleAddNotebookSurface}
            onSelectSurface={handleSelectSurface}
            onCloseSurface={handleCloseSurface}
            onActivatePane={(paneId) =>
              updateActiveWorkspace((workspace) =>
                workspace.activePaneId === paneId ? workspace : { ...workspace, activePaneId: paneId }
              )
            }
            onResizeSplit={handleResizeSplit}
            onClosePane={handleClosePane}
            onDropSurfaceToPane={handleDropSurfaceToPane}
            onUpdateSurfaceSubtitle={handleUpdateSurfaceSubtitle}
            onUpdateSurfaceStatus={handleUpdateSurfaceStatus}
            onOpenTerminalUrl={handleOpenTerminalUrl}
            onTerminalOutput={handleTerminalOutput}
            aiSettings={aiSettings}
            terminalTheme={activeTheme.terminal}
            onExplainBlock={explainBlockWithAi}
            onAiSuggest={requestAiCommandSuggestions}
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
        onRun={runPaletteCommand}
        onSelectedIndexChange={setSelectedCommandIndex}
      />
      <FindBar
        isOpen={findBarOpen}
        query={findQuery}
        caseSensitive={findCaseSensitive}
        regex={findRegex}
        resultIndex={findResultIndex}
        resultCount={findResultCount}
        onQueryChange={setFindQuery}
        onCaseSensitiveChange={setFindCaseSensitive}
        onRegexChange={setFindRegex}
        onFindNext={(query) => findInActiveTerminal("next", query)}
        onFindPrevious={(query) => findInActiveTerminal("previous", query)}
        onClose={closeFindBar}
      />
      <HistorySearch
        isOpen={historySearchOpen}
        query={historyQuery}
        parsedQuery={historySearch.query}
        results={historySearch.results}
        selectedIndex={normalizedSelectedHistoryIndex}
        onClose={closeHistorySearch}
        onQueryChange={setHistoryQuery}
        onSelectedIndexChange={setSelectedHistoryIndex}
        onRun={(block, mode) => runHistoryCommand(block, mode)}
      />
      {aiExplainState && (
        <div className="aiExplainOverlay" role="presentation">
          <AiExplainPanel
            block={aiExplainState.block}
            text={aiExplainState.text}
            status={aiExplainState.status}
            error={aiExplainState.error}
            suggestions={readAiSuggestions(aiExplainState.text)}
            onCancel={() => cancelAiRequest(aiExplainState.requestId)}
            onClose={() => setAiExplainState(null)}
            onInsertCommand={(command) => writeCommandToActiveTerminalDraft(command, "AI fix")}
            onCopy={(text) => window.wmux?.clipboard.writeText(text)}
          />
        </div>
      )}
      <ProjectCommandConfirmDialog
        confirmation={pendingCommandConfirmation}
        configPath={pendingCommandConfirmation?.command.sourcePath ?? projectConfig?.path}
        onCancel={() => setPendingCommandConfirmation(null)}
        onConfirm={confirmProjectCommand}
      />
      <ArgsPromptDialog
        command={pendingWorkflowCommand?.command ?? null}
        values={pendingWorkflowCommand?.values ?? {}}
        onCancel={closeWorkflowPrompt}
        onConfirm={confirmWorkflowCommand}
        onValueChange={updateWorkflowArgValue}
      />
    </main>
  );
}

function ProjectCommandConfirmDialog({
  confirmation,
  configPath,
  onCancel,
  onConfirm
}: {
  confirmation: PendingProjectCommandConfirmation | null;
  configPath?: string;
  onCancel: () => void;
  onConfirm: () => void;
}): ReactElement | null {
  if (!confirmation) {
    return null;
  }

  const isRestart = confirmation.reason === "restart";
  const title = isRestart ? "Recreate workspace?" : "Run project command?";
  const description = isRestart
    ? `${confirmation.command.name} already has a matching workspace. Recreate it from wmux.json?`
    : confirmation.command.name;
  const actionLabel = isRestart ? "Recreate workspace" : "Run project command";

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
          <h2>{title}</h2>
        </div>
        <p>{description}</p>
        <p className="confirmDialogMeta">{configPath ?? "wmux.json"}</p>
        <div className="confirmDialogActions">
          <button className="toolbarButton" type="button" onClick={onCancel}>
            Cancel
          </button>
          <button className="commandButton" type="button" onClick={onConfirm}>
            {actionLabel}
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
  commands: PaletteCommand[];
  configError?: string;
  configStatus: string;
  isOpen: boolean;
  query: string;
  selectedIndex: number;
  onClose: () => void;
  onQueryChange: (value: string) => void;
  onRun: (command: PaletteCommand) => void;
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
            placeholder="搜索 workspace、surface、命令和块"
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
            commands.map((command, index) => {
              const previousCategory = commands[index - 1]?.category;
              const showHeader = previousCategory !== command.category;
              return (
                <div className="commandPaletteGroup" key={command.id}>
                  {showHeader && <div className="commandPaletteSectionHeader">{getPaletteCategoryLabel(command.category)}</div>}
                  <button
                    className={`commandPaletteItem ${index === selectedIndex ? "commandPaletteItemActive" : ""}`}
                    type="button"
                    role="option"
                    aria-selected={index === selectedIndex}
                    onMouseEnter={() => onSelectedIndexChange(index)}
                    onClick={() => onRun(command)}
                  >
                    <span className="commandPaletteItemIcon">
                      {command.category === "workspace" ? (
                        <LayoutGrid size={16} />
                      ) : command.category === "settings" ? (
                        <Settings size={16} />
                      ) : command.category === "block" ? (
                        <Activity size={16} />
                    ) : command.icon === "notebook" ? (
                      <BookOpen size={16} />
                    ) : command.category === "workflow" || command.icon === "workflow" ? (
                      <ScrollText size={16} />
                      ) : command.icon === "workspace" ? (
                        <LayoutGrid size={16} />
                      ) : (
                        <Terminal size={16} />
                      )}
                    </span>
                    <span className="commandPaletteItemMain">
                      <span className="commandPaletteItemTitle">{command.title}</span>
                      <span className="commandPaletteItemDescription">
                        {command.subtitle ?? "wmux command"}
                      </span>
                    </span>
                    <span className="commandPaletteItemMeta">{command.shortcut ?? getPaletteCategoryLabel(command.category)}</span>
                  </button>
                </div>
              );
            })
          ) : (
            <div className="commandPaletteEmpty">没有匹配的命令</div>
          )}
        </div>
      </section>
    </div>
  );
}

function FindBar({
  isOpen,
  query,
  caseSensitive,
  regex,
  resultIndex,
  resultCount,
  onQueryChange,
  onCaseSensitiveChange,
  onRegexChange,
  onFindNext,
  onFindPrevious,
  onClose
}: {
  isOpen: boolean;
  query: string;
  caseSensitive: boolean;
  regex: boolean;
  resultIndex: number;
  resultCount: number;
  onQueryChange: (value: string) => void;
  onCaseSensitiveChange: (value: boolean) => void;
  onRegexChange: (value: boolean) => void;
  onFindNext: (query: string) => void;
  onFindPrevious: (query: string) => void;
  onClose: () => void;
}): ReactElement | null {
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    window.setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 0);
  }, [isOpen]);

  // 输入或选项变化时立即重新查找当前匹配
  useEffect(() => {
    if (!isOpen) {
      return;
    }
    if (query.trim()) {
      onFindNext(query);
    }
    // onFindNext 的引用每次重新生成，但实际行为受 caseSensitive/regex 影响，所以入参覆盖即可
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, query, caseSensitive, regex]);

  if (!isOpen) {
    return null;
  }

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      if (event.shiftKey) {
        onFindPrevious(query);
      } else {
        onFindNext(query);
      }
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "g") {
      event.preventDefault();
      if (event.shiftKey) {
        onFindPrevious(query);
      } else {
        onFindNext(query);
      }
    }
  };

  const counterText = query.trim()
    ? resultCount > 0
      ? `${resultIndex + 1}/${resultCount}`
      : "0/0"
    : "";

  return (
    <div className="findBar" role="dialog" aria-label="终端搜索">
      <Search size={14} />
      <input
        ref={inputRef}
        type="text"
        className="findBarInput"
        value={query}
        placeholder="在终端中查找..."
        aria-label="终端搜索输入"
        onChange={(event) => onQueryChange(event.target.value)}
        onKeyDown={handleKeyDown}
      />
      <span className="findBarCounter" aria-live="polite">{counterText}</span>
      <button
        type="button"
        className={`findBarToggle ${caseSensitive ? "findBarToggleActive" : ""}`}
        title="区分大小写"
        aria-label="区分大小写"
        aria-pressed={caseSensitive}
        onClick={() => onCaseSensitiveChange(!caseSensitive)}
      >
        Aa
      </button>
      <button
        type="button"
        className={`findBarToggle ${regex ? "findBarToggleActive" : ""}`}
        title="正则表达式"
        aria-label="正则表达式"
        aria-pressed={regex}
        onClick={() => onRegexChange(!regex)}
      >
        .*
      </button>
      <button
        type="button"
        className="iconButton"
        title="上一个匹配 (Shift+Enter)"
        aria-label="上一个匹配"
        onClick={() => onFindPrevious(query)}
      >
        <ChevronLeft size={14} />
      </button>
      <button
        type="button"
        className="iconButton"
        title="下一个匹配 (Enter)"
        aria-label="下一个匹配"
        onClick={() => onFindNext(query)}
      >
        <ChevronRight size={14} />
      </button>
      <button
        type="button"
        className="iconButton"
        title="关闭 (Esc)"
        aria-label="关闭搜索"
        onClick={onClose}
      >
        <X size={14} />
      </button>
    </div>
  );
}

function UpdateBanner({
  status,
  onInstall,
  onCheck
}: {
  status: AppUpdateStatus;
  onInstall: () => void;
  onCheck: () => void;
}): ReactElement | null {
  if (status.state === "idle") {
    return null;
  }

  let label: string;
  let actionLabel: string | null = null;
  let actionHandler: (() => void) | null = null;
  let dismissible = false;

  switch (status.state) {
    case "checking":
      label = "Checking for updates…";
      break;
    case "available":
      label = status.version ? `Downloading update v${status.version}…` : "Downloading update…";
      break;
    case "downloading":
      label =
        typeof status.progress === "number"
          ? `Downloading update… ${status.progress}%`
          : "Downloading update…";
      break;
    case "downloaded":
      label = status.version ? `Update v${status.version} ready` : "Update ready";
      actionLabel = "Restart";
      actionHandler = onInstall;
      break;
    case "not-available":
      label = "wmux is up to date";
      dismissible = true;
      break;
    case "error":
      label = status.error ? `Update failed: ${status.error}` : "Update failed";
      actionLabel = "Retry";
      actionHandler = onCheck;
      break;
    default:
      return null;
  }

  return (
    <div className={`updateBanner updateBanner-${status.state}`} role="status">
      <span className="updateBannerLabel">{label}</span>
      {actionLabel && actionHandler && (
        <button
          className="updateBannerAction"
          type="button"
          onClick={actionHandler}
        >
          {actionLabel}
        </button>
      )}
      {dismissible && <span className="updateBannerHint">·</span>}
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
  onOpenPullRequest,
  appUpdateStatus,
  onInstallUpdate,
  onCheckForUpdate,
  settingsOpen,
  notificationsOpen,
  securityModeDraft,
  securitySettings,
  aiSettings,
  aiSettingsDraft,
  themes,
  activeThemeId,
  onToggleNotifications,
  onToggleSettings,
  onSecurityModeDraftChange,
  onSaveSecurityMode,
  onAiSettingsDraftChange,
  onSaveAiSettings,
  onSelectTheme,
  onImportTheme
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
  onOpenPullRequest: (url: string) => void;
  appUpdateStatus: AppUpdateStatus;
  onInstallUpdate: () => void;
  onCheckForUpdate: () => void;
  settingsOpen: boolean;
  notificationsOpen: boolean;
  securityModeDraft: SocketSecurityMode;
  securitySettings: SocketSecuritySettings | null;
  aiSettings: AiSettings;
  aiSettingsDraft: AiSettings;
  themes: WmuxTheme[];
  activeThemeId: string;
  onToggleNotifications: () => void;
  onToggleSettings: () => void;
  onSecurityModeDraftChange: (mode: SocketSecurityMode) => void;
  onSaveSecurityMode: () => void;
  onAiSettingsDraftChange: (settings: AiSettings) => void;
  onSaveAiSettings: () => void;
  onSelectTheme: (themeId: string) => void;
  onImportTheme: (content: string) => ThemeImportResult;
}): ReactElement {
  const notificationItems = workspaces.filter((workspace) =>
    Boolean(workspace.notice || workspace.recentEvents?.length)
  );

  return (
    <aside className="sidebar">
      <UpdateBanner
        status={appUpdateStatus}
        onInstall={onInstallUpdate}
        onCheck={onCheckForUpdate}
      />
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
        <kbd>⌘P</kbd>
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
          const unreadCount = getWorkspaceUnreadCount(workspace);
          const pullRequest = workspace.pullRequest;
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
                      {unreadCount > 0 && (
                        <span
                          className="workspaceUnreadBadge"
                          aria-label={`${unreadCount} unread notification${unreadCount === 1 ? "" : "s"}`}
                        >
                          {unreadCount > 9 ? "9+" : unreadCount}
                        </span>
                      )}
                    </span>
                    <span className="workspacePath">{workspace.cwd}</span>
                    <span className="workspaceMeta">
                      {workspace.branch && (
                        <span className="metaPill">
                          <GitBranch size={12} />
                          {workspace.branch}
                        </span>
                      )}
                      {pullRequest && (
                        <span
                          className={`metaPill metaPillPr metaPillPr-${pullRequest.state}${
                            pullRequest.url ? " metaPillPrInteractive" : ""
                          }`}
                          title={pullRequest.title ?? `PR #${pullRequest.number}`}
                          {...(pullRequest.url
                            ? {
                                role: "link",
                                tabIndex: 0,
                                onClick: (event: ReactMouseEvent) => {
                                  event.preventDefault();
                                  event.stopPropagation();
                                  onOpenPullRequest(pullRequest.url!);
                                },
                                onKeyDown: (event: ReactKeyboardEvent) => {
                                  if (event.key === "Enter" || event.key === " ") {
                                    event.preventDefault();
                                    event.stopPropagation();
                                    onOpenPullRequest(pullRequest.url!);
                                  }
                                }
                              }
                            : {})}
                        >
                          <GitPullRequest size={12} />
                          {`#${pullRequest.number} ${pullRequest.state}`}
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
                    {unreadCount > 0 && (
                      <span
                        className="workspaceUnreadBadge"
                        aria-label={`${unreadCount} unread notification${unreadCount === 1 ? "" : "s"}`}
                      >
                        {unreadCount > 9 ? "9+" : unreadCount}
                      </span>
                    )}
                  </span>
                  <span className="workspacePath">{workspace.cwd}</span>
                  <span className="workspaceMeta">
                    {workspace.branch && (
                      <span className="metaPill">
                        <GitBranch size={12} />
                        {workspace.branch}
                      </span>
                    )}
                    {pullRequest && (
                      <span
                        className={`metaPill metaPillPr metaPillPr-${pullRequest.state}${
                          pullRequest.url ? " metaPillPrInteractive" : ""
                        }`}
                        title={pullRequest.title ?? `PR #${pullRequest.number}`}
                        {...(pullRequest.url
                          ? {
                              role: "link",
                              tabIndex: 0,
                              onClick: (event: ReactMouseEvent) => {
                                event.preventDefault();
                                event.stopPropagation();
                                onOpenPullRequest(pullRequest.url!);
                              },
                              onKeyDown: (event: ReactKeyboardEvent) => {
                                if (event.key === "Enter" || event.key === " ") {
                                  event.preventDefault();
                                  event.stopPropagation();
                                  onOpenPullRequest(pullRequest.url!);
                                }
                              }
                            }
                          : {})}
                      >
                        <GitPullRequest size={12} />
                        {`#${pullRequest.number} ${pullRequest.state}`}
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
          className={`utilityButton ${notificationsOpen ? "utilityButtonActive" : ""}`}
          type="button"
          aria-label="Notifications"
          aria-expanded={notificationsOpen}
          onClick={onToggleNotifications}
        >
          <Bell size={14} />
          <span>Notifications</span>
          <span className="utilityCount">{notificationItems.length}</span>
        </button>
        {notificationsOpen && (
          <div className="notificationPanel" aria-label="Notifications panel">
            {notificationItems.length ? (
              notificationItems.map((workspace) => {
                const recentEvents = workspace.recentEvents ?? [];
                const primaryText = workspace.notice ?? recentEvents[0]?.message ?? statusLabels[workspace.status];
                const historyItems = recentEvents.slice(1);

                return (
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
                      <span className="notificationText">{primaryText}</span>
                      {historyItems.length > 0 && (
                        <span className="notificationHistory" aria-label={`Recent events ${workspace.name}`}>
                          {historyItems.map((event) => (
                            <span className="notificationHistoryItem" key={event.id}>
                              <span className={`historyDot ${statusClass[event.status]}`} />
                              <span className="notificationHistoryText">{event.message}</span>
                            </span>
                          ))}
                        </span>
                      )}
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
                );
              })
            ) : (
              <div className="notificationEmpty">No workspace notifications</div>
            )}
          </div>
        )}
        <button
          className={`utilityButton ${settingsOpen ? "utilityButtonActive" : ""}`}
          type="button"
          aria-label="Settings"
          aria-expanded={settingsOpen}
          onClick={onToggleSettings}
        >
          <Settings size={14} />
          <span>Settings</span>
        </button>
        {settingsOpen && (
          <div className="settingsPanel" aria-label="Settings panel">
            <ThemePicker
              themes={themes}
              selectedThemeId={activeThemeId}
              onSelectTheme={onSelectTheme}
              onImportTheme={onImportTheme}
            />
            <div className="settingsDivider" />
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
            <div className="settingsDivider" />
            <AiSettingsForm
              settings={aiSettings}
              draft={aiSettingsDraft}
              onDraftChange={onAiSettingsDraftChange}
              onSave={onSaveAiSettings}
            />
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
  onAddNotebook,
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
  onAddNotebook: () => void;
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
        <button className="toolbarButton" type="button" aria-label="Notebook" title="New notebook surface" onClick={onAddNotebook}>
          <BookOpen size={15} />
          <span>Notebook</span>
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
  onAddNotebookSurface,
  onSelectSurface,
  onCloseSurface,
  onActivatePane,
  onResizeSplit,
  onClosePane,
  onDropSurfaceToPane,
  onUpdateSurfaceSubtitle,
  onUpdateSurfaceStatus,
  onOpenTerminalUrl,
  onTerminalOutput,
  aiSettings,
  terminalTheme,
  onExplainBlock,
  onAiSuggest
}: {
  workspace: Workspace;
  node: LayoutNode;
  shellProfile: ShellProfile;
  onAddTerminalSurface: (paneId: string) => void;
  onAddNotebookSurface: (paneId: string) => void;
  onSelectSurface: (paneId: string, surfaceId: string) => void;
  onCloseSurface: (paneId: string, surfaceId: string) => void;
  onActivatePane: (paneId: string) => void;
  onResizeSplit: (splitId: string, ratio: number) => void;
  onClosePane: (paneId: string) => void;
  onDropSurfaceToPane: (targetPaneId: string, edge: SplitDropEdge, payload: DraggedSurfacePayload) => void;
  onUpdateSurfaceSubtitle: (surfaceId: string, subtitle: string) => void;
  onUpdateSurfaceStatus: (surfaceId: string, status: WorkspaceStatus, subtitle?: string) => void;
  onOpenTerminalUrl: (url: string) => void;
  onTerminalOutput: (surfaceId: string, output: string) => void;
  aiSettings: AiSettings;
  terminalTheme: TerminalTheme;
  onExplainBlock: (block: Block) => void;
  onAiSuggest: (payload: { prompt: string; surfaceId: string; cwd: string; shell: ShellProfile }) => void;
}): ReactElement {
  if (node.type === "pane") {
    return (
      <PaneView
        workspace={workspace}
        paneId={node.id}
        shellProfile={shellProfile}
        onAddTerminalSurface={onAddTerminalSurface}
        onAddNotebookSurface={onAddNotebookSurface}
        onSelectSurface={onSelectSurface}
        onCloseSurface={onCloseSurface}
        onActivatePane={onActivatePane}
        onClosePane={onClosePane}
        onDropSurfaceToPane={onDropSurfaceToPane}
        onUpdateSurfaceSubtitle={onUpdateSurfaceSubtitle}
        onUpdateSurfaceStatus={onUpdateSurfaceStatus}
        onOpenTerminalUrl={onOpenTerminalUrl}
        onTerminalOutput={onTerminalOutput}
        aiSettings={aiSettings}
        terminalTheme={terminalTheme}
        onExplainBlock={onExplainBlock}
        onAiSuggest={onAiSuggest}
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
        onAddNotebookSurface={onAddNotebookSurface}
        onSelectSurface={onSelectSurface}
        onCloseSurface={onCloseSurface}
        onActivatePane={onActivatePane}
        onResizeSplit={onResizeSplit}
        onClosePane={onClosePane}
        onDropSurfaceToPane={onDropSurfaceToPane}
        onUpdateSurfaceSubtitle={onUpdateSurfaceSubtitle}
        onUpdateSurfaceStatus={onUpdateSurfaceStatus}
        onOpenTerminalUrl={onOpenTerminalUrl}
        onTerminalOutput={onTerminalOutput}
        aiSettings={aiSettings}
        terminalTheme={terminalTheme}
        onExplainBlock={onExplainBlock}
        onAiSuggest={onAiSuggest}
      />
      <SplitHandle node={node} onResizeSplit={onResizeSplit} />
      <LayoutRenderer
        workspace={workspace}
        node={node.children[1]}
        shellProfile={shellProfile}
        onAddTerminalSurface={onAddTerminalSurface}
        onAddNotebookSurface={onAddNotebookSurface}
        onSelectSurface={onSelectSurface}
        onCloseSurface={onCloseSurface}
        onActivatePane={onActivatePane}
        onResizeSplit={onResizeSplit}
        onClosePane={onClosePane}
        onDropSurfaceToPane={onDropSurfaceToPane}
        onUpdateSurfaceSubtitle={onUpdateSurfaceSubtitle}
        onUpdateSurfaceStatus={onUpdateSurfaceStatus}
        onOpenTerminalUrl={onOpenTerminalUrl}
        onTerminalOutput={onTerminalOutput}
        aiSettings={aiSettings}
        terminalTheme={terminalTheme}
        onExplainBlock={onExplainBlock}
        onAiSuggest={onAiSuggest}
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
  onAddNotebookSurface,
  onSelectSurface,
  onCloseSurface,
  onActivatePane,
  onClosePane,
  onDropSurfaceToPane,
  onUpdateSurfaceSubtitle,
  onUpdateSurfaceStatus,
  onOpenTerminalUrl,
  onTerminalOutput,
  aiSettings,
  terminalTheme,
  onExplainBlock,
  onAiSuggest
}: {
  workspace: Workspace;
  paneId: string;
  shellProfile: ShellProfile;
  onAddTerminalSurface: (paneId: string) => void;
  onAddNotebookSurface: (paneId: string) => void;
  onSelectSurface: (paneId: string, surfaceId: string) => void;
  onCloseSurface: (paneId: string, surfaceId: string) => void;
  onActivatePane: (paneId: string) => void;
  onClosePane: (paneId: string) => void;
  onDropSurfaceToPane: (targetPaneId: string, edge: SplitDropEdge, payload: DraggedSurfacePayload) => void;
  onUpdateSurfaceSubtitle: (surfaceId: string, subtitle: string) => void;
  onUpdateSurfaceStatus: (surfaceId: string, status: WorkspaceStatus, subtitle?: string) => void;
  onOpenTerminalUrl: (url: string) => void;
  onTerminalOutput: (surfaceId: string, output: string) => void;
  aiSettings: AiSettings;
  terminalTheme: TerminalTheme;
  onExplainBlock: (block: Block) => void;
  onAiSuggest: (payload: { prompt: string; surfaceId: string; cwd: string; shell: ShellProfile }) => void;
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
        statusInfo={
          activeSurface.type === "terminal"
            ? {
                cwd: workspace.cwd,
                branch: workspace.branch,
                gitDirty: workspace.gitDirty,
                venv: workspace.venv,
                nodeVersion: workspace.nodeVersion
              }
            : null
        }
        onAddTerminal={() => onAddTerminalSurface(paneId)}
        onAddNotebook={() => onAddNotebookSurface(paneId)}
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
              workspaceId={workspace.id}
              cwd={workspace.cwd}
              shellProfile={shellProfile}
              onUpdateSurfaceSubtitle={onUpdateSurfaceSubtitle}
              onUpdateSurfaceStatus={onUpdateSurfaceStatus}
              onOpenTerminalUrl={onOpenTerminalUrl}
              onTerminalOutput={onTerminalOutput}
              aiSettings={aiSettings}
              terminalTheme={terminalTheme}
              onExplainBlock={onExplainBlock}
              onAiSuggest={onAiSuggest}
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
  statusInfo,
  onAddTerminal,
  onAddNotebook,
  onSelect,
  onClose,
  onClosePane,
  onDragSurfaceStart
}: {
  surfaces: Surface[];
  activeSurfaceId: string;
  canClose: boolean;
  statusInfo?: TerminalStatusBarProps | null;
  onAddTerminal: () => void;
  onAddNotebook: () => void;
  onSelect: (surfaceId: string) => void;
  onClose: (surfaceId: string) => void;
  onClosePane: () => void;
  onDragSurfaceStart: (surfaceId: string, event: DragEvent<HTMLButtonElement>) => void;
}): ReactElement {
  return (
    <div className="surfaceTabs">
      {surfaces.map((surface) => {
        const Icon = surface.type === "browser" ? Globe : surface.type === "notebook" ? BookOpen : Terminal;
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
      {statusInfo ? <TerminalStatusBar {...statusInfo} /> : <span className="surfaceTabsSpacer" aria-hidden="true" />}
      <button className="surfaceAdd" type="button" aria-label="Add terminal surface" onClick={onAddTerminal}>
        <Plus size={14} />
      </button>
      <button className="surfaceAdd surfaceAddNotebook" type="button" aria-label="Add notebook surface" onClick={onAddNotebook}>
        <BookOpen size={14} />
      </button>
      <button className="paneCloseButton" type="button" aria-label="Close pane" title="Close pane" onClick={onClosePane}>
        <X size={14} />
      </button>
    </div>
  );
}

function SurfaceBody({
  surface,
  workspaceId,
  cwd,
  shellProfile,
  onUpdateSurfaceSubtitle,
  onUpdateSurfaceStatus,
  onOpenTerminalUrl,
  onTerminalOutput,
  aiSettings,
  terminalTheme,
  onExplainBlock,
  onAiSuggest
}: {
  surface: Surface;
  workspaceId: string;
  cwd: string;
  shellProfile: ShellProfile;
  onUpdateSurfaceSubtitle: (surfaceId: string, subtitle: string) => void;
  onUpdateSurfaceStatus: (surfaceId: string, status: WorkspaceStatus, subtitle?: string) => void;
  onOpenTerminalUrl: (url: string) => void;
  onTerminalOutput: (surfaceId: string, output: string) => void;
  aiSettings: AiSettings;
  terminalTheme: TerminalTheme;
  onExplainBlock: (block: Block) => void;
  onAiSuggest: (payload: { prompt: string; surfaceId: string; cwd: string; shell: ShellProfile }) => void;
}): ReactElement {
  if (surface.type === "browser") {
    return <BrowserSurface surface={surface} onUpdateSurfaceSubtitle={onUpdateSurfaceSubtitle} />;
  }

  if (surface.type === "notebook") {
    return (
      <NotebookSurface
        surface={surface}
        workspaceId={workspaceId}
        cwd={cwd}
        shell={shellProfile}
        onUpdateSurfaceSubtitle={onUpdateSurfaceSubtitle}
        onUpdateSurfaceStatus={onUpdateSurfaceStatus}
      />
    );
  }

  return (
    <TerminalSurface
      surface={surface}
      workspaceId={workspaceId}
      cwd={cwd}
      shell={shellProfile}
      onOpenUrl={onOpenTerminalUrl}
      onOutput={onTerminalOutput}
      aiSettings={aiSettings}
      terminalTheme={terminalTheme}
      onExplainBlock={onExplainBlock}
      onAiSuggest={onAiSuggest}
    />
  );
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
  const consoleEntriesRef = useRef<BrowserConsoleEntry[]>([]);
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
    const webview = webviewRef.current;
    if (!webview) {
      return;
    }

    const pushEntry = (entry: Omit<BrowserConsoleEntry, "id" | "at">): void => {
      const runtime = browserRuntimes.get(surface.id);
      if (!runtime) {
        return;
      }
      appendBrowserConsoleEntry(runtime, entry);
    };
    const handleConsoleMessage = (event: Event): void => {
      const messageEvent = event as BrowserConsoleMessageEvent;
      pushEntry({
        level: normalizeBrowserConsoleLevel(messageEvent.level),
        message: messageEvent.message ?? "",
        source: messageEvent.sourceId,
        line: messageEvent.line,
        url: webview.getURL?.()
      });
    };
    const handleFailLoad = (event: Event): void => {
      const failure = event as BrowserLoadFailureEvent;
      if (isIgnorableBrowserLoadFailure(failure, desiredUrlRef.current)) {
        return;
      }
      pushEntry({
        level: "error",
        message: failure.errorDescription || "browser navigation failed",
        source: "did-fail-load",
        url: failure.validatedURL || webview.getURL?.()
      });
    };

    webview.addEventListener("console-message", handleConsoleMessage);
    webview.addEventListener("did-fail-load", handleFailLoad);

    return () => {
      webview.removeEventListener("console-message", handleConsoleMessage);
      webview.removeEventListener("did-fail-load", handleFailLoad);
    };
  }, [surface.id]);

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

  const waitForBrowserLoadState = useCallback(
    (waitUntil: BrowserWaitUntil, timeoutMs: number): Promise<string> => {
      return new Promise((resolve, reject) => {
        const webview = webviewRef.current;
        if (!webview) {
          reject(createBrowserError("BROWSER_ERROR", "browser webview 尚未就绪", { surfaceId: surface.id }));
          return;
        }
        if (waitUntil === "none") {
          window.setTimeout(() => resolve(webview.getURL?.() ?? url), 0);
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
          if (isIgnorableBrowserLoadFailure(failure, webview.getURL?.() ?? url)) {
            return;
          }
          settle(() =>
            reject(
              createBrowserError("BROWSER_ERROR", failure.errorDescription || "browser load failed", {
                surfaceId: surface.id,
                url: webview.getURL?.() ?? url
              })
            )
          );
        };
        const handleDomContentLoaded = (): void => {
          if (waitUntil === "domcontentloaded") {
            settle(() => resolve(webview.getURL?.() ?? url));
          }
        };
        const handleLoad = (): void => {
          if (waitUntil === "load") {
            settle(() => resolve(webview.getURL?.() ?? url));
          }
        };
        const timer = window.setTimeout(() => {
          settle(() =>
            reject(
              createBrowserError("TIMEOUT", "browser load state timeout", {
                surfaceId: surface.id,
                url: webview.getURL?.() ?? url,
                timeoutMs
              })
            )
          );
        }, timeoutMs);

        webview.addEventListener("did-fail-load", handleFailLoad);
        webview.addEventListener("did-finish-load", handleLoad);
        webview.addEventListener("dom-ready", handleDomContentLoaded);
        executeBrowserJavaScript<boolean>(
          {
            surfaceId: surface.id,
            runtimeId: surface.id,
            webview,
            navigate: navigateBrowserRuntime,
            waitForLoadState: waitForBrowserLoadState,
            consoleEntries: consoleEntriesRef.current
          },
          "document.readyState === 'interactive' || document.readyState === 'complete'",
          Math.min(timeoutMs, 1000)
        )
          .then((ready) => {
            if (ready && waitUntil === "domcontentloaded") {
              settle(() => resolve(webview.getURL?.() ?? url));
            }
          })
          .catch(() => {});
        executeBrowserJavaScript<boolean>(
          {
            surfaceId: surface.id,
            runtimeId: surface.id,
            webview,
            navigate: navigateBrowserRuntime,
            waitForLoadState: waitForBrowserLoadState,
            consoleEntries: consoleEntriesRef.current
          },
          "document.readyState === 'complete'",
          Math.min(timeoutMs, 1000)
        )
          .then((ready) => {
            if (ready && waitUntil === "load") {
              settle(() => resolve(webview.getURL?.() ?? url));
            }
          })
          .catch(() => {});
      });
    },
    [navigateBrowserRuntime, surface.id, url]
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
      navigate: navigateBrowserRuntime,
      waitForLoadState: waitForBrowserLoadState,
      consoleEntries: consoleEntriesRef.current
    });

    return () => {
      const currentRuntime = browserRuntimes.get(surface.id);
      if (currentRuntime?.webview === webview) {
        browserRuntimes.delete(surface.id);
      }
    };
  }, [navigateBrowserRuntime, surface.id, waitForBrowserLoadState]);

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

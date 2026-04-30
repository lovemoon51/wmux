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
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type FormEvent,
  type PointerEvent,
  type ReactElement
} from "react";
import type {
  LayoutNode,
  NotifyParams,
  PersistedAppState,
  SendTextParams,
  ShellProfile,
  ShellProfileOption,
  SocketRpcErrorCode,
  SocketRpcRequest,
  SocketRpcResponse,
  Surface,
  Workspace,
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

type SplitDropEdge = "top" | "right" | "bottom" | "left";

type DraggedSurfacePayload = {
  paneId: string;
  surfaceId: string;
};

const browserSessions = new Map<string, BrowserSessionState>();

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

function createSocketSuccessResponse(id: string, result: unknown): SocketRpcResponse {
  return { id, ok: true, result };
}

function createSocketErrorResponse(
  id: string,
  code: SocketRpcErrorCode,
  message: string
): SocketRpcResponse {
  return { id, ok: false, error: { code, message } };
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

  useEffect(() => {
    void window.wmux?.getVersion().then(setAppVersion).catch(() => setAppVersion("dev"));
    void window.wmux?.terminal
      .listShells()
      .then((options) => {
        setShellOptions(options);
        if (!options.some((option) => option.id === shellProfile)) {
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

  const updateActiveWorkspace = (updater: (workspace: Workspace) => Workspace): void => {
    setWorkspaces((currentWorkspaces) =>
      currentWorkspaces.map((workspace) => (workspace.id === activeWorkspace.id ? updater(workspace) : workspace))
    );
  };

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

      if (request.method === "workspace.list") {
        window.wmux?.socket.respond(
          createSocketSuccessResponse(request.id, {
            workspaces: createWorkspaceSummaries(currentWorkspaces, currentActiveWorkspaceId)
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
      const { [surfaceId]: _closedSurface, ...remainingSurfaces } = workspace.surfaces;

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

        const { [payload.paneId]: _removedPane, ...remainingPanes } = workspace.panes;

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
      const { [paneId]: _closedPane, ...remainingPanes } = workspace.panes;
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
          />
        </div>
      </section>
    </main>
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
  onClose
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
}): ReactElement {
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

      <button className="searchButton" type="button">
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
              <div
                className="workspaceSelect"
                role="button"
                tabIndex={0}
                aria-label={`Open workspace ${workspace.name}`}
                onClick={() => onSelect(workspace.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onSelect(workspace.id);
                  }
                }}
              >
                <span className={`statusRing ${statusClass[workspace.status]}`} />
                <span className="workspaceMain">
                  <span className="workspaceTitleRow">
                    {isEditing ? (
                      <input
                        className="workspaceNameInput"
                        aria-label="Workspace name"
                        value={workspaceNameDraft}
                        autoFocus
                        onChange={(event) => onRenameDraftChange(event.target.value)}
                        onBlur={onCommitRename}
                        onClick={(event) => event.stopPropagation()}
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
                    ) : (
                      <span className="workspaceName">{workspace.name}</span>
                    )}
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
              <div className="workspaceActions">
                <button
                  className="workspaceActionButton"
                  type="button"
                  aria-label={`Rename workspace ${workspace.name}`}
                  title={`Rename ${workspace.name}`}
                  onClick={() => onStartRename(workspace)}
                >
                  <Pencil size={13} />
                </button>
                <button
                  className="workspaceActionButton"
                  type="button"
                  aria-label={`Close workspace ${workspace.name}`}
                  title={`Close ${workspace.name}`}
                  disabled={workspaces.length <= 1}
                  onClick={() => onClose(workspace.id)}
                >
                  <X size={14} />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="sidebarFooter">
        <button className="utilityButton" type="button">
          <Bell size={15} />
          <span>Notifications</span>
        </button>
        <button className="utilityButton" type="button">
          <Settings size={15} />
          <span>Settings</span>
        </button>
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
  onSplitVertical
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
        <button className="commandButton" type="button">
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
  onUpdateSurfaceSubtitle
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
  onUpdateSurfaceSubtitle
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
  onUpdateSurfaceSubtitle
}: {
  surface: Surface;
  cwd: string;
  shellProfile: ShellProfile;
  onUpdateSurfaceSubtitle: (surfaceId: string, subtitle: string) => void;
}): ReactElement {
  if (surface.type === "browser") {
    return <BrowserSurface surface={surface} onUpdateSurfaceSubtitle={onUpdateSurfaceSubtitle} />;
  }

  return <TerminalSurface surface={surface} cwd={cwd} shell={shellProfile} />;
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
  const webviewRef = useRef<any>(null);
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

  const applyBrowserZoom = (): void => {
    if (!webviewReadyRef.current) {
      return;
    }

    const viewportWidth = viewportRef.current?.getBoundingClientRect().width ?? viewportSize?.width ?? 960;
    try {
      webviewRef.current?.setZoomFactor?.(getBrowserAutoZoomFactor(viewportWidth));
    } catch {
      webviewReadyRef.current = false;
    }
  };

  const persistBrowserSession = (nextUrl: string): void => {
    browserSessions.set(surface.id, {
      history: browserHistoryRef.current,
      historyIndex: browserHistoryIndexRef.current,
      url: nextUrl
    });
  };

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
  }, [onUpdateSurfaceSubtitle, surface.id, url, viewportSize?.width]);

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
  }, [viewportSize?.width, url]);

  const navigate = (nextUrl: string): void => {
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
    webviewRef.current?.loadURL?.(normalizedUrl);
  };

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

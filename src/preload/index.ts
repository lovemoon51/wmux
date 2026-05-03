import { clipboard, contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import type {
  AppUpdateStatus,
  AiCancelRequest,
  AiExplainRequest,
  AiSettings,
  AiSettingsUpdate,
  AiStreamEvent,
  AiSuggestRequest,
  BlockEvent,
  CompletionListDirectoryParams,
  CompletionListDirectoryResult,
  CompletionListGitBranchesParams,
  CompletionListGitBranchesResult,
  NotebookLoadParams,
  NotebookLoadResult,
  NotebookSaveParams,
  NotebookSaveResult,
  PersistedAppState,
  ShellProfile,
  ShellProfileOption,
  SocketRpcRequest,
  SocketRpcResponse,
  SocketSecurityMode,
  SocketSecuritySettings,
  TerminalInputModeEvent,
  TerminalNotificationPayload,
  ThemeSettings,
  ThemeSettingsUpdate,
  WmuxProjectConfigResult,
  WorkspaceInspection
} from "../shared/types";

const api = {
  getVersion: (): Promise<string> => ipcRenderer.invoke("app:version"),
  getSecurityState: (): Promise<SocketSecuritySettings> => ipcRenderer.invoke("app:securityState"),
  setSecurityMode: (mode: SocketSecurityMode): Promise<SocketSecuritySettings> =>
    ipcRenderer.invoke("app:setSecurityMode", mode),
  // Smoke 模式标志：自动化测试用 textContent 断言，需禁用 WebGL/Canvas 渲染
  isSmokeMode: (): boolean => process.env.WMUX_SMOKE === "1",
  update: {
    getStatus: (): Promise<AppUpdateStatus> => ipcRenderer.invoke("app:getUpdateStatus"),
    checkForUpdate: (): Promise<AppUpdateStatus> => ipcRenderer.invoke("app:checkForUpdate"),
    install: (): Promise<{ ok: boolean }> => ipcRenderer.invoke("app:installUpdate"),
    onStatus: (callback: (payload: AppUpdateStatus) => void): (() => void) => {
      const listener = (_event: IpcRendererEvent, payload: AppUpdateStatus): void => callback(payload);
      ipcRenderer.on("app:updateStatus", listener);
      return () => ipcRenderer.removeListener("app:updateStatus", listener);
    }
  },
  ai: {
    getSettings: (): Promise<AiSettings> => ipcRenderer.invoke("ai:getSettings"),
    setSettings: (payload: AiSettingsUpdate): Promise<AiSettings> => ipcRenderer.invoke("ai:setSettings", payload),
    explain: (payload: AiExplainRequest): Promise<{ requestId: string; blockId: string }> =>
      ipcRenderer.invoke("ai:explain", payload),
    suggest: (payload: AiSuggestRequest): Promise<{ requestId: string }> => ipcRenderer.invoke("ai:suggest", payload),
    cancel: (payload: AiCancelRequest): Promise<{ ok: true }> => ipcRenderer.invoke("ai:cancel", payload),
    onStream: (callback: (payload: AiStreamEvent) => void): (() => void) => {
      const listener = (_event: IpcRendererEvent, payload: AiStreamEvent): void => callback(payload);
      ipcRenderer.on("ai:stream", listener);
      return () => ipcRenderer.removeListener("ai:stream", listener);
    }
  },
  theme: {
    getSettings: (): Promise<ThemeSettings> => ipcRenderer.invoke("theme:getSettings"),
    setSettings: (payload: ThemeSettingsUpdate): Promise<ThemeSettings> =>
      ipcRenderer.invoke("theme:setSettings", payload)
  },
  config: {
    loadProjectConfig: (): Promise<WmuxProjectConfigResult> => ipcRenderer.invoke("config:loadProjectConfig")
  },
  notebook: {
    load: (payload: NotebookLoadParams): Promise<NotebookLoadResult> => ipcRenderer.invoke("notebook:load", payload),
    save: (payload: NotebookSaveParams): Promise<NotebookSaveResult> => ipcRenderer.invoke("notebook:save", payload)
  },
  workspace: {
    loadState: (): Promise<PersistedAppState | null> => ipcRenderer.invoke("workspace:loadState"),
    saveState: (state: PersistedAppState): Promise<{ ok: true }> => ipcRenderer.invoke("workspace:saveState", state),
    inspectCwd: (cwd: string): Promise<WorkspaceInspection> => ipcRenderer.invoke("workspace:inspectCwd", cwd)
  },
  terminal: {
    listShells: (): Promise<ShellProfileOption[]> => ipcRenderer.invoke("terminal:listShells"),
    create: (payload: {
      id: string;
      surfaceId?: string;
      workspaceId?: string;
      cwd?: string;
      cols?: number;
      rows?: number;
      shell?: ShellProfile;
    }): Promise<{ id: string }> => ipcRenderer.invoke("terminal:create", payload),
    input: (payload: { id: string; data: string }): void => ipcRenderer.send("terminal:input", payload),
    resize: (payload: { id: string; cols: number; rows: number }): void =>
      ipcRenderer.send("terminal:resize", payload),
    dispose: (payload: { id: string }): void => ipcRenderer.send("terminal:dispose", payload),
    onData: (callback: (payload: { id: string; data: string }) => void): (() => void) => {
      const listener = (_event: IpcRendererEvent, payload: { id: string; data: string }): void => callback(payload);
      ipcRenderer.on("terminal:data", listener);
      return () => ipcRenderer.removeListener("terminal:data", listener);
    },
    onExit: (
      callback: (payload: { id: string; exitCode: number; signal?: number }) => void
    ): (() => void) => {
      const listener = (
        _event: IpcRendererEvent,
        payload: { id: string; exitCode: number; signal?: number }
      ): void => callback(payload);
      ipcRenderer.on("terminal:exit", listener);
      return () => ipcRenderer.removeListener("terminal:exit", listener);
    },
    onNotification: (callback: (payload: TerminalNotificationPayload) => void): (() => void) => {
      const listener = (_event: IpcRendererEvent, payload: TerminalNotificationPayload): void => callback(payload);
      ipcRenderer.on("terminal:notification", listener);
      return () => ipcRenderer.removeListener("terminal:notification", listener);
    },
    onBlock: (callback: (payload: BlockEvent) => void): (() => void) => {
      const listener = (_event: IpcRendererEvent, payload: BlockEvent): void => callback(payload);
      ipcRenderer.on("terminal:block", listener);
      return () => ipcRenderer.removeListener("terminal:block", listener);
    },
    onInputMode: (callback: (payload: TerminalInputModeEvent) => void): (() => void) => {
      const listener = (_event: IpcRendererEvent, payload: TerminalInputModeEvent): void => callback(payload);
      ipcRenderer.on("terminal:inputMode", listener);
      return () => ipcRenderer.removeListener("terminal:inputMode", listener);
    }
  },
  browser: {
    writeScreenshot: (payload: { path: string; base64: string; format: "png" | "jpeg" }): Promise<{ path: string; bytes: number }> =>
      ipcRenderer.invoke("browser:writeScreenshot", payload)
  },
  completion: {
    listDirectory: (payload: CompletionListDirectoryParams): Promise<CompletionListDirectoryResult> =>
      ipcRenderer.invoke("completion:listDirectory", payload),
    listGitBranches: (payload: CompletionListGitBranchesParams): Promise<CompletionListGitBranchesResult> =>
      ipcRenderer.invoke("completion:listGitBranches", payload)
  },
  clipboard: {
    readText: (): string => clipboard.readText(),
    writeText: (text: string): void => clipboard.writeText(text)
  },
  socket: {
    getPath: (): string | undefined => process.env.WMUX_SOCKET_PATH,
    onRequest: (callback: (request: SocketRpcRequest) => void): (() => void) => {
      const listener = (_event: IpcRendererEvent, request: SocketRpcRequest): void => callback(request);
      ipcRenderer.on("socket-rpc:request", listener);
      return () => ipcRenderer.removeListener("socket-rpc:request", listener);
    },
    respond: (response: SocketRpcResponse): void => ipcRenderer.send("socket-rpc:response", response)
  }
};

contextBridge.exposeInMainWorld("wmux", api);

export type WmuxApi = typeof api;

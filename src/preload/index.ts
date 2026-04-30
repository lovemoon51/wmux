import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import type {
  PersistedAppState,
  ShellProfile,
  ShellProfileOption,
  SocketRpcRequest,
  SocketRpcResponse,
  SocketSecurityMode,
  SocketSecuritySettings,
  WmuxProjectConfigResult,
  WorkspaceInspection
} from "../shared/types";

const api = {
  getVersion: (): Promise<string> => ipcRenderer.invoke("app:version"),
  getSecurityState: (): Promise<SocketSecuritySettings> => ipcRenderer.invoke("app:securityState"),
  setSecurityMode: (mode: SocketSecurityMode): Promise<SocketSecuritySettings> =>
    ipcRenderer.invoke("app:setSecurityMode", mode),
  config: {
    loadProjectConfig: (): Promise<WmuxProjectConfigResult> => ipcRenderer.invoke("config:loadProjectConfig")
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
    }
  },
  browser: {
    writeScreenshot: (payload: { path: string; base64: string; format: "png" | "jpeg" }): Promise<{ path: string; bytes: number }> =>
      ipcRenderer.invoke("browser:writeScreenshot", payload)
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

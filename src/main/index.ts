import { app, BrowserWindow, ipcMain, nativeTheme, shell } from "electron";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { registerPtyIpc } from "./pty/ptyManager";
import { createRpcError, getDefaultSocketPath, registerSocketRpcServer, type SocketRpcServer } from "./socket/rpcServer";
import type { PersistedAppState, SocketRpcRequest, SocketRpcResponse } from "../shared/types";

const isDev = !app.isPackaged;
const userDataDir = process.env.WMUX_USER_DATA_DIR;
const socketPath = getDefaultSocketPath();
let mainWindow: BrowserWindow | null = null;
let socketRpcServer: SocketRpcServer | null = null;
const pendingRendererRequests = new Map<
  string,
  {
    resolve: (value: unknown) => void;
    reject: (reason?: unknown) => void;
    timer: NodeJS.Timeout;
  }
>();
process.env.WMUX_SOCKET_PATH = socketPath;

if (userDataDir) {
  app.setPath("userData", userDataDir);
} else if (process.env.WMUX_SMOKE === "1") {
  app.setPath("userData", join(tmpdir(), "wmux-smoke"));
}

function getStatePath(): string {
  return join(app.getPath("userData"), "workspace-state.json");
}

function dispatchSocketRequestToRenderer(request: SocketRpcRequest): Promise<unknown> {
  const window = mainWindow;
  if (!window || window.isDestroyed()) {
    return Promise.reject(createRpcError("INVALID_STATE", "主窗口尚未就绪"));
  }

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingRendererRequests.delete(request.id);
      reject(createRpcError("TIMEOUT", "Renderer 处理 socket 请求超时"));
    }, 5000);

    pendingRendererRequests.set(request.id, { resolve, reject, timer });
    window.webContents.send("socket-rpc:request", request);
  });
}

function registerSocketBridgeIpc(): void {
  ipcMain.on("socket-rpc:response", (_event, response: SocketRpcResponse) => {
    const pendingRequest = pendingRendererRequests.get(response.id);
    if (!pendingRequest) {
      return;
    }

    pendingRendererRequests.delete(response.id);
    clearTimeout(pendingRequest.timer);

    if (response.ok) {
      pendingRequest.resolve(response.result);
      return;
    }

    pendingRequest.reject(createRpcError(response.error.code, response.error.message));
  });
}

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 980,
    minHeight: 640,
    title: "wmux",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    backgroundColor: "#0f1115",
    show: false,
    webPreferences: {
      preload: join(__dirname, "../preload/index.mjs"),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true
    }
  });

  mainWindow = window;

  window.on("closed", () => {
    if (mainWindow === window) {
      mainWindow = null;
    }
  });

  window.on("ready-to-show", () => window.show());

  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  if (isDev && process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void window.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

app.whenReady().then(() => {
  nativeTheme.themeSource = "dark";

  ipcMain.handle("app:version", () => app.getVersion());
  ipcMain.handle("workspace:loadState", async (): Promise<PersistedAppState | null> => {
    try {
      return JSON.parse(await readFile(getStatePath(), "utf8")) as PersistedAppState;
    } catch {
      return null;
    }
  });
  ipcMain.handle("workspace:saveState", async (_event, state: PersistedAppState): Promise<{ ok: true }> => {
    await mkdir(app.getPath("userData"), { recursive: true });
    await writeFile(getStatePath(), `${JSON.stringify(state, null, 2)}\n`, "utf8");
    return { ok: true };
  });
  registerPtyIpc();
  registerSocketBridgeIpc();
  void registerSocketRpcServer({ dispatch: dispatchSocketRequestToRenderer, path: socketPath }).then((server) => {
    socketRpcServer = server;
  });

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("before-quit", () => {
  pendingRendererRequests.forEach((request) => {
    clearTimeout(request.timer);
    request.reject(createRpcError("INVALID_STATE", "应用正在退出"));
  });
  pendingRendererRequests.clear();
  void socketRpcServer?.close();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

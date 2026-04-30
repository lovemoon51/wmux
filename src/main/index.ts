import { app, BrowserWindow, ipcMain, nativeTheme, shell } from "electron";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { registerPtyIpc } from "./pty/ptyManager";
import { createRpcError, getDefaultSocketPath, registerSocketRpcServer, type SocketRpcServer } from "./socket/rpcServer";
import type {
  BrowserRpcMethod,
  PersistedAppState,
  SocketRpcRequest,
  SocketRpcResponse,
  WmuxCommandConfig,
  WmuxLayoutConfig,
  WmuxProjectConfig,
  WmuxProjectConfigResult,
  WmuxSurfaceConfig,
  WmuxWorkspaceCommandConfig
} from "../shared/types";

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readOptionalString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

function readOptionalBoolean(record: Record<string, unknown>, key: string): boolean | undefined {
  const value = record[key];
  return typeof value === "boolean" ? value : undefined;
}

function readOptionalKeywords(record: Record<string, unknown>): string[] | undefined {
  const value = record.keywords;
  if (!Array.isArray(value)) {
    return undefined;
  }

  return value
    .filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
    .map((item) => item.trim());
}

function parseSurfaceConfig(value: unknown, errors: string[], context: string): WmuxSurfaceConfig | null {
  if (!isRecord(value)) {
    errors.push(`${context} 必须是 surface 对象`);
    return null;
  }

  if (value.type === "terminal") {
    return {
      type: "terminal",
      name: readOptionalString(value, "name"),
      command: readOptionalString(value, "command"),
      focus: readOptionalBoolean(value, "focus")
    };
  }

  if (value.type === "browser") {
    return {
      type: "browser",
      name: readOptionalString(value, "name"),
      url: readOptionalString(value, "url"),
      focus: readOptionalBoolean(value, "focus")
    };
  }

  errors.push(`${context} 的 type 必须是 terminal 或 browser`);
  return null;
}

function parseLayoutConfig(value: unknown, errors: string[], context: string): WmuxLayoutConfig | null {
  if (!isRecord(value)) {
    errors.push(`${context} 必须是 layout 对象`);
    return null;
  }

  if (isRecord(value.pane)) {
    const surfaces = Array.isArray(value.pane.surfaces) ? value.pane.surfaces : [];
    const parsedSurfaces = surfaces
      .map((surface, index) => parseSurfaceConfig(surface, errors, `${context}.pane.surfaces[${index}]`))
      .filter((surface): surface is WmuxSurfaceConfig => Boolean(surface));

    if (parsedSurfaces.length === 0) {
      errors.push(`${context}.pane 至少需要一个 surface`);
      return null;
    }

    return { pane: { surfaces: parsedSurfaces } };
  }

  if (value.direction === "horizontal" || value.direction === "vertical") {
    if (!Array.isArray(value.children) || value.children.length !== 2) {
      errors.push(`${context}.children 必须包含两个子 layout`);
      return null;
    }

    const firstChild = parseLayoutConfig(value.children[0], errors, `${context}.children[0]`);
    const secondChild = parseLayoutConfig(value.children[1], errors, `${context}.children[1]`);
    if (!firstChild || !secondChild) {
      return null;
    }

    return {
      direction: value.direction,
      split: typeof value.split === "number" ? value.split : undefined,
      children: [firstChild, secondChild]
    };
  }

  errors.push(`${context} 必须是 pane 或 split layout`);
  return null;
}

function parseWorkspaceCommandConfig(
  value: unknown,
  errors: string[],
  context: string
): WmuxWorkspaceCommandConfig | null {
  if (!isRecord(value)) {
    errors.push(`${context} 必须是 workspace 对象`);
    return null;
  }

  const workspace: WmuxWorkspaceCommandConfig = {
    name: readOptionalString(value, "name"),
    cwd: readOptionalString(value, "cwd"),
    color: readOptionalString(value, "color")
  };

  if (value.layout !== undefined) {
    const layout = parseLayoutConfig(value.layout, errors, `${context}.layout`);
    if (layout) {
      workspace.layout = layout;
    }
  }

  return workspace;
}

function parseCommandConfig(value: unknown, errors: string[], index: number): WmuxCommandConfig | null {
  const context = `commands[${index}]`;
  if (!isRecord(value)) {
    errors.push(`${context} 必须是对象`);
    return null;
  }

  const name = readOptionalString(value, "name");
  if (!name) {
    errors.push(`${context}.name 必须是非空字符串`);
    return null;
  }

  const commandText = readOptionalString(value, "command");
  const workspace = value.workspace === undefined ? undefined : parseWorkspaceCommandConfig(value.workspace, errors, `${context}.workspace`);
  if (!commandText && !workspace) {
    errors.push(`${context} 必须提供 command 或 workspace`);
    return null;
  }

  return {
    name,
    description: readOptionalString(value, "description"),
    keywords: readOptionalKeywords(value),
    restart:
      value.restart === "ignore" || value.restart === "recreate" || value.restart === "confirm" ? value.restart : undefined,
    command: commandText,
    confirm: readOptionalBoolean(value, "confirm"),
    workspace: workspace ?? undefined
  };
}

function parseProjectConfig(value: unknown): { config: WmuxProjectConfig; errors: string[] } {
  const errors: string[] = [];
  if (!isRecord(value)) {
    return { config: { commands: [] }, errors: ["wmux.json 根节点必须是对象"] };
  }

  if (!Array.isArray(value.commands)) {
    return { config: { commands: [] }, errors: ["wmux.json 必须包含 commands 数组"] };
  }

  const commands = value.commands
    .map((command, index) => parseCommandConfig(command, errors, index))
    .filter((command): command is WmuxCommandConfig => Boolean(command));

  return { config: { commands }, errors };
}

async function loadProjectConfig(): Promise<WmuxProjectConfigResult> {
  const configPath = join(process.cwd(), "wmux.json");

  try {
    const rawConfig = await readFile(configPath, "utf8");
    const parsedConfig = parseProjectConfig(JSON.parse(rawConfig));
    return {
      path: configPath,
      found: true,
      config: parsedConfig.config,
      errors: parsedConfig.errors
    };
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code === "ENOENT") {
      return {
        path: configPath,
        found: false,
        config: { commands: [] },
        errors: []
      };
    }

    return {
      path: configPath,
      found: true,
      config: { commands: [] },
      errors: [`读取 wmux.json 失败：${error instanceof Error ? error.message : String(error)}`]
    };
  }
}

function dispatchSocketRequestToRenderer(request: SocketRpcRequest): Promise<unknown> {
  const window = mainWindow;
  if (!window || window.isDestroyed()) {
    return Promise.reject(createRpcError("INVALID_STATE", "主窗口尚未就绪"));
  }

  return new Promise((resolve, reject) => {
    const timeoutMs = getRendererBridgeTimeoutMs(request);
    const timer = setTimeout(() => {
      pendingRendererRequests.delete(request.id);
      reject(createRpcError("TIMEOUT", `Renderer bridge timeout after ${timeoutMs}ms`));
    }, timeoutMs);

    pendingRendererRequests.set(request.id, { resolve, reject, timer });
    window.webContents.send("socket-rpc:request", request);
  });
}

function getRendererBridgeTimeoutMs(request: SocketRpcRequest): number {
  if (!isBrowserRpcMethod(request.method)) {
    return 5000;
  }

  const params = isRecord(request.params) ? request.params : {};
  const requestedTimeout = typeof params.timeoutMs === "number" ? params.timeoutMs : getBrowserMethodDefaultTimeoutMs(request.method);
  return Math.max(requestedTimeout + 1000, 5000);
}

function isBrowserRpcMethod(method: string): method is BrowserRpcMethod {
  return (
    method === "browser.navigate" ||
    method === "browser.click" ||
    method === "browser.fill" ||
    method === "browser.eval" ||
    method === "browser.snapshot" ||
    method === "browser.screenshot"
  );
}

function getBrowserMethodDefaultTimeoutMs(method: BrowserRpcMethod): number {
  if (method === "browser.navigate" || method === "browser.screenshot") {
    return 10000;
  }

  return 5000;
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
  ipcMain.handle("config:loadProjectConfig", () => loadProjectConfig());
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
  ipcMain.handle(
    "browser:writeScreenshot",
    async (_event, payload: { path: string; base64: string; format: "png" | "jpeg" }): Promise<{ path: string; bytes: number }> => {
      const outputPath = resolve(payload.path);
      const bytes = Buffer.from(payload.base64, "base64");
      await mkdir(dirname(outputPath), { recursive: true });
      await writeFile(outputPath, bytes);
      return { path: outputPath, bytes: bytes.byteLength };
    }
  );
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

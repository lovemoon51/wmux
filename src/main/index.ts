import { app, BrowserWindow, ipcMain, nativeTheme, shell } from "electron";
import { randomBytes } from "node:crypto";
import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { homedir, tmpdir } from "node:os";
import { promisify } from "node:util";
import { registerPtyIpc } from "./pty/ptyManager";
import {
  createRpcError,
  getDefaultSocketPath,
  registerSocketRpcServer,
  type SocketRpcServer
} from "./socket/rpcServer";
import type {
  BrowserRpcMethod,
  PersistedAppState,
  SocketSecurityMode,
  SocketSecuritySettings,
  SocketRpcRequest,
  SocketRpcResponse,
  WmuxCommandConfig,
  WmuxConfigSource,
  WmuxConfigSourceKind,
  WmuxLayoutConfig,
  WmuxProjectConfig,
  WmuxProjectConfigResult,
  WmuxSurfaceConfig,
  WmuxWorkspaceCommandConfig,
  WorkspaceInspection
} from "../shared/types";

const isDev = !app.isPackaged;
const execFileAsync = promisify(execFile);
const userDataDir = process.env.WMUX_USER_DATA_DIR;
if (userDataDir) {
  app.setPath("userData", userDataDir);
} else if (process.env.WMUX_SMOKE === "1") {
  app.setPath("userData", join(tmpdir(), "wmux-smoke"));
}

const socketPath = getDefaultSocketPath();
const socketSecurityMode = readSocketSecurityMode();
const socketToken = process.env.WMUX_SOCKET_TOKEN || randomBytes(32).toString("hex");
const socketAllowAllWarning = "WMUX_SECURITY_MODE=allowAll: local socket accepts requests without token.";
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
process.env.WMUX_SOCKET_TOKEN = socketToken;
process.env.WMUX_SECURITY_MODE = socketSecurityMode;

function getStatePath(): string {
  return join(app.getPath("userData"), "workspace-state.json");
}

function getSettingsPath(): string {
  return join(app.getPath("userData"), "settings.json");
}

function isSocketSecurityMode(value: unknown): value is SocketSecurityMode {
  return value === "off" || value === "wmuxOnly" || value === "token" || value === "allowAll";
}

function readSocketSecurityMode(): SocketSecurityMode {
  const value = process.env.WMUX_SECURITY_MODE;
  if (isSocketSecurityMode(value)) {
    return value;
  }

  return readConfiguredSocketSecurityMode() ?? "wmuxOnly";
}

function readConfiguredSocketSecurityMode(): SocketSecurityMode | undefined {
  try {
    if (!existsSync(getSettingsPath())) {
      return undefined;
    }
    const settings = JSON.parse(readFileSync(getSettingsPath(), "utf8")) as unknown;
    if (isRecord(settings) && isSocketSecurityMode(settings.socketSecurityMode)) {
      return settings.socketSecurityMode;
    }
  } catch {
    return undefined;
  }

  return undefined;
}

async function writeConfiguredSocketSecurityMode(mode: SocketSecurityMode): Promise<void> {
  await mkdir(app.getPath("userData"), { recursive: true });
  await writeFile(getSettingsPath(), `${JSON.stringify({ socketSecurityMode: mode }, null, 2)}\n`, "utf8");
}

function getGlobalConfigPath(): string {
  const override = process.env.WMUX_GLOBAL_CONFIG_PATH;
  if (override) {
    return resolve(override);
  }

  if (process.platform === "win32") {
    return join(process.env.APPDATA || join(homedir(), "AppData", "Roaming"), "wmux", "wmux.json");
  }

  return join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "wmux", "wmux.json");
}

function getSocketSecuritySettings(configuredMode = readConfiguredSocketSecurityMode() ?? socketSecurityMode): SocketSecuritySettings {
  return {
    activeMode: socketSecurityMode,
    configuredMode,
    pendingRestart: configuredMode !== socketSecurityMode,
    warning: configuredMode === "allowAll" ? socketAllowAllWarning : undefined
  };
}

function normalizePathForCompare(path: string): string {
  return resolve(path).replace(/\\/g, "/").toLowerCase();
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

function parseCommandConfig(
  value: unknown,
  errors: string[],
  index: number,
  source: { kind: WmuxConfigSourceKind; path: string }
): WmuxCommandConfig | null {
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
    workspace: workspace ?? undefined,
    source: source.kind,
    sourcePath: source.path
  };
}

function parseProjectConfig(
  value: unknown,
  source: { kind: WmuxConfigSourceKind; path: string }
): { config: WmuxProjectConfig; errors: string[] } {
  const errors: string[] = [];
  if (!isRecord(value)) {
    return { config: { commands: [] }, errors: ["wmux.json 根节点必须是对象"] };
  }

  if (!Array.isArray(value.commands)) {
    return { config: { commands: [] }, errors: ["wmux.json 必须包含 commands 数组"] };
  }

  const commands = value.commands
    .map((command, index) => parseCommandConfig(command, errors, index, source))
    .filter((command): command is WmuxCommandConfig => Boolean(command));

  return { config: { commands }, errors };
}

async function inspectWorkspaceCwd(cwd: string): Promise<WorkspaceInspection> {
  const resolvedCwd = resolve(cwd);
  const [branch, ports] = await Promise.all([detectGitBranch(resolvedCwd), detectListeningPorts(resolvedCwd)]);
  return {
    cwd: resolvedCwd.replace(/\\/g, "/"),
    branch,
    ports
  };
}

async function detectGitBranch(cwd: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync("git", ["-C", cwd, "branch", "--show-current"], {
      timeout: 2500,
      windowsHide: true
    });
    const branch = stdout.trim();
    if (branch) {
      return branch;
    }

    const head = await execFileAsync("git", ["-C", cwd, "rev-parse", "--short", "HEAD"], {
      timeout: 2500,
      windowsHide: true
    });
    return head.stdout.trim() || undefined;
  } catch {
    return undefined;
  }
}

async function detectListeningPorts(cwd: string): Promise<number[]> {
  if (process.platform !== "win32") {
    return [];
  }

  try {
    const { stdout } = await execFileAsync(
      "powershell.exe",
      [
        "-NoProfile",
        "-Command",
        "Get-NetTCPConnection -State Listen | Select-Object -Property LocalPort,OwningProcess | ConvertTo-Json -Compress"
      ],
      { timeout: 4000, windowsHide: true, maxBuffer: 1024 * 1024 }
    );
    const parsed = JSON.parse(stdout.trim() || "[]") as unknown;
    const connections = (Array.isArray(parsed) ? parsed : parsed ? [parsed] : []).filter(isRecord);
    const portByPid = new Map<number, Set<number>>();

    for (const connection of connections) {
      const pid = Number(connection.OwningProcess);
      const port = Number(connection.LocalPort);
      if (!Number.isInteger(pid) || pid <= 0 || !Number.isInteger(port) || port <= 0) {
        continue;
      }
      const ports = portByPid.get(pid) ?? new Set<number>();
      ports.add(port);
      portByPid.set(pid, ports);
    }

    if (!portByPid.size) {
      return [];
    }

    const candidatePids = await findProcessIdsForCwd(cwd, [...portByPid.keys()]);
    return [...new Set(candidatePids.flatMap((pid) => [...(portByPid.get(pid) ?? [])]))].sort((first, second) => first - second);
  } catch {
    return [];
  }
}

async function findProcessIdsForCwd(cwd: string, pids: number[]): Promise<number[]> {
  const normalizedCwd = normalizePathForCompare(cwd);
  const matchedPids = new Set<number>();
  const batchSize = 60;

  for (let index = 0; index < pids.length; index += batchSize) {
    const batch = pids.slice(index, index + batchSize);
    const filter = batch.map((pid) => `ProcessId=${pid}`).join(" OR ");
    try {
      const { stdout } = await execFileAsync(
        "powershell.exe",
        [
          "-NoProfile",
          "-Command",
          `Get-CimInstance Win32_Process -Filter '${filter}' | Select-Object -Property ProcessId,CommandLine,ExecutablePath | ConvertTo-Json -Compress`
        ],
        { timeout: 4000, windowsHide: true, maxBuffer: 1024 * 1024 }
      );
      const parsed = JSON.parse(stdout.trim() || "[]") as unknown;
      const processes = (Array.isArray(parsed) ? parsed : parsed ? [parsed] : []).filter(isRecord);
      for (const processInfo of processes) {
        const pid = Number(processInfo.ProcessId);
        const haystack = [processInfo.CommandLine, processInfo.ExecutablePath]
          .filter((value): value is string => typeof value === "string")
          .map((value) => value.replace(/\\/g, "/").toLowerCase())
          .join(" ");

        if (Number.isInteger(pid) && haystack.includes(normalizedCwd)) {
          matchedPids.add(pid);
        }
      }
    } catch {
      continue;
    }
  }

  return [...matchedPids];
}

async function readWmuxConfigSource(
  kind: WmuxConfigSourceKind,
  configPath: string
): Promise<{ source: WmuxConfigSource; config: WmuxProjectConfig }> {
  const missingConfig = { commands: [] };

  try {
    const rawConfig = await readFile(configPath, "utf8");
    const parsedConfig = parseProjectConfig(JSON.parse(rawConfig), { kind, path: configPath });
    return {
      source: {
        kind,
        path: configPath,
        found: true,
        commandCount: parsedConfig.config.commands.length,
        errors: parsedConfig.errors
      },
      config: parsedConfig.config
    };
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code === "ENOENT") {
      return {
        source: {
          kind,
          path: configPath,
          found: false,
          commandCount: 0,
          errors: []
        },
        config: missingConfig
      };
    }

    return {
      source: {
        kind,
        path: configPath,
        found: true,
        commandCount: 0,
        errors: [`读取 ${configPath} 失败：${error instanceof Error ? error.message : String(error)}`]
      },
      config: missingConfig
    };
  }
}

function mergeWmuxCommands(globalCommands: WmuxCommandConfig[], projectCommands: WmuxCommandConfig[]): WmuxCommandConfig[] {
  const projectCommandNames = new Set(projectCommands.map((command) => command.name));
  return [...globalCommands.filter((command) => !projectCommandNames.has(command.name)), ...projectCommands];
}

async function loadProjectConfig(): Promise<WmuxProjectConfigResult> {
  const projectConfigPath = join(process.cwd(), "wmux.json");
  const cmuxProjectConfigPath = join(process.cwd(), ".cmux", "cmux.json");
  const globalConfigPath = getGlobalConfigPath();
  const [globalResult, projectResult] = await Promise.all([
    readWmuxConfigSource("global", globalConfigPath),
    readWmuxConfigSource("project", projectConfigPath)
  ]);
  const cmuxProjectResult = projectResult.source.found
    ? undefined
    : await readWmuxConfigSource("project", cmuxProjectConfigPath);
  const selectedProjectResult = projectResult.source.found ? projectResult : cmuxProjectResult;
  const sources = [globalResult.source, projectResult.source, ...(cmuxProjectResult ? [cmuxProjectResult.source] : [])];
  const commands = mergeWmuxCommands(globalResult.config.commands, selectedProjectResult?.config.commands ?? []);

  return {
    path: selectedProjectResult?.source.found ? selectedProjectResult.source.path : projectConfigPath,
    found: sources.some((source) => source.found),
    config: { commands },
    errors: sources.flatMap((source) => source.errors),
    sources
  };
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

    pendingRequest.reject(createRpcError(response.error.code, response.error.message, response.error.details));
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
  ipcMain.handle("app:securityState", () => getSocketSecuritySettings());
  ipcMain.handle("app:setSecurityMode", async (_event, mode: SocketSecurityMode): Promise<SocketSecuritySettings> => {
    if (!isSocketSecurityMode(mode)) {
      throw createRpcError("BAD_REQUEST", "invalid socket security mode");
    }

    await writeConfiguredSocketSecurityMode(mode);
    return getSocketSecuritySettings(mode);
  });
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
  ipcMain.handle("workspace:inspectCwd", async (_event, cwd: string): Promise<WorkspaceInspection> => inspectWorkspaceCwd(cwd));
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
  if (socketSecurityMode === "off") {
    console.warn("WMUX_SECURITY_MODE=off: socket server disabled.");
  } else {
    void registerSocketRpcServer({
      dispatch: dispatchSocketRequestToRenderer,
      path: socketPath,
      securityMode: socketSecurityMode,
      token: socketToken
    }).then((server) => {
      socketRpcServer = server;
      if (socketSecurityMode === "allowAll") {
        console.warn(socketAllowAllWarning);
      }
    });
  }

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

import { app, BrowserWindow, ipcMain, nativeTheme, safeStorage, shell } from "electron";
import { randomBytes } from "node:crypto";
import { execFile } from "node:child_process";
import { writeFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { homedir, tmpdir } from "node:os";
import { promisify } from "node:util";
import { registerPtyIpc } from "./pty/ptyManager";
import { hydrateBlocksFromState, hydrateOutputBuffersFromState, snapshotBlocks, snapshotOutputBuffers } from "./pty/ptyManager";
import { registerCompletionIpc } from "./ipc/completionBridge";
import { loadWorkflowYamlDirectory } from "./config/workflowYamlLoader";
import {
  deserializePersistedBlocks,
  deserializeOutputBuffers,
  serializeOutputBuffers
} from "./pty/outputBufferPersistence";
import { registerAppUpdater } from "./appUpdater";
import { requestChatCompletion } from "./ai/aiClient";
import { redactSecrets } from "./ai/redaction";
import {
  mergeAiSettingsUpdate,
  mergeThemeSettingsUpdate,
  readAppSettings,
  resolveAiSettings,
  resolveThemeSettings,
  toPublicAiSettings,
  updateAppSettings
} from "./settingsStore";
import { loadNotebook, saveNotebook } from "./notebookStore";
import {
  createRpcError,
  getDefaultSocketPath,
  registerSocketRpcServer,
  type SocketRpcServer
} from "./socket/rpcServer";
import { inspectWorkspaceRuntime } from "./workspaceRuntime";
import type {
  BrowserRpcMethod,
  AiCancelRequest,
  AiExplainRequest,
  AiSettings,
  AiSettingsUpdate,
  AiSuggestRequest,
  AiStreamEvent,
  NotebookLoadParams,
  NotebookLoadResult,
  NotebookSaveParams,
  NotebookSaveResult,
  PersistedAppState,
  PullRequestState,
  PullRequestSummary,
  SocketSecurityMode,
  SocketSecuritySettings,
  SocketRpcRequest,
  SocketRpcResponse,
  ThemeSettings,
  ThemeSettingsUpdate,
  WmuxCommandConfig,
  WmuxCommandArg,
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
type AiStreamEventWithoutRequestId =
  | { type: "token"; token: string }
  | { type: "done" }
  | { type: "error"; error: string };
const pendingRendererRequests = new Map<
  string,
  {
    resolve: (value: unknown) => void;
    reject: (reason?: unknown) => void;
    timer: NodeJS.Timeout;
  }
>();
const aiAbortControllers = new Map<string, AbortController>();
process.env.WMUX_SOCKET_PATH = socketPath;
process.env.WMUX_SOCKET_TOKEN = socketToken;
process.env.WMUX_SECURITY_MODE = socketSecurityMode;

function getStatePath(): string {
  return join(app.getPath("userData"), "workspace-state.json");
}

function getScrollbackPath(): string {
  return join(app.getPath("userData"), "terminal-scrollback.json");
}

async function hydrateScrollbackFromDisk(): Promise<void> {
  try {
    const raw = await readFile(getScrollbackPath(), "utf8");
    const state = deserializeOutputBuffers(raw);
    const blocks = deserializePersistedBlocks(raw);
    if (state.size > 0) {
      hydrateOutputBuffersFromState(state);
    }
    if (blocks.size > 0) {
      hydrateBlocksFromState(blocks);
    }
  } catch {
    // 缺文件 / JSON 损坏 / 权限问题：deserialize 已经做兜底返回空 Map，
    // 这里只关心读不到时不污染 outputBuffers
  }
}

function persistScrollbackToDisk(): void {
  try {
    const json = serializeOutputBuffers(snapshotOutputBuffers(), {
      blocks: snapshotBlocks()
    });
    // 同步写：before-quit 退出窗口很短，异步写很可能赶不上 process exit
    writeFileSync(getScrollbackPath(), json, { encoding: "utf8" });
  } catch {
    // 退出阶段任何失败都吞掉，保证用户感知不到延迟
  }
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
  const settings = readAppSettings(getSettingsPath());
  return isSocketSecurityMode(settings.socketSecurityMode) ? settings.socketSecurityMode : undefined;
}

async function writeConfiguredSocketSecurityMode(mode: SocketSecurityMode): Promise<void> {
  await updateAppSettings(getSettingsPath(), (settings) => ({
    ...settings,
    socketSecurityMode: mode
  }));
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

function requireAiEnabled(settings: AiSettings): void {
  if (!settings.enabled || !settings.endpoint.trim() || !settings.model.trim()) {
    throw createRpcError("INVALID_STATE", "AI 尚未启用或配置不完整");
  }
}

function sanitizeAiText(value: string, settings: AiSettings): string {
  return settings.redactSecrets ? redactSecrets(value) : value;
}

function tailText(value: string, maxBytes: number): string {
  if (Buffer.byteLength(value, "utf8") <= maxBytes) {
    return value;
  }
  return Buffer.from(value, "utf8").subarray(-maxBytes).toString("utf8");
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

function getAiSettings(includeApiKey = false): AiSettings {
  const settings = resolveAiSettings(readAppSettings(getSettingsPath()), safeStorage);
  return includeApiKey ? settings : toPublicAiSettings(settings);
}

async function writeAiSettings(update: AiSettingsUpdate): Promise<AiSettings> {
  const settings = await updateAppSettings(getSettingsPath(), (currentSettings) =>
    mergeAiSettingsUpdate(currentSettings, update, safeStorage)
  );
  return toPublicAiSettings(resolveAiSettings(settings, safeStorage));
}

function getThemeSettings(): ThemeSettings {
  return resolveThemeSettings(readAppSettings(getSettingsPath()));
}

async function writeThemeSettings(update: ThemeSettingsUpdate): Promise<ThemeSettings> {
  const settings = await updateAppSettings(getSettingsPath(), (currentSettings) =>
    mergeThemeSettingsUpdate(currentSettings, update)
  );
  return resolveThemeSettings(settings);
}

function emitAiStream(requestId: string, event: AiStreamEventWithoutRequestId): void {
  const window = mainWindow;
  if (!window || window.isDestroyed()) {
    return;
  }
  window.webContents.send("ai:stream", { requestId, ...event } as AiStreamEvent);
}

function createAiAbortController(requestId: string): AbortController {
  aiAbortControllers.get(requestId)?.abort();
  const controller = new AbortController();
  aiAbortControllers.set(requestId, controller);
  return controller;
}

function clearAiAbortController(requestId: string): void {
  aiAbortControllers.delete(requestId);
}

function parseCommandArgConfig(value: unknown, errors: string[], context: string): WmuxCommandArg | null {
  if (!isRecord(value)) {
    errors.push(`${context} 必须是参数对象`);
    return null;
  }

  const name = readOptionalString(value, "name");
  if (!name) {
    errors.push(`${context}.name 必须是非空字符串`);
    return null;
  }

  const enumValues = Array.isArray(value.enum)
    ? value.enum.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).map((item) => item.trim())
    : undefined;

  return {
    name,
    description: readOptionalString(value, "description"),
    default: readOptionalString(value, "default"),
    required: readOptionalBoolean(value, "required"),
    enum: enumValues?.length ? enumValues : undefined
  };
}

function parseCommandArgsConfig(value: unknown, errors: string[], context: string): WmuxCommandArg[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    errors.push(`${context} 必须是参数数组`);
    return undefined;
  }

  const args = value
    .map((arg, index) => parseCommandArgConfig(arg, errors, `${context}[${index}]`))
    .filter((arg): arg is WmuxCommandArg => Boolean(arg));

  return args.length ? args : undefined;
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

  if (value.type === "notebook") {
    return {
      type: "notebook",
      name: readOptionalString(value, "name"),
      notebookId: readOptionalString(value, "notebookId"),
      focus: readOptionalBoolean(value, "focus")
    };
  }

  errors.push(`${context} 的 type 必须是 terminal、browser 或 notebook`);
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
  const commandTemplate = readOptionalString(value, "commandTemplate");
  const args = parseCommandArgsConfig(value.args, errors, `${context}.args`);
  const workspace = value.workspace === undefined ? undefined : parseWorkspaceCommandConfig(value.workspace, errors, `${context}.workspace`);
  if (!commandText && !commandTemplate && !workspace) {
    errors.push(`${context} 必须提供 command、commandTemplate 或 workspace`);
    return null;
  }

  return {
    name,
    description: readOptionalString(value, "description"),
    keywords: readOptionalKeywords(value),
    restart:
      value.restart === "ignore" || value.restart === "recreate" || value.restart === "confirm" ? value.restart : undefined,
    command: commandText,
    commandTemplate,
    args,
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
  const [branch, gitDirty, ports, runtime] = await Promise.all([
    detectGitBranch(resolvedCwd),
    detectGitDirty(resolvedCwd),
    detectListeningPorts(resolvedCwd),
    inspectWorkspaceRuntime(resolvedCwd)
  ]);
  const pullRequest = await detectPullRequest(resolvedCwd, branch);
  return {
    cwd: resolvedCwd.replace(/\\/g, "/"),
    branch,
    gitDirty,
    ports,
    pullRequest,
    venv: runtime.venv,
    nodeVersion: runtime.nodeVersion
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

async function detectGitDirty(cwd: string): Promise<boolean | undefined> {
  try {
    const { stdout } = await execFileAsync("git", ["-C", cwd, "status", "--porcelain"], {
      timeout: 2500,
      windowsHide: true
    });
    return stdout.trim().length > 0;
  } catch {
    return undefined;
  }
}

// 通过 gh CLI 抓取分支对应的最近一条 PR；gh 未装 / 未登录 / 超时 / 解析失败统一返回 undefined
async function detectPullRequest(cwd: string, branch?: string): Promise<PullRequestSummary | undefined> {
  if (!branch) {
    return undefined;
  }
  try {
    const { stdout } = await execFileAsync(
      "gh",
      [
        "pr",
        "list",
        "--head",
        branch,
        "--state",
        "all",
        "--json",
        "number,state,isDraft,title,url",
        "--limit",
        "1"
      ],
      { cwd, timeout: 5000, windowsHide: true }
    );
    const items = JSON.parse(stdout) as Array<{
      number: number;
      state: string;
      isDraft: boolean;
      title?: string;
      url?: string;
    }>;
    const raw = items[0];
    if (!raw) {
      return undefined;
    }
    const state: PullRequestState =
      raw.state === "MERGED"
        ? "merged"
        : raw.state === "CLOSED"
          ? "closed"
          : raw.isDraft
            ? "draft"
            : "open";
    return {
      number: raw.number,
      state,
      title: raw.title,
      url: raw.url
    };
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
  const workflowResults = await loadWorkflowYamlDirectory(process.cwd());
  const sources = [
    globalResult.source,
    projectResult.source,
    ...(cmuxProjectResult ? [cmuxProjectResult.source] : []),
    ...workflowResults.map((result) => result.source)
  ];
  const projectCommands = [
    ...(selectedProjectResult?.config.commands ?? []),
    ...workflowResults.flatMap((result) => result.commands)
  ];
  const commands = mergeWmuxCommands(globalResult.config.commands, projectCommands);

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

  try {
    registerAppUpdater();
  } catch (error) {
    // 自动更新初始化失败不阻塞窗口创建：仅记录后继续
    console.error("[wmux] app updater registration failed:", error);
  }

  ipcMain.handle("app:version", () => app.getVersion());
  ipcMain.handle("app:securityState", () => getSocketSecuritySettings());
  ipcMain.handle("app:setSecurityMode", async (_event, mode: SocketSecurityMode): Promise<SocketSecuritySettings> => {
    if (!isSocketSecurityMode(mode)) {
      throw createRpcError("BAD_REQUEST", "invalid socket security mode");
    }

    await writeConfiguredSocketSecurityMode(mode);
    return getSocketSecuritySettings(mode);
  });
  ipcMain.handle("ai:getSettings", (): AiSettings => getAiSettings(false));
  ipcMain.handle("ai:setSettings", async (_event, update: AiSettingsUpdate): Promise<AiSettings> => {
    if (!isRecord(update)) {
      throw createRpcError("BAD_REQUEST", "AI settings update 必须是对象");
    }
    return writeAiSettings(update);
  });
  ipcMain.handle("theme:getSettings", (): ThemeSettings => getThemeSettings());
  ipcMain.handle("theme:setSettings", async (_event, update: ThemeSettingsUpdate): Promise<ThemeSettings> => {
    if (!isRecord(update)) {
      throw createRpcError("BAD_REQUEST", "theme settings update 必须是对象");
    }
    return writeThemeSettings(update);
  });
  ipcMain.handle("ai:cancel", (_event, request: AiCancelRequest): { ok: true } => {
    if (!isRecord(request) || typeof request.requestId !== "string") {
      throw createRpcError("BAD_REQUEST", "ai.cancel 需要 requestId");
    }
    aiAbortControllers.get(request.requestId)?.abort();
    clearAiAbortController(request.requestId);
    return { ok: true };
  });
  ipcMain.handle("ai:explain", async (_event, request: AiExplainRequest): Promise<{ requestId: string; blockId: string }> => {
    if (!isRecord(request) || typeof request.requestId !== "string" || typeof request.blockId !== "string") {
      throw createRpcError("BAD_REQUEST", "ai.explain 需要 requestId 和 blockId");
    }
    const settings = getAiSettings(true);
    requireAiEnabled(settings);
    const sessionId = request.surfaceId ? `${request.surfaceId}:auto` : undefined;
    const blocksBySession = snapshotBlocks();
    const outputBySession = snapshotOutputBuffers();
    const matched = [...blocksBySession.entries()].flatMap(([id, blocks]) =>
      blocks.map((block) => ({ id, block }))
    ).find((item) => item.block.id === request.blockId);
    const block = matched?.block;
    if (!block) {
      throw createRpcError("NOT_FOUND", "找不到 block", { blockId: request.blockId });
    }
    const output = tailText(outputBySession.get(matched.id) ?? (sessionId ? outputBySession.get(sessionId) ?? "" : ""), settings.maxOutputBytes);
    const context = sanitizeAiText(
      [
        `command: ${block.command}`,
        `exit_code: ${block.exitCode ?? "unknown"}`,
        `cwd: ${block.cwd ?? ""}`,
        `shell: ${block.shell ?? ""}`,
        "last_output:",
        output
      ].join("\n"),
      settings
    );
    const controller = createAiAbortController(request.requestId);
    void requestChatCompletion({
      settings,
      signal: controller.signal,
      messages: [
        {
          role: "system",
          content:
            "你是 wmux 终端助手。请用简体中文解释失败命令的可能原因，并给出最多三条可复制的修复命令。"
        },
        { role: "user", content: context }
      ],
      onToken: (token) => emitAiStream(request.requestId, { type: "token", token })
    })
      .then(() => emitAiStream(request.requestId, { type: "done" }))
      .catch((error) =>
        emitAiStream(request.requestId, {
          type: "error",
          error: error instanceof Error && error.name === "AbortError" ? "已取消" : error instanceof Error ? error.message : String(error)
        })
      )
      .finally(() => clearAiAbortController(request.requestId));
    return { requestId: request.requestId, blockId: request.blockId };
  });
  ipcMain.handle("ai:suggest", async (_event, request: AiSuggestRequest): Promise<{ requestId: string }> => {
    if (!isRecord(request) || typeof request.requestId !== "string" || typeof request.prompt !== "string") {
      throw createRpcError("BAD_REQUEST", "ai.suggest 需要 requestId 和 prompt");
    }
    const settings = getAiSettings(true);
    requireAiEnabled(settings);
    const prompt = sanitizeAiText(request.prompt, settings);
    const controller = createAiAbortController(request.requestId);
    void requestChatCompletion({
      settings,
      signal: controller.signal,
      messages: [
        {
          role: "system",
          content:
            "你是终端命令生成器。只返回 1 到 3 条可直接在当前 shell 执行的命令，每行一条，不要解释。"
        },
        {
          role: "user",
          content: [`cwd: ${request.cwd ?? ""}`, `shell: ${request.shell ?? ""}`, `task: ${prompt}`].join("\n")
        }
      ],
      onToken: (token) => emitAiStream(request.requestId, { type: "token", token })
    })
      .then(() => emitAiStream(request.requestId, { type: "done" }))
      .catch((error) =>
        emitAiStream(request.requestId, {
          type: "error",
          error: error instanceof Error && error.name === "AbortError" ? "已取消" : error instanceof Error ? error.message : String(error)
        })
      )
      .finally(() => clearAiAbortController(request.requestId));
    return { requestId: request.requestId };
  });
  ipcMain.handle("config:loadProjectConfig", () => loadProjectConfig());
  ipcMain.handle(
    "notebook:load",
    async (_event, params: NotebookLoadParams): Promise<NotebookLoadResult> => {
      if (!isRecord(params) || typeof params.cwd !== "string" || typeof params.notebookId !== "string") {
        throw createRpcError("BAD_REQUEST", "notebook.load 需要 cwd 和 notebookId");
      }
      return loadNotebook(params.cwd, params.notebookId, typeof params.title === "string" ? params.title : undefined);
    }
  );
  ipcMain.handle(
    "notebook:save",
    async (_event, params: NotebookSaveParams): Promise<NotebookSaveResult> => {
      if (
        !isRecord(params) ||
        typeof params.cwd !== "string" ||
        typeof params.notebookId !== "string" ||
        typeof params.content !== "string"
      ) {
        throw createRpcError("BAD_REQUEST", "notebook.save 需要 cwd、notebookId 和 content");
      }
      return saveNotebook(params.cwd, params.notebookId, params.content);
    }
  );
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
  registerCompletionIpc();
  registerSocketBridgeIpc();

  // 跨重启 scrollback 持久化：在 IPC 注册后立即 hydrate，保证终端 surface
  // 第一次 create 时 outputBuffers 已含上次会话尾段，触发分隔横幅 + 历史回放
  void hydrateScrollbackFromDisk();

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
  aiAbortControllers.forEach((controller) => controller.abort());
  aiAbortControllers.clear();
  void socketRpcServer?.close();
  // 终端 scrollback 持久化：尽力写盘，失败静默吞掉避免阻塞退出
  persistScrollbackToDisk();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

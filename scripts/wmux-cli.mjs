#!/usr/bin/env node
import { connect } from "node:net";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";

const args = process.argv.slice(2);
const command = args[0];
const jsonOutput = args.includes("--json");

function getDefaultSocketPath() {
  if (process.env.WMUX_SOCKET_PATH) {
    return process.env.WMUX_SOCKET_PATH;
  }

  if (process.platform === "win32") {
    return "\\\\.\\pipe\\wmux";
  }

  return join(tmpdir(), "wmux.sock");
}

function printUsage() {
  console.error(`用法：
  wmux ping [--json]
  wmux identify [--json]
  wmux capabilities [--json]
  wmux list-workspaces [--json]
  wmux new-workspace [--name <name>] [--cwd <path>] [--json]
  wmux select-workspace --workspace <id> [--json]
  wmux close-workspace --workspace <id> [--json]
  wmux rename-workspace --workspace <id> --name <name> [--json]
  wmux surface list [--workspace <id>] [--json]
  wmux surface focus --surface <id> [--json]
  wmux send <text> [--json]
  wmux send-key <key> [--surface <id>] [--json]
  wmux notify --title <title> [--body <body>] [--json]
  wmux clear-status [--workspace <id>] [--json]
  wmux status list [--workspace <id>] [--json]
  wmux browser navigate <url> [--surface <id>] [--create] [--wait load|domcontentloaded|none] [--timeout <ms>] [--json]
  wmux browser open <url> [--json]
  wmux browser list [--json]
  wmux browser click <selector> [--timeout <ms>] [--wait visible|attached|none] [--json]
  wmux browser fill <selector> <text> [--text <text>] [--text-file <path>] [--json]
  wmux browser eval <script> [--json]
  wmux browser eval-file <path> [--json]
  wmux browser snapshot [--selector <selector>] [--json] [--out <path>]
  wmux browser screenshot [--out <path>] [--format png|jpeg] [--base64] [--json]`);
}

function cliError(message) {
  const error = new Error(message);
  error.cliExitCode = 2;
  return error;
}

function parseOption(name) {
  const index = args.indexOf(name);
  if (index < 0) {
    return undefined;
  }
  return args[index + 1];
}

function readOutputPath() {
  if (!hasFlag("--out")) {
    return undefined;
  }

  const outputPath = parseOption("--out");
  if (!outputPath || outputPath.startsWith("--")) {
    throw cliError("--out 需要明确文件路径");
  }

  return outputPath;
}

function hasFlag(name) {
  return args.includes(name);
}

function readTimeout() {
  const rawTimeout = parseOption("--timeout");
  if (rawTimeout === undefined) {
    return undefined;
  }
  const timeoutMs = Number(rawTimeout);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw cliError("--timeout 必须是正数毫秒");
  }
  return Math.floor(timeoutMs);
}

function readSelectorParams(allowCreate) {
  const surfaceId = parseOption("--surface");
  const paneId = parseOption("--pane");
  const workspaceId = parseOption("--workspace");
  const active = hasFlag("--active");
  const explicitTargets = [surfaceId, paneId, workspaceId].filter(Boolean).length;

  if (explicitTargets > 1) {
    throw cliError("--surface、--pane、--workspace 至多传一个");
  }
  if (active && explicitTargets > 0) {
    throw cliError("--active 不能与显式目标同时使用");
  }
  if (hasFlag("--create") && !allowCreate) {
    throw cliError("--create 只允许 browser navigate/open");
  }

  return {
    ...(surfaceId ? { surfaceId } : {}),
    ...(paneId ? { paneId } : {}),
    ...(workspaceId ? { workspaceId } : {}),
    ...(active ? { active: true } : {}),
    ...(hasFlag("--create") ? { createIfMissing: true } : {})
  };
}

function createBrowserRequest() {
  const browserCommand = args[1];

  if (browserCommand === "navigate" || browserCommand === "open") {
    const url = args[2];
    if (!url || url.startsWith("--")) {
      throw cliError("browser navigate/open 需要 url");
    }
    return {
      method: "browser.navigate",
      params: {
        ...readSelectorParams(true),
        url,
        ...(browserCommand === "open" ? { createIfMissing: true, forceCreate: true } : {}),
        ...(parseOption("--wait") ? { waitUntil: parseOption("--wait") } : {}),
        ...(readTimeout() ? { timeoutMs: readTimeout() } : {})
      }
    };
  }

  if (browserCommand === "click") {
    const selector = args[2];
    if (!selector || selector.startsWith("--")) {
      throw cliError("browser click 需要 selector");
    }
    return {
      method: "browser.click",
      params: {
        ...readSelectorParams(false),
        selector,
        ...(parseOption("--wait") ? { wait: parseOption("--wait") } : {}),
        ...(parseOption("--load-wait") ? { waitUntil: parseOption("--load-wait") } : {}),
        ...(readTimeout() ? { timeoutMs: readTimeout() } : {})
      }
    };
  }

  if (browserCommand === "list") {
    return {
      method: "browser.list",
      params: {
        ...(parseOption("--workspace") ? { workspaceId: parseOption("--workspace") } : {})
      }
    };
  }

  if (browserCommand === "fill") {
    const selector = args[2];
    if (!selector || selector.startsWith("--")) {
      throw cliError("browser fill 需要 selector");
    }
    const textValues = [args[3] && !args[3].startsWith("--") ? args[3] : undefined, parseOption("--text"), parseOption("--text-file")].filter(
      (value) => value !== undefined
    );
    if (textValues.length !== 1) {
      throw cliError("browser fill 需要且只能通过位置参数、--text、--text-file 之一传入文本");
    }
    const textFile = parseOption("--text-file");
    return {
      method: "browser.fill",
      params: {
        ...readSelectorParams(false),
        selector,
        text: textFile ? readFileSync(resolve(textFile), "utf8") : textValues[0],
        ...(parseOption("--wait") ? { wait: parseOption("--wait") } : {}),
        ...(readTimeout() ? { timeoutMs: readTimeout() } : {})
      }
    };
  }

  if (browserCommand === "eval" || browserCommand === "eval-file") {
    const script = browserCommand === "eval-file" ? readFileSync(resolve(args[2] ?? ""), "utf8") : args[2];
    if (!script) {
      throw cliError(`browser ${browserCommand} 需要 script`);
    }
    return {
      method: "browser.eval",
      params: {
        ...readSelectorParams(false),
        script,
        ...(readTimeout() ? { timeoutMs: readTimeout() } : {})
      }
    };
  }

  if (browserCommand === "snapshot") {
    readOutputPath();
    return {
      method: "browser.snapshot",
      params: {
        ...readSelectorParams(false),
        ...(parseOption("--selector") ? { selector: parseOption("--selector") } : {}),
        format: jsonOutput ? "json" : "text",
        ...(readTimeout() ? { timeoutMs: readTimeout() } : {})
      }
    };
  }

  if (browserCommand === "screenshot") {
    const outputPath = readOutputPath();
    if (outputPath && hasFlag("--base64")) {
      throw cliError("browser screenshot 不能同时使用 --out 和 --base64");
    }
    return {
      method: "browser.screenshot",
      params: {
        ...readSelectorParams(false),
        ...(outputPath ? { path: isAbsolute(outputPath) ? outputPath : resolve(outputPath) } : {}),
        ...(parseOption("--format") ? { format: parseOption("--format") } : {}),
        ...(parseOption("--selector") ? { selector: parseOption("--selector") } : {}),
        ...(hasFlag("--full-page") ? { fullPage: true } : {}),
        ...(readTimeout() ? { timeoutMs: readTimeout() } : {})
      }
    };
  }

  throw cliError(`未知 browser 命令：${browserCommand ?? ""}`);
}

function createRequest() {
  if (command === "ping") {
    return { method: "system.ping", params: {} };
  }

  if (command === "identify") {
    return { method: "system.identify", params: {} };
  }

  if (command === "capabilities") {
    return { method: "system.capabilities", params: {} };
  }

  if (command === "list-workspaces") {
    return { method: "workspace.list", params: {} };
  }

  if (command === "new-workspace") {
    const name = parseOption("--name");
    const cwd = parseOption("--cwd");
    if (name !== undefined && (!name || name.startsWith("--"))) {
      throw cliError("new-workspace 的 --name 需要名称");
    }
    if (cwd !== undefined && (!cwd || cwd.startsWith("--"))) {
      throw cliError("new-workspace 的 --cwd 需要路径");
    }
    return {
      method: "workspace.create",
      params: {
        ...(name ? { name } : {}),
        ...(cwd ? { cwd } : {})
      }
    };
  }

  if (command === "select-workspace") {
    const workspaceId = parseOption("--workspace");
    if (!workspaceId || workspaceId.startsWith("--")) {
      throw cliError("select-workspace 需要 --workspace <id>");
    }
    return {
      method: "workspace.select",
      params: {
        workspaceId
      }
    };
  }

  if (command === "close-workspace") {
    const workspaceId = parseOption("--workspace");
    if (!workspaceId || workspaceId.startsWith("--")) {
      throw cliError("close-workspace 需要 --workspace <id>");
    }
    return {
      method: "workspace.close",
      params: {
        workspaceId
      }
    };
  }

  if (command === "rename-workspace") {
    const workspaceId = parseOption("--workspace");
    const name = parseOption("--name");
    if (!workspaceId || workspaceId.startsWith("--")) {
      throw cliError("rename-workspace 需要 --workspace <id>");
    }
    if (!name || name.startsWith("--")) {
      throw cliError("rename-workspace 需要 --name <name>");
    }
    return {
      method: "workspace.rename",
      params: {
        workspaceId,
        name
      }
    };
  }

  if (command === "surface") {
    const surfaceCommand = args[1];

    if (surfaceCommand === "list") {
      return {
        method: "surface.list",
        params: {
          ...(parseOption("--workspace") ? { workspaceId: parseOption("--workspace") } : {})
        }
      };
    }

    if (surfaceCommand === "focus") {
      const surfaceId = parseOption("--surface");
      if (!surfaceId || surfaceId.startsWith("--")) {
        throw cliError("surface focus 需要 --surface <id>");
      }
      return {
        method: "surface.focus",
        params: {
          surfaceId
        }
      };
    }

    throw cliError(`未知 surface 命令：${surfaceCommand ?? ""}`);
  }

  if (command === "send") {
    const text = args[1];
    if (typeof text !== "string") {
      throw cliError("send 需要文本参数");
    }

    return { method: "surface.sendText", params: { text: text.replaceAll("\\n", "\n") } };
  }

  if (command === "send-key") {
    const key = args[1];
    if (!key || key.startsWith("--")) {
      throw cliError("send-key 需要 key 参数");
    }

    return {
      method: "surface.sendKey",
      params: {
        key,
        ...(parseOption("--surface") ? { surfaceId: parseOption("--surface") } : {})
      }
    };
  }

  if (command === "notify") {
    const title = parseOption("--title");
    const body = parseOption("--body");
    if (!title) {
      throw cliError("notify 需要 --title");
    }

    return { method: "status.notify", params: { title, body } };
  }

  if (command === "clear-status") {
    return {
      method: "status.clear",
      params: {
        ...(parseOption("--workspace") ? { workspaceId: parseOption("--workspace") } : {})
      }
    };
  }

  if (command === "status" || command === "list-status") {
    const statusCommand = command === "status" ? args[1] : "list";
    if (statusCommand !== "list") {
      throw cliError(`未知 status 命令：${statusCommand ?? ""}`);
    }

    return {
      method: "status.list",
      params: {
        ...(parseOption("--workspace") ? { workspaceId: parseOption("--workspace") } : {})
      }
    };
  }

  if (command === "browser") {
    return createBrowserRequest();
  }

  throw cliError(`未知命令：${command ?? ""}`);
}

function requestSocket(payload) {
  const socketPath = getDefaultSocketPath();
  const request = {
    id: `cli-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    auth: {
      token: process.env.WMUX_SOCKET_TOKEN
    },
    ...payload
  };

  return new Promise((resolve, reject) => {
    const socket = connect(socketPath);
    let buffer = "";

    const timer = setTimeout(() => {
      socket.destroy();
      const error = new Error(`连接 wmux socket 超时：${socketPath}`);
      error.cliExitCode = 3;
      reject(error);
    }, 5000);

    socket.setEncoding("utf8");
    socket.on("connect", () => {
      socket.write(`${JSON.stringify(request)}\n`);
    });
    socket.on("data", (chunk) => {
      buffer += chunk;
      const newlineIndex = buffer.indexOf("\n");
      if (newlineIndex < 0) {
        return;
      }

      clearTimeout(timer);
      socket.end();
      const frame = buffer.slice(0, newlineIndex);
      try {
        const response = JSON.parse(frame);
        if (response.ok) {
          resolve(response.result);
        } else {
          const error = new Error(response.error?.message ?? "wmux socket 请求失败");
          error.code = response.error?.code;
          error.details = response.error?.details;
          error.cliExitCode = 1;
          reject(error);
        }
      } catch (error) {
        error.cliExitCode = 4;
        reject(error);
      }
    });
    socket.on("error", (error) => {
      clearTimeout(timer);
      error.cliExitCode = 3;
      reject(error);
    });
    socket.on("close", () => clearTimeout(timer));
  });
}

function printBrowserResult(result) {
  const browserCommand = args[1];
  const outPath = readOutputPath();
  if (browserCommand === "list") {
    for (const browser of result?.browsers ?? []) {
      const activePrefix = browser.active ? "*" : " ";
      const title = browser.title ? `\t${browser.title}` : "";
      console.log(
        `${activePrefix} ${browser.surfaceId}\t${browser.workspaceId}\t${browser.workspaceName}\t${browser.paneId}\t${browser.url}${title}`
      );
    }
    return;
  }
  if (browserCommand === "snapshot" && outPath && typeof result?.snapshot === "string") {
    return writeFileAndPrint(outPath, result.snapshot);
  }
  if (browserCommand === "eval") {
    console.log(typeof result?.value === "string" ? result.value : JSON.stringify(result?.value));
    return;
  }
  if (browserCommand === "snapshot") {
    console.log(typeof result?.snapshot === "string" ? result.snapshot : JSON.stringify(result?.snapshot, null, 2));
    return;
  }
  if (browserCommand === "screenshot") {
    if (result?.path) {
      console.log(`screenshot ${result.path}`);
    } else {
      console.log(result?.base64 ?? "");
    }
    return;
  }
  if (browserCommand === "fill") {
    console.log(`filled ${result?.selector ?? "selector"}`);
    return;
  }
  if (browserCommand === "click") {
    console.log(`clicked ${result?.selector ?? "selector"}`);
    return;
  }
  console.log(result?.url ?? JSON.stringify(result));
}

function writeFileAndPrint(path, content) {
  const outputPath = resolve(path);
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, content, "utf8");
  console.log(outputPath);
}

function printErrorHint(error) {
  if (error?.code === "UNAUTHORIZED") {
    const mode = error?.details?.securityMode ? ` 当前安全模式：${error.details.securityMode}。` : "";
    console.error(`请在 wmux 内 terminal 运行，或显式设置 WMUX_SOCKET_TOKEN。${mode}`);
    return;
  }

  if (error?.code === "NOT_FOUND") {
    const details = error?.details ?? {};
    if (details.workspaceId) {
      console.error(`未找到 workspace：${details.workspaceId}。可先运行 wmux list-workspaces 查看可用 workspace。`);
      return;
    }
    if (details.surfaceId) {
      console.error(`未找到 surface：${details.surfaceId}。可先运行 wmux browser list 查看可用 browser surface。`);
      return;
    }
    if (details.paneId) {
      console.error(`未找到 pane：${details.paneId}。可先运行 wmux identify --json 查看当前 pane。`);
      return;
    }
    console.error("目标不存在。可先运行 wmux identify --json 或 wmux list-workspaces 查看当前上下文。");
    return;
  }

  if (error?.code === "METHOD_NOT_FOUND") {
    console.error("当前 wmux 版本不支持该 socket 方法。可运行 wmux capabilities 查看可用方法。");
  }
}

function printResult(result) {
  if (jsonOutput) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === "browser") {
    printBrowserResult(result);
    return;
  }

  if (command === "ping") {
    console.log(result?.pong ? "pong" : "unknown");
    return;
  }

  if (command === "identify") {
    const surface = result?.surfaceId ? ` surface=${result.surfaceId}` : "";
    console.log(
      `${result?.app ?? "wmux"} workspace=${result?.workspaceId ?? "unknown"} pane=${result?.paneId ?? "unknown"}${surface}`
    );
    return;
  }

  if (command === "capabilities") {
    for (const method of result?.methods ?? []) {
      console.log(method);
    }
    return;
  }

  if (command === "list-workspaces") {
    for (const workspace of result?.workspaces ?? []) {
      const activePrefix = workspace.active ? "*" : " ";
      console.log(`${activePrefix} ${workspace.name}\t${workspace.status}\t${workspace.cwd}`);
    }
    return;
  }

  if (command === "new-workspace") {
    const workspace = result?.workspace ?? result;
    console.log(`created ${workspace?.name ?? workspace?.id ?? "workspace"}`);
    return;
  }

  if (command === "select-workspace") {
    console.log(`selected ${result?.workspaceName ?? result?.workspaceId ?? "workspace"}`);
    return;
  }

  if (command === "close-workspace") {
    console.log(`closed ${result?.workspaceName ?? result?.workspaceId ?? "workspace"}`);
    return;
  }

  if (command === "rename-workspace") {
    console.log(`renamed ${result?.workspaceName ?? result?.workspaceId ?? "workspace"}`);
    return;
  }

  if (command === "surface") {
    if (args[1] === "focus") {
      console.log(`focused ${result?.surfaceId ?? "surface"}`);
      return;
    }

    for (const surface of result?.surfaces ?? []) {
      const activePrefix = surface.active ? "*" : " ";
      const subtitle = surface.subtitle ? `\t${surface.subtitle}` : "";
      console.log(
        `${activePrefix} ${surface.surfaceId}\t${surface.type}\t${surface.workspaceId}\t${surface.workspaceName}\t${surface.paneId}\t${surface.name}\t${surface.status}${subtitle}`
      );
    }
    return;
  }

  if (command === "send") {
    console.log(`sent ${result?.bytes ?? 0} bytes to ${result?.surfaceId ?? "terminal"}`);
    return;
  }

  if (command === "send-key") {
    console.log(`sent key ${result?.key ?? ""} to ${result?.surfaceId ?? "terminal"}`);
    return;
  }

  if (command === "notify") {
    console.log(`notified ${result?.workspaceId ?? "workspace"}`);
    return;
  }

  if (command === "clear-status") {
    console.log(`cleared ${result?.workspaceId ?? "workspace"}`);
    return;
  }

  if (command === "status" || command === "list-status") {
    for (const item of result?.statuses ?? []) {
      const activePrefix = item.active ? "*" : " ";
      const notice = item.notice ? `\t${item.notice}` : "";
      console.log(`${activePrefix} ${item.name}\t${item.status}${notice}`);
    }
  }
}

try {
  const payload = createRequest();
  const result = await requestSocket(payload);
  printResult(result);
} catch (error) {
  printUsage();
  if (error?.code) {
    console.error(error.code);
  }
  console.error(error instanceof Error ? error.message : String(error));
  printErrorHint(error);
  const candidates = error?.details?.candidates;
  if (error?.code === "AMBIGUOUS_TARGET" && Array.isArray(candidates) && candidates.length > 0) {
    console.error("可用 browser surfaces：");
    for (const candidate of candidates) {
      console.error(
        `  --surface ${candidate.surfaceId}  ${candidate.workspaceName ?? candidate.workspaceId} / ${candidate.paneId}  ${candidate.url ?? ""}`
      );
    }
  }
  process.exit(typeof error?.cliExitCode === "number" ? error.cliExitCode : 1);
}

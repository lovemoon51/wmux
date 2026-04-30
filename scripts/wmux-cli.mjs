#!/usr/bin/env node
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
  wmux list-workspaces [--json]
  wmux send <text> [--json]
  wmux notify --title <title> [--body <body>] [--json]`);
}

function parseOption(name) {
  const index = args.indexOf(name);
  if (index < 0) {
    return undefined;
  }

  return args[index + 1];
}

function createRequest() {
  if (command === "ping") {
    return { method: "system.ping", params: {} };
  }

  if (command === "list-workspaces") {
    return { method: "workspace.list", params: {} };
  }

  if (command === "send") {
    const text = args[1];
    if (typeof text !== "string") {
      throw new Error("send 需要文本参数");
    }

    return { method: "surface.sendText", params: { text: text.replaceAll("\\n", "\n") } };
  }

  if (command === "notify") {
    const title = parseOption("--title");
    const body = parseOption("--body");
    if (!title) {
      throw new Error("notify 需要 --title");
    }

    return { method: "status.notify", params: { title, body } };
  }

  throw new Error(`未知命令：${command ?? ""}`);
}

function requestSocket(payload) {
  const socketPath = getDefaultSocketPath();
  const request = {
    id: `cli-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    ...payload
  };

  return new Promise((resolve, reject) => {
    const socket = connect(socketPath);
    let buffer = "";

    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`连接 wmux socket 超时：${socketPath}`));
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
          reject(error);
        }
      } catch (error) {
        reject(error);
      }
    });
    socket.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    socket.on("close", () => clearTimeout(timer));
  });
}

function printResult(result) {
  if (jsonOutput) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === "ping") {
    console.log(result?.pong ? "pong" : "unknown");
    return;
  }

  if (command === "list-workspaces") {
    for (const workspace of result?.workspaces ?? []) {
      const activePrefix = workspace.active ? "*" : " ";
      console.log(`${activePrefix} ${workspace.name}\t${workspace.status}\t${workspace.cwd}`);
    }
    return;
  }

  if (command === "send") {
    console.log(`sent ${result?.bytes ?? 0} bytes to ${result?.surfaceId ?? "terminal"}`);
    return;
  }

  if (command === "notify") {
    console.log(`notified ${result?.workspaceId ?? "workspace"}`);
  }
}

try {
  const payload = createRequest();
  const result = await requestSocket(payload);
  printResult(result);
} catch (error) {
  printUsage();
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

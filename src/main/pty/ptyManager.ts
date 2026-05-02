import { ipcMain, type WebContents } from "electron";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, type IPty } from "node-pty";
import type { Block, BlockEvent, ShellProfile, ShellProfileOption } from "../../shared/types";
import { createBlockParserState, parseTerminalBlocks, type BlockParserState } from "./blockParser";
import { extractOscNotifications } from "./oscNotifications";
import { appendToOutputBuffer } from "./outputBuffer";

type TerminalSession = {
  id: string;
  surfaceId: string;
  workspaceId?: string;
  shell: ShellProfile;
  cwd: string;
  pty: IPty;
  owner: WebContents;
  blockParser: BlockParserState;
};

const sessions = new Map<string, TerminalSession>();
const pendingInputs = new Map<string, string[]>();
const maxPendingInputItems = 20;

// 终端输出环形缓冲：按 surface id 保留近期输出，attach 时回放
const outputBuffers = new Map<string, string>();
const blockBuffers = new Map<string, Block[]>();
const maxBlocksPerSession = 500;

const windowsShellPaths = {
  pwsh: "C:\\Program Files\\PowerShell\\7\\pwsh.exe",
  powershell: "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
  cmd: process.env.ComSpec || "C:\\Windows\\System32\\cmd.exe",
  gitBash: "C:\\Program Files\\Git\\bin\\bash.exe"
};

function getAvailableShellProfiles(): ShellProfileOption[] {
  if (process.platform === "win32") {
    const options: ShellProfileOption[] = [
      {
        id: "auto",
        label: existsSync(windowsShellPaths.pwsh) ? "Auto (PowerShell 7)" : "Auto (Windows PowerShell)",
        path: existsSync(windowsShellPaths.pwsh) ? windowsShellPaths.pwsh : windowsShellPaths.powershell
      },
      {
        id: "powershell",
        label: "Windows PowerShell",
        path: windowsShellPaths.powershell
      },
      {
        id: "cmd",
        label: "CMD",
        path: windowsShellPaths.cmd
      }
    ];

    if (existsSync(windowsShellPaths.pwsh)) {
      options.splice(1, 0, {
        id: "pwsh",
        label: "PowerShell 7",
        path: windowsShellPaths.pwsh
      });
    }

    if (existsSync(windowsShellPaths.gitBash)) {
      options.push({
        id: "bash",
        label: "Git Bash",
        path: windowsShellPaths.gitBash
      });
    }

    return options;
  }

  const options: ShellProfileOption[] = [
    {
      id: "auto",
      label: `Auto (${process.env.SHELL || "/bin/bash"})`,
      path: process.env.SHELL
    }
  ];

  if (existsSync("/bin/bash")) {
    options.push({ id: "bash", label: "Bash", path: "/bin/bash" });
  }

  if (existsSync("/bin/zsh")) {
    options.push({ id: "zsh", label: "Zsh", path: "/bin/zsh" });
  }

  return options;
}

function getShell(profile: ShellProfile = "auto"): string {
  if (process.platform === "win32") {
    const profiles: Record<Exclude<ShellProfile, "auto" | "zsh">, string> = {
      pwsh: existsSync(windowsShellPaths.pwsh) ? windowsShellPaths.pwsh : windowsShellPaths.powershell,
      powershell: windowsShellPaths.powershell,
      cmd: windowsShellPaths.cmd,
      bash: windowsShellPaths.gitBash
    };

    if (profile === "pwsh" || profile === "powershell" || profile === "cmd" || profile === "bash") {
      return profiles[profile];
    }

    return existsSync(windowsShellPaths.pwsh) ? windowsShellPaths.pwsh : windowsShellPaths.powershell;
  }

  if (profile === "bash") {
    return "/bin/bash";
  }

  if (profile === "zsh") {
    return "/bin/zsh";
  }

  return process.env.SHELL || "/bin/bash";
}

function getDefaultCwd(cwd?: string): string {
  if (cwd) {
    return path.resolve(cwd);
  }

  return os.homedir();
}

export function registerPtyIpc(): void {
  ipcMain.handle("terminal:listShells", () => getAvailableShellProfiles());

  ipcMain.handle(
    "terminal:create",
    (
      event,
      payload: {
        id: string;
        surfaceId?: string;
        workspaceId?: string;
        cwd?: string;
        cols?: number;
        rows?: number;
        shell?: ShellProfile;
      }
    ) => {
      const existing = sessions.get(payload.id);
      if (existing) {
        // 同会话重 attach：更新 owner，回放历史输出
        existing.owner = event.sender;
        existing.surfaceId = payload.surfaceId ?? existing.surfaceId;
        existing.workspaceId = payload.workspaceId ?? existing.workspaceId;
        const replay = outputBuffers.get(payload.id);
        if (replay) {
          // 重置 SGR 与光标，避免半截 ANSI 序列污染渲染
          event.sender.send("terminal:data", {
            id: payload.id,
            data: `\x1b[0m${replay}`
          });
        }
        const blocks = blockBuffers.get(payload.id);
        if (blocks?.length) {
          event.sender.send("terminal:block", {
            type: "block:list",
            surfaceId: existing.surfaceId,
            blocks
          } satisfies BlockEvent);
        }
        return { id: payload.id };
      }

      const shell = getShell(payload.shell);
      const cwd = getDefaultCwd(payload.cwd);
      const pty = spawn(shell, [], {
        name: "xterm-256color",
        cols: payload.cols ?? 80,
        rows: payload.rows ?? 24,
        cwd,
        env: {
          ...process.env,
          TERM_PROGRAM: "wmux",
          WMUX_SURFACE_ID: payload.surfaceId ?? getSurfaceIdFromSessionId(payload.id),
          WMUX_SESSION_ID: payload.id
        }
      });

      // 跨重启 scrollback：上一会话的输出在 hydrate 阶段进了 outputBuffers，
      // 这里检查到 → 一次性回放给 renderer 并清空，让新 pty 数据从 0 开始累积。
      // 用分隔横幅区分"历史"与"新会话"，避免用户误以为旧 prompt 还活着。
      const persistedReplay = outputBuffers.get(payload.id);
      if (persistedReplay) {
        outputBuffers.delete(payload.id);
        if (!event.sender.isDestroyed()) {
          event.sender.send("terminal:data", {
            id: payload.id,
            data:
              `\x1b[0m\r\n\x1b[2m── wmux scrollback from previous session ──\x1b[0m\r\n` +
              `${persistedReplay}\r\n` +
              `\x1b[2m── new session ──\x1b[0m\r\n\r\n`
          });
        }
      }

      const session: TerminalSession = {
        id: payload.id,
        surfaceId: payload.surfaceId ?? getSurfaceIdFromSessionId(payload.id),
        workspaceId: payload.workspaceId,
        shell: payload.shell ?? "auto",
        cwd,
        pty,
        owner: event.sender,
        blockParser: createBlockParserState()
      };

      sessions.set(payload.id, session);
      const persistedBlocks = blockBuffers.get(payload.id);
      if (persistedBlocks?.length && !event.sender.isDestroyed()) {
        event.sender.send("terminal:block", {
          type: "block:list",
          surfaceId: session.surfaceId,
          blocks: persistedBlocks
        } satisfies BlockEvent);
      }
      pty.onData((data) => {
        // 始终读取最新 owner：re-attach 可能更换 sender
        const currentSession = sessions.get(payload.id);
        const sender = currentSession?.owner;
        if (!currentSession) {
          return;
        }
        const parsedBlocks = parseTerminalBlocks(currentSession.blockParser, {
          sessionId: currentSession.id,
          surfaceId: currentSession.surfaceId,
          workspaceId: currentSession.workspaceId,
          shell: currentSession.shell,
          cwd: currentSession.cwd,
          startLine: getBufferedLineCount(outputBuffers.get(payload.id)),
          data
        });
        if (!sender || sender.isDestroyed()) {
          // 缓冲 OSC 之外的输出，等待下一次 attach 回放
          const { cleaned } = extractOscNotifications(currentSession.surfaceId, parsedBlocks.cleaned);
          if (cleaned) {
            appendToOutputBuffer(outputBuffers, payload.id, cleaned);
          }
          applyBlockEvents(payload.id, parsedBlocks.events);
          return;
        }
        const { cleaned, notifications } = extractOscNotifications(currentSession.surfaceId, parsedBlocks.cleaned);
        if (cleaned) {
          appendToOutputBuffer(outputBuffers, payload.id, cleaned);
          sender.send("terminal:data", { id: payload.id, data: cleaned });
        }
        applyBlockEvents(payload.id, parsedBlocks.events);
        for (const blockEvent of parsedBlocks.events) {
          sender.send("terminal:block", blockEvent);
        }
        for (const notification of notifications) {
          sender.send("terminal:notification", notification);
        }
      });

      pty.onExit(({ exitCode, signal }) => {
        sessions.delete(payload.id);
        outputBuffers.delete(payload.id);
        const sender = event.sender;
        if (!sender.isDestroyed()) {
          sender.send("terminal:exit", { id: payload.id, exitCode, signal });
        }
      });

      event.sender.once("destroyed", () => {
        disposeTerminal(payload.id);
      });

      const pendingInputItems = pendingInputs.get(payload.id);
      if (pendingInputItems) {
        pendingInputs.delete(payload.id);
        pendingInputItems.forEach((data) => pty.write(data));
      }

      return { id: payload.id };
    }
  );

  ipcMain.on("terminal:input", (_event, payload: { id: string; data: string }) => {
    const session = sessions.get(payload.id);
    if (session) {
      session.pty.write(payload.data);
      return;
    }

    const pendingInputItems = pendingInputs.get(payload.id) ?? [];
    pendingInputItems.push(payload.data);
    pendingInputs.set(payload.id, pendingInputItems.slice(-maxPendingInputItems));
  });

  ipcMain.on("terminal:resize", (_event, payload: { id: string; cols: number; rows: number }) => {
    const session = sessions.get(payload.id);
    if (!session) {
      return;
    }

    session.pty.resize(Math.max(2, payload.cols), Math.max(2, payload.rows));
  });

  ipcMain.on("terminal:dispose", (_event, payload: { id: string }) => {
    disposeTerminal(payload.id);
  });
}

// 跨重启持久化：main/index.ts 在 app ready 与 before-quit 时调用
export function hydrateOutputBuffersFromState(state: Map<string, string>): void {
  for (const [id, value] of state) {
    if (typeof value === "string" && value.length > 0) {
      outputBuffers.set(id, value);
    }
  }
}

export function hydrateBlocksFromState(state: Map<string, Block[]>): void {
  for (const [id, blocks] of state) {
    if (Array.isArray(blocks) && blocks.length > 0) {
      blockBuffers.set(id, blocks.slice(-maxBlocksPerSession));
    }
  }
}

export function snapshotOutputBuffers(): Map<string, string> {
  return new Map(outputBuffers);
}

export function snapshotBlocks(): Map<string, Block[]> {
  return new Map([...blockBuffers.entries()].map(([id, blocks]) => [id, blocks.slice(-maxBlocksPerSession)]));
}

function disposeTerminal(id: string): void {
  pendingInputs.delete(id);
  outputBuffers.delete(id);
  blockBuffers.delete(id);
  const session = sessions.get(id);
  if (!session) {
    return;
  }

  sessions.delete(id);
  try {
    session.pty.kill();
  } catch {
    // The process may already be gone; disposal should stay idempotent.
  }
}

function applyBlockEvents(sessionId: string, events: BlockEvent[]): void {
  if (!events.length) {
    return;
  }
  const blocks = blockBuffers.get(sessionId) ?? [];
  for (const event of events) {
    if (event.type === "block:start") {
      blocks.push(event.block);
      continue;
    }
    if (event.type === "block:command") {
      const block = blocks.find((item) => item.id === event.blockId);
      if (block) {
        block.command = event.command;
      }
      continue;
    }
    if (event.type === "block:end") {
      const block = blocks.find((item) => item.id === event.blockId);
      if (block) {
        block.endedAt = event.endedAt;
        block.exitCode = event.exitCode;
        block.status = event.exitCode === 0 ? "success" : "error";
        block.durationMs = Math.max(0, Date.parse(event.endedAt) - Date.parse(block.startedAt));
      }
    }
  }
  blockBuffers.set(sessionId, blocks.slice(-maxBlocksPerSession));
}

function getBufferedLineCount(value: string | undefined): number {
  if (!value) {
    return 0;
  }
  return value.split(/\r\n|\n|\r/).length - 1;
}

function getSurfaceIdFromSessionId(sessionId: string): string {
  const separatorIndex = sessionId.lastIndexOf(":");
  return separatorIndex > 0 ? sessionId.slice(0, separatorIndex) : sessionId;
}

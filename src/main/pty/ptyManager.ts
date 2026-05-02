import { ipcMain, type WebContents } from "electron";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, type IPty } from "node-pty";
import type { ShellProfile, ShellProfileOption } from "../../shared/types";
import { extractOscNotifications } from "./oscNotifications";
import { appendToOutputBuffer } from "./outputBuffer";

type TerminalSession = {
  id: string;
  pty: IPty;
  owner: WebContents;
};

const sessions = new Map<string, TerminalSession>();
const pendingInputs = new Map<string, string[]>();
const maxPendingInputItems = 20;

// 终端输出环形缓冲：按 surface id 保留近期输出，attach 时回放
const outputBuffers = new Map<string, string>();

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
    (event, payload: { id: string; cwd?: string; cols?: number; rows?: number; shell?: ShellProfile }) => {
      const existing = sessions.get(payload.id);
      if (existing) {
        // 同会话重 attach：更新 owner，回放历史输出
        existing.owner = event.sender;
        const replay = outputBuffers.get(payload.id);
        if (replay) {
          // 重置 SGR 与光标，避免半截 ANSI 序列污染渲染
          event.sender.send("terminal:data", {
            id: payload.id,
            data: `\x1b[0m${replay}`
          });
        }
        return { id: payload.id };
      }

      const shell = getShell(payload.shell);
      const pty = spawn(shell, [], {
        name: "xterm-256color",
        cols: payload.cols ?? 80,
        rows: payload.rows ?? 24,
        cwd: getDefaultCwd(payload.cwd),
        env: {
          ...process.env,
          TERM_PROGRAM: "wmux",
          WMUX_SURFACE_ID: payload.id
        }
      });

      const session: TerminalSession = {
        id: payload.id,
        pty,
        owner: event.sender
      };

      sessions.set(payload.id, session);
      const pendingInputItems = pendingInputs.get(payload.id);
      if (pendingInputItems) {
        pendingInputs.delete(payload.id);
        pendingInputItems.forEach((data) => pty.write(data));
      }

      pty.onData((data) => {
        // 始终读取最新 owner：re-attach 可能更换 sender
        const sender = sessions.get(payload.id)?.owner;
        if (!sender || sender.isDestroyed()) {
          // 缓冲 OSC 之外的输出，等待下一次 attach 回放
          const { cleaned } = extractOscNotifications(payload.id, data);
          if (cleaned) {
            appendToOutputBuffer(outputBuffers, payload.id, cleaned);
          }
          return;
        }
        const { cleaned, notifications } = extractOscNotifications(payload.id, data);
        if (cleaned) {
          appendToOutputBuffer(outputBuffers, payload.id, cleaned);
          sender.send("terminal:data", { id: payload.id, data: cleaned });
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

function disposeTerminal(id: string): void {
  pendingInputs.delete(id);
  outputBuffers.delete(id);
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

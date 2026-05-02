import { app, BrowserWindow, ipcMain } from "electron";
import type { AppUpdateStatus } from "../shared/types";

// 自动更新中枢：将 electron-updater 事件桥接到 renderer，
// 提供手动触发与"重启安装"的 IPC handler，并维持 6 小时周期检查。
//
// 设计原则：
// - 单源真相：当前状态保存在 currentStatus，所有 send 必经此变量
// - 静默降级：未打包 / 未配置 publish provider 时不抛出，状态留在 idle
// - electron-updater 通过动态 import 加载，避免模块顶层副作用阻塞 app 启动

const checkIntervalMs = 6 * 60 * 60 * 1000;
const initialCheckDelayMs = 30 * 1000;
const notAvailableLingerMs = 10 * 1000;

type AutoUpdater = {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  on(event: string, listener: (...args: unknown[]) => void): unknown;
  checkForUpdates(): Promise<unknown>;
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void;
};

let currentStatus: AppUpdateStatus = { state: "idle" };
let notAvailableTimer: NodeJS.Timeout | null = null;
let autoUpdaterPromise: Promise<AutoUpdater | null> | null = null;

function broadcastStatus(): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send("app:updateStatus", currentStatus);
    }
  }
}

function setStatus(next: AppUpdateStatus): void {
  currentStatus = next;
  broadcastStatus();

  if (notAvailableTimer) {
    clearTimeout(notAvailableTimer);
    notAvailableTimer = null;
  }
  if (next.state === "not-available") {
    // 短暂展示"已是最新"提示后回落 idle，避免长期占用横幅位置
    notAvailableTimer = setTimeout(() => {
      if (currentStatus.state === "not-available") {
        currentStatus = { state: "idle" };
        broadcastStatus();
      }
      notAvailableTimer = null;
    }, notAvailableLingerMs);
  }
}

async function loadAutoUpdater(): Promise<AutoUpdater | null> {
  if (autoUpdaterPromise) {
    return autoUpdaterPromise;
  }
  autoUpdaterPromise = (async () => {
    try {
      const mod = await import("electron-updater");
      return mod.autoUpdater as unknown as AutoUpdater;
    } catch (error) {
      console.error("[wmux] electron-updater unavailable:", error);
      return null;
    }
  })();
  return autoUpdaterPromise;
}

function attachAutoUpdaterListeners(autoUpdater: AutoUpdater): void {
  autoUpdater.on("checking-for-update", () => {
    setStatus({ state: "checking" });
  });

  autoUpdater.on("update-available", (info: unknown) => {
    const typed = info as { version?: string; releaseNotes?: unknown } | undefined;
    setStatus({
      state: "available",
      version: typed?.version,
      releaseNotes: typeof typed?.releaseNotes === "string" ? typed.releaseNotes : undefined
    });
  });

  autoUpdater.on("update-not-available", () => {
    setStatus({ state: "not-available" });
  });

  autoUpdater.on("download-progress", (progress: unknown) => {
    const typed = progress as { percent?: number } | undefined;
    setStatus({
      state: "downloading",
      version: currentStatus.version,
      progress: typeof typed?.percent === "number" ? Math.round(typed.percent) : undefined
    });
  });

  autoUpdater.on("update-downloaded", (info: unknown) => {
    const typed = info as { version?: string; releaseNotes?: unknown } | undefined;
    setStatus({
      state: "downloaded",
      version: typed?.version,
      releaseNotes: typeof typed?.releaseNotes === "string" ? typed.releaseNotes : undefined
    });
  });

  autoUpdater.on("error", (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    setStatus({ state: "error", error: message });
  });
}

export function registerAppUpdater(): void {
  ipcMain.handle("app:getUpdateStatus", () => currentStatus);

  ipcMain.handle("app:checkForUpdate", async (): Promise<AppUpdateStatus> => {
    if (!app.isPackaged) {
      // 开发模式：直接返回 not-available 一次，UI 会短暂展示后回落 idle
      setStatus({ state: "not-available" });
      return currentStatus;
    }
    const updater = await loadAutoUpdater();
    if (!updater) {
      setStatus({ state: "error", error: "auto-updater unavailable" });
      return currentStatus;
    }
    try {
      await updater.checkForUpdates();
    } catch (error) {
      setStatus({
        state: "error",
        error: error instanceof Error ? error.message : String(error)
      });
    }
    return currentStatus;
  });

  ipcMain.handle("app:installUpdate", async () => {
    if (currentStatus.state !== "downloaded" || !app.isPackaged) {
      return { ok: false };
    }
    const updater = await loadAutoUpdater();
    if (!updater) {
      return { ok: false };
    }
    // setImmediate 让 IPC 回包先返回，再退出
    setImmediate(() => updater.quitAndInstall(false, true));
    return { ok: true };
  });

  if (!app.isPackaged) {
    // 开发模式不挂事件监听，也不启动定时器；renderer 永远看到 idle
    return;
  }

  void loadAutoUpdater().then((updater) => {
    if (!updater) {
      return;
    }
    attachAutoUpdaterListeners(updater);
    updater.autoDownload = true;
    updater.autoInstallOnAppQuit = true;

    setTimeout(() => {
      updater.checkForUpdates().catch((error: unknown) => {
        setStatus({
          state: "error",
          error: error instanceof Error ? error.message : String(error)
        });
      });
    }, initialCheckDelayMs);

    setInterval(() => {
      updater.checkForUpdates().catch(() => {
        // 周期失败不污染状态：保留之前的 status，仅静默吞掉
      });
    }, checkIntervalMs);
  });
}

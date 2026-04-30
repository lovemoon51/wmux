import { _electron as electron } from "playwright";
import electronPath from "electron";
import { appendFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const logPath = "output/playwright/terminal-smoke.log";
const smokeUserDataPath = resolve("output/playwright/wmux-smoke-user-data");
const smokeSocketPath = process.platform === "win32" ? "\\\\.\\pipe\\wmux-smoke" : resolve("output/playwright/wmux-smoke.sock");
rmSync(smokeUserDataPath, { force: true, recursive: true });
mkdirSync(smokeUserDataPath, { recursive: true });
writeFileSync(logPath, "");

function log(message) {
  console.log(message);
  appendFileSync(logPath, `${message}\n`);
}

async function launchApp() {
  return electron.launch({
    executablePath: electronPath,
    args: ["out/main/index.js"],
    env: {
      ...process.env,
      WMUX_USER_DATA_DIR: smokeUserDataPath,
      WMUX_SOCKET_PATH: smokeSocketPath
    }
  });
}

async function getReadyWindow(app) {
  const window = await app.firstWindow();
  await window.waitForLoadState("domcontentloaded");
  log(`loaded ${window.url()}`);
  await window.waitForSelector(".terminalHost .xterm textarea", { state: "attached", timeout: 15_000 });
  return window;
}

async function runTerminalCommand(window, command, expectedText) {
  log(`run ${command}`);
  await window.locator(".paneActive .surfaceBodyFrameActive .terminalHost").click();
  await window.keyboard.type(command);
  await window.keyboard.press("Enter");
  await window.waitForFunction((text) => document.body.textContent?.includes(text), expectedText, {
    timeout: 15_000
  });
  log(`ok ${command}`);
}


async function runCliCommand(args) {
  const { stdout, stderr } = await execFileAsync(process.execPath, ["scripts/wmux-cli.mjs", ...args], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      WMUX_SOCKET_PATH: smokeSocketPath
    },
    timeout: 10_000
  });
  return `${stdout}${stderr}`.trim();
}

async function runCliSocketSmoke(window) {
  log("cli socket");

  const pingOutput = await runCliCommand(["ping"]);
  if (!pingOutput.includes("pong")) {
    throw new Error(`wmux ping did not return pong: ${pingOutput}`);
  }
  log("ok wmux ping");

  const workspaceOutput = await runCliCommand(["list-workspaces"]);
  if (!workspaceOutput.includes("API Server")) {
    throw new Error(`wmux list-workspaces did not include API Server: ${workspaceOutput}`);
  }
  log("ok wmux list-workspaces");

  await window.locator('button.surfaceTab[aria-label="Codex Agent"]').click();
  await window.waitForSelector(".paneActive .surfaceBodyFrameActive .terminalHost .xterm textarea", {
    state: "attached",
    timeout: 15_000
  });
  const sendOutput = await runCliCommand(["send", "Write-Output WMUX_CLI_SEND\n"]);
  if (!sendOutput.includes("sent")) {
    throw new Error(`wmux send did not report sent bytes: ${sendOutput}`);
  }
  await window.waitForFunction(() => document.body.textContent?.includes("WMUX_CLI_SEND"), null, {
    timeout: 15_000
  });
  log("ok wmux send");

  const notifyOutput = await runCliCommand([
    "notify",
    "--title",
    "WMUX_CLI_NOTIFY",
    "--body",
    "socket smoke"
  ]);
  if (!notifyOutput.includes("notified")) {
    throw new Error(`wmux notify did not report success: ${notifyOutput}`);
  }
  await window.waitForFunction(() => document.body.textContent?.includes("WMUX_CLI_NOTIFY: socket smoke"), null, {
    timeout: 15_000
  });
  log("ok wmux notify");
}

async function closeSurface(window, name) {
  log(`close ${name}`);
  await window.getByLabel(`Close ${name}`).click();
  await window.waitForFunction((text) => !document.body.textContent?.includes(text), name, {
    timeout: 15_000
  });
  log(`ok close ${name}`);
}

async function runWorkspaceCrud(window) {
  log("workspace crud");
  await window.getByLabel("New workspace").click();
  await window.getByRole("heading", { name: "Workspace 1" }).waitFor({ timeout: 15_000 });
  await window.getByLabel("Rename workspace Workspace 1").click();
  await window.getByLabel("Workspace name").fill("Smoke Workspace");
  await window.keyboard.press("Enter");
  await window.getByRole("heading", { name: "Smoke Workspace" }).waitFor({ timeout: 15_000 });
  await runTerminalCommand(window, "Write-Output WMUX_WORKSPACE_SMOKE", "WMUX_WORKSPACE_SMOKE");

  await window.getByLabel("Open workspace API Server").click();
  await window.getByRole("heading", { name: "API Server" }).waitFor({ timeout: 15_000 });

  await window.getByLabel("Open workspace Smoke Workspace").click();
  await window.getByRole("heading", { name: "Smoke Workspace" }).waitFor({ timeout: 15_000 });

  await window.getByLabel("Rename workspace Smoke Workspace").click();
  await window.getByLabel("Workspace name").fill("Smoke Renamed");
  await window.keyboard.press("Enter");
  await window.getByRole("heading", { name: "Smoke Renamed" }).waitFor({ timeout: 15_000 });

  await window.getByLabel("Close workspace Smoke Renamed").click();
  await window.waitForFunction(() => !document.body.textContent?.includes("Smoke Renamed"), null, {
    timeout: 15_000
  });
  await window.getByLabel("Open workspace API Server").click();
  await window.getByRole("heading", { name: "API Server" }).waitFor({ timeout: 15_000 });
  log("ok workspace crud");
}

async function runSplitCrud(window) {
  log("split crud");
  await window.getByLabel("New workspace").click();
  await window.getByRole("heading", { name: "Workspace 2" }).waitFor({ timeout: 15_000 });
  await window.getByLabel("Rename workspace Workspace 2").click();
  await window.getByLabel("Workspace name").fill("Split Smoke");
  await window.keyboard.press("Enter");
  await window.getByRole("heading", { name: "Split Smoke" }).waitFor({ timeout: 15_000 });

  await window.getByLabel("Split horizontally").click();
  await window.waitForFunction(() => document.querySelectorAll(".pane").length >= 2, null, { timeout: 15_000 });
  await runTerminalCommand(window, "Write-Output WMUX_SPLIT_HORIZONTAL", "WMUX_SPLIT_HORIZONTAL");
  const horizontalSplit = window.locator(".split-horizontal").first();
  const horizontalRatioBefore = await horizontalSplit.evaluate((element) =>
    getComputedStyle(element).getPropertyValue("--split-ratio").trim()
  );
  const horizontalBox = await horizontalSplit.boundingBox();
  if (!horizontalBox) {
    throw new Error("Horizontal split did not expose a bounding box");
  }
  await window
    .getByLabel("Resize horizontal split")
    .first()
    .dragTo(horizontalSplit, {
      targetPosition: {
        x: horizontalBox.width * 0.65,
        y: horizontalBox.height / 2
      }
    });
  await window.waitForFunction(
    (before) =>
      getComputedStyle(document.querySelector(".split-horizontal")).getPropertyValue("--split-ratio").trim() !== before,
    horizontalRatioBefore,
    { timeout: 15_000 }
  );

  await window.getByLabel("Split vertically").click();
  await window.waitForFunction(() => document.querySelectorAll(".pane").length >= 3, null, { timeout: 15_000 });
  await runTerminalCommand(window, "Write-Output WMUX_SPLIT_VERTICAL", "WMUX_SPLIT_VERTICAL");
  await window.locator(".paneActive").getByLabel("Close pane").click();
  await window.waitForFunction(() => document.querySelectorAll(".pane").length === 2, null, { timeout: 15_000 });

  await window.getByLabel("Close workspace Split Smoke").click();
  await window.waitForFunction(() => !document.body.textContent?.includes("Split Smoke"), null, {
    timeout: 15_000
  });
  await window.getByLabel("Open workspace API Server").click();
  await window.getByRole("heading", { name: "API Server" }).waitFor({ timeout: 15_000 });
  log("ok split crud");
}

async function runBrowserCrud(window) {
  log("browser crud");
  await window.getByLabel("Open workspace API Server").click();
  await window.getByRole("heading", { name: "API Server" }).waitFor({ timeout: 15_000 });
  await window.getByRole("button", { name: "Browser" }).click();
  const activePane = window.locator(".paneActive");
  const browserTab = window.locator(".paneActive button.surfaceTab").filter({ hasText: /Browser/ }).last();
  await browserTab.waitFor({ timeout: 15_000 });

  const firstUrl = "data:text/html,<title>WMUX Browser One</title><h1>WMUX_BROWSER_ONE</h1>";
  const secondUrl = "data:text/html,<title>WMUX Browser Two</title><h1>WMUX_BROWSER_TWO</h1>";
  const address = activePane.getByLabel("Browser address");

  await address.fill(firstUrl);
  await window.keyboard.press("Enter");
  await window.waitForFunction(
    (targetUrl) => document.querySelector(".paneActive webview")?.getURL?.() === targetUrl,
    firstUrl,
    { timeout: 15_000 }
  );
  log("ok browser first url");
  const browserMetrics = await activePane.locator("webview").evaluate((webview) => {
    const rect = webview.getBoundingClientRect();
    return {
      elementWidth: rect.width,
      elementHeight: rect.height
    };
  });
  if (browserMetrics.elementHeight < 320 || browserMetrics.elementWidth < 320) {
    throw new Error(`Browser webview viewport is clipped: ${JSON.stringify(browserMetrics)}`);
  }
  const browserRootSplit = window.locator(".split-horizontal").first();
  const browserRootSplitBox = await browserRootSplit.boundingBox();
  if (!browserRootSplitBox) {
    throw new Error("Browser root split did not expose a bounding box");
  }
  await window
    .getByLabel("Resize horizontal split")
    .first()
    .dragTo(browserRootSplit, {
      targetPosition: {
        x: browserRootSplitBox.width * 0.76,
        y: browserRootSplitBox.height / 2
      }
    });
  await window.waitForTimeout(500);
  await activePane.locator("webview").waitFor({ timeout: 15_000 });
  log("ok browser resize adaptive");
  const resizedBrowserWidth = await activePane.locator("webview").evaluate((webview) => webview.getBoundingClientRect().width);
  await window.waitForFunction(
    async ({ shouldZoom }) => {
      const zoomFactor = await document.querySelector(".paneActive webview")?.getZoomFactor?.();
      return typeof zoomFactor === "number" && (!shouldZoom || zoomFactor < 0.98);
    },
    { shouldZoom: resizedBrowserWidth < 960 },
    { timeout: 15_000 }
  );
  log("ok browser auto zoom fit");

  await address.fill(secondUrl);
  await window.keyboard.press("Enter");
  await window.waitForFunction(
    (targetUrl) => document.querySelector(".paneActive webview")?.getURL?.() === targetUrl,
    secondUrl,
    { timeout: 15_000 }
  );
  log("ok browser second url");

  await activePane.getByLabel("Back").click();
  await window.waitForFunction(
    (targetUrl) => document.querySelector(".paneActive webview")?.getURL?.() === targetUrl,
    firstUrl,
    { timeout: 15_000 }
  );
  log("ok browser back");

  await expectEnabled(activePane.getByLabel("Forward"));
  await activePane.getByLabel("Forward").click();
  await window.waitForFunction(
    (targetUrl) => document.querySelector(".paneActive webview")?.getURL?.() === targetUrl,
    secondUrl,
    { timeout: 15_000 }
  );
  log("ok browser forward");

  await activePane.getByLabel("Reload").click();
  await window.waitForFunction(
    (targetUrl) => document.querySelector(".paneActive webview")?.getURL?.() === targetUrl,
    secondUrl,
    { timeout: 15_000 }
  );
  log("ok browser reload");

  const paneCountBeforeBrowserSplit = await window.locator(".pane").count();
  await window.getByLabel("Split vertically").click();
  await window.waitForFunction(
    (count) => document.querySelectorAll(".pane").length === count + 1,
    paneCountBeforeBrowserSplit,
    { timeout: 15_000 }
  );
  await window.waitForFunction(
    (targetUrl) => Array.from(document.querySelectorAll("webview")).some((webview) => webview.getURL?.() === targetUrl),
    secondUrl,
    { timeout: 15_000 }
  );
  log("ok browser split url retained");
  const splitBrowserMetrics = await window.locator("webview").evaluateAll((webviews, targetUrl) => {
    const targetWebview = webviews.find((webview) => webview.getURL?.() === targetUrl);
    if (!targetWebview) {
      return null;
    }

    const rect = targetWebview.getBoundingClientRect();
    return { height: rect.height, width: rect.width, url: targetWebview.getURL?.() };
  }, secondUrl);
  if (!splitBrowserMetrics || splitBrowserMetrics.height < 160 || splitBrowserMetrics.width < 220) {
    throw new Error(`Browser content was lost after split: ${JSON.stringify(splitBrowserMetrics)}`);
  }
  log("ok browser split content retained");
  await window.locator(".paneActive").getByLabel("Close pane").click();
  await window.waitForFunction(
    (count) => document.querySelectorAll(".pane").length === count,
    paneCountBeforeBrowserSplit,
    { timeout: 15_000 }
  );

  await window.locator('button.surfaceTab[aria-label="Codex Agent"]').click();
  await window.waitForSelector(".paneActive .terminalHost .xterm textarea", { state: "attached", timeout: 15_000 });
  log("ok browser crud");
}

async function expectEnabled(locator) {
  await locator.waitFor({ timeout: 15_000 });
  await locator.page().waitForFunction((element) => !element.disabled, await locator.elementHandle(), {
    timeout: 15_000
  });
}

async function runSessionRestoreSmoke(currentApp, window) {
  log("session restore");
  await window.getByLabel("New workspace").click();
  await window.getByRole("heading", { name: /Workspace/ }).waitFor({ timeout: 15_000 });
  const workspaceHeading = await window.locator(".titleIdentity h1").textContent();
  if (!workspaceHeading) {
    throw new Error("New workspace heading was empty before restore smoke");
  }

  await window.getByLabel(`Rename workspace ${workspaceHeading}`).click();
  await window.getByLabel("Workspace name").fill("Restore Smoke");
  await window.keyboard.press("Enter");
  await window.getByRole("heading", { name: "Restore Smoke" }).waitFor({ timeout: 15_000 });
  await window.getByRole("button", { name: "Browser" }).click();
  const restoreUrl = "data:text/html,<title>WMUX Restore</title><h1>WMUX_RESTORE_BROWSER</h1>";
  await window.locator(".paneActive").getByLabel("Browser address").fill(restoreUrl);
  await window.keyboard.press("Enter");
  await window.waitForFunction(
    (targetUrl) => document.querySelector(".paneActive webview")?.getURL?.() === targetUrl,
    restoreUrl,
    { timeout: 15_000 }
  );
  await window.getByLabel("Split horizontally").click();
  await window.waitForFunction(() => document.querySelectorAll(".pane").length >= 2, null, { timeout: 15_000 });
  await window.waitForTimeout(700);

  await Promise.race([currentApp.close(), new Promise((resolve) => setTimeout(resolve, 3_000))]);
  const restoredApp = await launchApp();
  const restoredWindow = await getReadyWindow(restoredApp);
  await restoredWindow.getByRole("heading", { name: "Restore Smoke" }).waitFor({ timeout: 15_000 });
  await restoredWindow.waitForFunction(() => document.querySelectorAll(".pane").length >= 2, null, {
    timeout: 15_000
  });
  await restoredWindow.waitForFunction(
    (targetUrl) => Array.from(document.querySelectorAll("webview")).some((webview) => webview.getURL?.() === targetUrl),
    restoreUrl,
    { timeout: 15_000 }
  );
  await restoredWindow.locator("button.surfaceTab").filter({ hasText: /Browser/ }).first().waitFor({ timeout: 15_000 });
  log("ok session restore");

  return { app: restoredApp, window: restoredWindow };
}

let app;

try {
  app = await launchApp();
  let window = await getReadyWindow(app);
  const shellOptions = await window
    .locator('select[aria-label="Terminal shell"] option')
    .evaluateAll((options) => options.map((option) => ({ value: option.value, label: option.textContent })));
  log(`shell options ${JSON.stringify(shellOptions)}`);

  await runWorkspaceCrud(window);
  await runSplitCrud(window);
  await runBrowserCrud(window);
  await runCliSocketSmoke(window);

  await runTerminalCommand(window, "pwd", "D:\\IdeaProject\\codex\\wmux");
  await runTerminalCommand(window, "ls package.json", "package.json");
  await runTerminalCommand(window, "clear", "Codex Agent");
  await runTerminalCommand(window, "Write-Output WMUX_TERMINAL_SMOKE", "WMUX_TERMINAL_SMOKE");
  log("add terminal surface");
  const activePaneTabs = window.locator(".paneActive button.surfaceTab");
  const tabCountBeforeAdd = await activePaneTabs.count();
  await window.locator(".paneActive .surfaceAdd").click();
  await window.waitForFunction((count) => document.querySelectorAll(".paneActive button.surfaceTab").length === count + 1, tabCountBeforeAdd, {
    timeout: 15_000
  });
  const newTerminalTab = activePaneTabs.nth(tabCountBeforeAdd);
  const newTerminalName = await newTerminalTab.getAttribute("aria-label");
  if (!newTerminalName) {
    throw new Error("New terminal tab did not expose an aria-label");
  }
  await runTerminalCommand(window, "Write-Output WMUX_NEW_TAB_SMOKE", "WMUX_NEW_TAB_SMOKE");
  log("drag terminal surface to split");
  const paneCountBeforeTabDrag = await window.locator(".pane").count();
  const tabDragTargetPane = window.locator(".paneActive").first();
  const tabDragTargetBox = await tabDragTargetPane.boundingBox();
  if (!tabDragTargetBox) {
    throw new Error("Active pane did not expose a bounding box for tab drag");
  }
  await newTerminalTab.dragTo(tabDragTargetPane, {
    targetPosition: {
      x: tabDragTargetBox.width - 12,
      y: tabDragTargetBox.height / 2
    }
  });
  await window.waitForFunction(
    (count) => document.querySelectorAll(".pane").length === count + 1,
    paneCountBeforeTabDrag,
    { timeout: 15_000 }
  );
  await runTerminalCommand(window, "Write-Output WMUX_DRAG_SPLIT_SMOKE", "WMUX_DRAG_SPLIT_SMOKE");
  await window.locator(".paneActive").getByLabel("Close pane").click();
  await window.waitForFunction(
    (count) => document.querySelectorAll(".pane").length === count,
    paneCountBeforeTabDrag,
    { timeout: 15_000 }
  );

  log("drag single-surface pane into another pane");
  await window.locator('button.surfaceTab[aria-label="Codex Agent"]').click();
  await window.getByLabel("Split horizontally").click();
  await window.waitForFunction(
    (count) => document.querySelectorAll(".pane").length === count + 1,
    paneCountBeforeTabDrag,
    { timeout: 15_000 }
  );
  const paneCountBeforeSinglePaneDrag = await window.locator(".pane").count();
  const singleSurfaceTab = window.locator(".paneActive button.surfaceTab").first();
  const singleSurfaceTabDraggable = await singleSurfaceTab.getAttribute("draggable");
  if (singleSurfaceTabDraggable !== "true") {
    throw new Error(`Single-surface tab should be draggable, got ${singleSurfaceTabDraggable}`);
  }
  const targetPane = window.locator(".pane:not(.paneActive)").first();
  const targetPaneBox = await targetPane.boundingBox();
  if (!targetPaneBox) {
    throw new Error("Target pane did not expose a bounding box for single-surface drag");
  }
  await singleSurfaceTab.dragTo(targetPane, {
    targetPosition: {
      x: 12,
      y: targetPaneBox.height / 2
    }
  });
  await window.waitForFunction(
    (count) => document.querySelectorAll(".pane").length === count,
    paneCountBeforeSinglePaneDrag,
    { timeout: 15_000 }
  );
  await runTerminalCommand(window, "Write-Output WMUX_SINGLE_PANE_DRAG_SMOKE", "WMUX_SINGLE_PANE_DRAG_SMOKE");
  await window.locator(".paneActive").getByLabel("Close pane").click();
  await window.waitForFunction(
    (count) => document.querySelectorAll(".pane").length === count,
    paneCountBeforeTabDrag,
    { timeout: 15_000 }
  );
  await window.locator('button.surfaceTab[aria-label="Codex Agent"]').click();
  await window.waitForFunction(() => document.body.textContent?.includes("WMUX_TERMINAL_SMOKE"), null, {
    timeout: 15_000
  });
  await window.waitForSelector(".paneActive .surfaceBodyFrameActive .terminalHost .xterm textarea", {
    state: "attached",
    timeout: 15_000
  });

  if (shellOptions.some((option) => option.value === "pwsh")) {
    log("select pwsh");
    await window.selectOption('select[aria-label="Terminal shell"]', "pwsh");
    await window.waitForSelector(".terminalHost .xterm textarea", { state: "attached", timeout: 15_000 });
    await runTerminalCommand(window, "Write-Output WMUX_PWSH_PROFILE", "WMUX_PWSH_PROFILE");
  }

  if (shellOptions.some((option) => option.value === "bash")) {
    log("select bash");
    await window.selectOption('select[aria-label="Terminal shell"]', "bash");
    await window.waitForSelector(".terminalHost .xterm textarea", { state: "attached", timeout: 15_000 });
    await runTerminalCommand(window, "echo WMUX_BASH_PROFILE", "WMUX_BASH_PROFILE");
  }

  ({ app, window } = await runSessionRestoreSmoke(app, window));

  await window.setViewportSize({ width: 1040, height: 720 });
  await runTerminalCommand(window, "Write-Output WMUX_RESIZE_SMOKE", "WMUX_RESIZE_SMOKE");

  log("terminal smoke ok");
} catch (error) {
  const window = app?.windows()[0];
  await window?.screenshot({ path: "output/playwright/electron-terminal-smoke-failure.png" }).catch(() => {});
  console.error((await window?.title().catch(() => "unknown title")) ?? "no window");
  console.error((await window?.locator("body").textContent().catch(() => "no body")) ?? "no body");
  throw error;
} finally {
  if (app) {
    await Promise.race([app.close(), new Promise((resolve) => setTimeout(resolve, 3_000))]);
  }
}

process.exit(0);

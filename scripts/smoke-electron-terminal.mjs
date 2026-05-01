import { _electron as electron } from "playwright";
import electronPath from "electron";
import { execFile, spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { appendFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const logPath = "output/playwright/terminal-smoke.log";
const smokeUserDataPath = resolve("output/playwright/wmux-smoke-user-data");
const smokeWorkspaceStatePath = resolve(smokeUserDataPath, "workspace-state.json");
const smokeSocketPath = process.platform === "win32" ? "\\\\.\\pipe\\wmux-smoke" : resolve("output/playwright/wmux-smoke.sock");
const smokeSocketToken = "terminal-smoke-token";
const smokePortServerPath = resolve("output/playwright/wmux-smoke-port-server.mjs");
const globalConfigPath = resolve("output/playwright/wmux-global.json");
const projectConfigPath = resolve("wmux.json");
const projectConfigBackupPath = resolve("output/playwright/wmux-json.backup");
const hadProjectConfig = existsSync(projectConfigPath);
const originalProjectConfig = hadProjectConfig ? readFileSync(projectConfigPath, "utf8") : "";
rmSync(smokeUserDataPath, { force: true, recursive: true });
mkdirSync(smokeUserDataPath, { recursive: true });
mkdirSync(resolve("output/playwright"), { recursive: true });
writeFileSync(logPath, "");
writeFileSync(
  smokePortServerPath,
  `import http from "node:http";
const server = http.createServer((_request, response) => response.end("wmux smoke port"));
server.listen(0, "127.0.0.1", () => {
  console.log(server.address().port);
});
process.on("SIGTERM", () => server.close(() => process.exit(0)));
`,
  "utf8"
);
if (hadProjectConfig) {
  writeFileSync(projectConfigBackupPath, originalProjectConfig, "utf8");
}
writeFileSync(
  globalConfigPath,
  `${JSON.stringify(
    {
      commands: [
        {
          name: "Run Global Marker",
          description: "从全局 wmux.json 写入 smoke 标记",
          keywords: ["global", "marker"],
          command: "Write-Output WMUX_GLOBAL_COMMAND"
        },
        {
          name: "Run Smoke Marker",
          description: "全局命令会被项目同名命令覆盖",
          keywords: ["global", "shadow"],
          command: "Write-Output WMUX_GLOBAL_SHADOW"
        }
      ]
    },
    null,
    2
  )}\n`,
  "utf8"
);
writeFileSync(
  projectConfigPath,
  `${JSON.stringify(
    {
      commands: [
        {
          name: "Run Smoke Marker",
          description: "向当前终端写入 smoke 标记",
          keywords: ["smoke", "marker"],
          command: "Write-Output WMUX_COMMAND_SMOKE"
        },
        {
          name: "Open Confirm Layout",
          description: "确认后重建已有工作区",
          keywords: ["layout", "confirm"],
          restart: "confirm",
          workspace: {
            name: "Command Confirm Smoke",
            cwd: ".",
            layout: {
              pane: {
                surfaces: [
                  {
                    type: "terminal",
                    name: "Confirm Terminal",
                    command: "Write-Output WMUX_CONFIRM_LAYOUT",
                    focus: true
                  }
                ]
              }
            }
          }
        },
        {
          name: "Open Recreate Layout",
          description: "直接重建已有工作区",
          keywords: ["layout", "recreate"],
          restart: "recreate",
          workspace: {
            name: "Command Recreate Smoke",
            cwd: ".",
            layout: {
              pane: {
                surfaces: [
                  {
                    type: "terminal",
                    name: "Recreate Terminal",
                    command: "Write-Output WMUX_RECREATE_LAYOUT",
                    focus: true
                  }
                ]
              }
            }
          }
        },
        {
          name: "Open Dev Layout",
          description: "创建包含终端和浏览器的工作区",
          keywords: ["layout", "dev"],
          restart: "ignore",
          workspace: {
            name: "Command Layout Smoke",
            cwd: ".",
            layout: {
              direction: "horizontal",
              split: 0.55,
              children: [
                {
                  pane: {
                    surfaces: [
                      {
                        type: "terminal",
                        name: "Layout Terminal",
                        command: "Write-Output WMUX_LAYOUT_TERMINAL",
                        focus: true
                      }
                    ]
                  }
                },
                {
                  pane: {
                    surfaces: [
                      {
                        type: "browser",
                        name: "Layout Browser",
                        url: "data:text/html,<title>WMUX Layout</title><h1>WMUX_LAYOUT_BROWSER</h1>"
                      }
                    ]
                  }
                }
              ]
            }
          }
        }
      ]
    },
    null,
    2
  )}\n`,
  "utf8"
);


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
      WMUX_GLOBAL_CONFIG_PATH: globalConfigPath,
      WMUX_SOCKET_PATH: smokeSocketPath,
      WMUX_SOCKET_TOKEN: smokeSocketToken
    }
  });
}

async function startSmokePortServer() {
  const child = spawn(process.execPath, [smokePortServerPath], {
    cwd: process.cwd(),
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });

  const port = await new Promise((resolvePort, reject) => {
    const timer = setTimeout(() => reject(new Error("timed out waiting for smoke port server")), 10_000);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      const match = String(chunk).match(/\d+/);
      if (match) {
        clearTimeout(timer);
        resolvePort(Number(match[0]));
      }
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`smoke port server exited early: ${code}`));
    });
  });

  return { child, port };
}

async function stopSmokePortServer(server) {
  if (!server) {
    return;
  }

  server.child.kill();
  await new Promise((resolveStop) => {
    const timer = setTimeout(resolveStop, 2000);
    server.child.once("exit", () => {
      clearTimeout(timer);
      resolveStop();
    });
  });
}

async function getReadyWindow(app) {
  const window = await app.firstWindow();
  await window.waitForLoadState("domcontentloaded");
  log(`loaded ${window.url()}`);
  await window.waitForSelector(".terminalHost .xterm textarea", { state: "attached", timeout: 15_000 });
  return window;
}

async function runWorkspaceInspectionSmoke(window, expectedPort) {
  log("workspace inspection");
  const apiWorkspaceItem = window.locator(".workspaceItem").filter({ hasText: "API Server" }).first();
  await apiWorkspaceItem.getByText(/:\d+/).waitFor({ timeout: 15_000 });
  await apiWorkspaceItem.getByText("main").waitFor({ timeout: 15_000 });
  await window.waitForFunction((port) => document.body.textContent?.includes(`:${port}`), expectedPort, {
    timeout: 15_000
  });
  log("ok workspace inspection");
}

async function runSettingsSmoke(window) {
  log("settings");
  await window.getByRole("button", { name: "Settings" }).click();
  await window.getByLabel("Settings panel").waitFor({ timeout: 15_000 });
  await window.getByLabel("Socket security mode").selectOption("token");
  await window.getByRole("button", { name: "Save" }).click();
  await window.getByText("restart required").waitFor({ timeout: 15_000 });
  log("ok settings socket security");
}

async function runKeyboardShortcutSmoke(window) {
  log("keyboard shortcuts");
  await window.getByRole("button", { name: "Settings" }).click();
  await window.getByRole("heading", { name: "API Server" }).click();

  const workspaceCountBefore = await window.locator(".workspaceItem").count();
  await window.keyboard.press("Control+Shift+N");
  await window.waitForFunction((count) => document.querySelectorAll(".workspaceItem").length === count + 1, workspaceCountBefore, {
    timeout: 15_000
  });
  await window.waitForFunction(() => document.querySelector(".titleIdentity h1")?.textContent?.startsWith("Workspace"), null, {
    timeout: 15_000
  });
  log("ok shortcut new workspace");

  await window.locator(".titleIdentity h1").click();
  const tabCountBeforeTerminal = await window.locator(".paneActive button.surfaceTab").count();
  await window.keyboard.press("Control+Shift+Enter");
  await window.waitForFunction(
    (count) => document.querySelectorAll(".paneActive button.surfaceTab").length === count + 1,
    tabCountBeforeTerminal,
    { timeout: 15_000 }
  );
  log("ok shortcut add terminal");

  await window.locator(".titleIdentity h1").click();
  const tabCountBeforeBrowser = await window.locator(".paneActive button.surfaceTab").count();
  await window.keyboard.press("Control+Shift+B");
  await window.waitForFunction(
    (count) => document.querySelectorAll(".paneActive button.surfaceTab").length === count + 1,
    tabCountBeforeBrowser,
    { timeout: 15_000 }
  );
  await window.locator(".paneActive webview").waitFor({ timeout: 15_000 });
  log("ok shortcut add browser");

  await window.locator(".titleIdentity h1").click();
  const paneCountBeforeSplit = await window.locator(".pane").count();
  await window.keyboard.press("Control+Alt+ArrowDown");
  await window.waitForFunction((count) => document.querySelectorAll(".pane").length === count + 1, paneCountBeforeSplit, {
    timeout: 15_000
  });
  log("ok shortcut split vertical");

  await window.getByLabel("Open workspace API Server").click();
  await window.getByRole("heading", { name: "API Server" }).click();
  await window.keyboard.press("Control+PageDown");
  await window.getByRole("heading", { name: "Frontend" }).waitFor({ timeout: 15_000 });
  await window.getByRole("heading", { name: "Frontend" }).click();
  await window.keyboard.press("Control+PageUp");
  await window.getByRole("heading", { name: "API Server" }).waitFor({ timeout: 15_000 });
  log("ok shortcut workspace switch");
}

async function runCompactLayoutSmoke(window) {
  log("compact layout");
  await window.setViewportSize({ width: 1280, height: 800 });
  await window.getByLabel("Open workspace API Server").click();
  await window.getByRole("heading", { name: "API Server" }).waitFor({ timeout: 15_000 });

  const metrics = await window.evaluate(() => {
    const viewportWidth = document.documentElement.clientWidth;
    const offenders = [...document.querySelectorAll(".titleBar, .surfaceTabs, .surfaceTab, .toolbarButton, .commandButton, .shellSelectLabel")].flatMap(
      (element) => {
        const rect = element.getBoundingClientRect();
        const overflowX = Math.ceil(element.scrollWidth - element.clientWidth);
        const outsideViewport = rect.left < -1 || rect.right > viewportWidth + 1;
        if (overflowX > 1 || outsideViewport) {
          return [
            {
              className: element.className,
              text: element.textContent?.trim().slice(0, 80),
              overflowX,
              left: Math.round(rect.left),
              right: Math.round(rect.right),
              viewportWidth
            }
          ];
        }

        return [];
      }
    );

    return {
      bodyOverflowX: Math.ceil(document.documentElement.scrollWidth - document.documentElement.clientWidth),
      offenders
    };
  });

  if (metrics.bodyOverflowX > 1 || metrics.offenders.length > 0) {
    throw new Error(`Compact layout overflow: ${JSON.stringify(metrics)}`);
  }

  log("ok compact layout");
}

async function runWorkspaceSwitchLatencySmoke(window) {
  log("workspace switch latency");
  await window.waitForFunction(() => document.querySelectorAll(".workspaceItem").length >= 4, null, {
    timeout: 15_000
  });

  const workspaceNames = await window.evaluate(() =>
    [...document.querySelectorAll(".workspaceSelect")]
      .map((element) => element.getAttribute("aria-label")?.replace(/^Open workspace /, ""))
      .filter(Boolean)
      .slice(0, 4)
  );
  if (workspaceNames.length < 4) {
    throw new Error(`Expected at least 4 workspaces for switch latency smoke, got ${workspaceNames.length}`);
  }

  const samples = [];
  for (const workspaceName of [...workspaceNames, workspaceNames[0]]) {
    const startedAt = Date.now();
    await window.getByLabel(`Open workspace ${workspaceName}`).click();
    await window.getByRole("heading", { name: workspaceName }).waitFor({ timeout: 15_000 });
    samples.push(Date.now() - startedAt);
  }

  const maxMs = Math.max(...samples);
  const totalMs = samples.reduce((sum, value) => sum + value, 0);
  if (maxMs > 1_500 || totalMs > 4_000) {
    throw new Error(`Workspace switch latency exceeded threshold: ${JSON.stringify({ samples, maxMs, totalMs })}`);
  }

  log(`ok workspace switch latency ${JSON.stringify({ samples, maxMs, totalMs })}`);
}

async function runTerminalCommand(window, command, expectedText) {
  log(`run ${command}`);
  const textarea = window.locator(".paneActive .surfaceBodyFrameActive .terminalHost .xterm textarea");
  await textarea.waitFor({ state: "attached", timeout: 15_000 });
  await textarea.click();
  await textarea.fill(command);
  await window.keyboard.press("Enter");
  await window.waitForFunction((text) => document.body.textContent?.includes(text), expectedText, {
    timeout: 15_000
  });
  log(`ok ${command}`);
}

async function waitForActiveTerminalRowText(window, text) {
  await window.waitForFunction(
    (expectedText) =>
      Array.from(document.querySelectorAll(".paneActive .surfaceBodyFrameActive .terminalHost .xterm-rows > div")).some((row) =>
        row.textContent?.includes(expectedText)
      ),
    text,
    { timeout: 15_000 }
  );
}

async function runTerminalSelectionStabilitySmoke(window) {
  log("terminal selection stability");
  const terminal = window.locator(".paneActive .surfaceBodyFrameActive .terminalHost .xterm").first();
  await terminal.waitFor({ state: "attached", timeout: 15_000 });
  const box = await terminal.boundingBox();
  if (!box) {
    throw new Error("Terminal did not expose a bounding box for selection stability smoke");
  }

  const stayedMounted = await terminal.evaluate(async (terminalElement) => {
    window.__wmuxSelectionSmokeTerminal = terminalElement;
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    return window.__wmuxSelectionSmokeTerminal === terminalElement && terminalElement.isConnected;
  });
  if (!stayedMounted) {
    throw new Error("Terminal remounted before selection stability smoke could start");
  }

  await window.mouse.move(box.x + 32, box.y + 40);
  await window.mouse.down();
  await window.mouse.move(box.x + Math.min(box.width - 16, 240), box.y + 40, { steps: 6 });
  await window.mouse.up();

  const stillMounted = await window.evaluate(() => window.__wmuxSelectionSmokeTerminal?.isConnected === true);
  if (!stillMounted) {
    throw new Error("Terminal remounted while clicking or dragging to select text");
  }
  log("ok terminal selection stability");
}

async function runRightClickClipboardSmoke(app, window) {
  log("right click clipboard");
  await window.locator('button.surfaceTab[aria-label="Codex Agent"]').click();
  await window.waitForSelector(".paneActive .surfaceBodyFrameActive .terminalHost .xterm textarea", {
    state: "attached",
    timeout: 15_000
  });
  await runTerminalCommand(window, "Write-Output WMUX_RIGHT_CLICK_COPY", "WMUX_RIGHT_CLICK_COPY");
  await waitForActiveTerminalRowText(window, "WMUX_RIGHT_CLICK_COPY");

  const markerBox = await window.evaluate(() => {
    const marker = "WMUX_RIGHT_CLICK_COPY";
    const host = document.querySelector(".paneActive .surfaceBodyFrameActive .terminalHost");
    const row = Array.from(host?.querySelectorAll(".xterm-rows > div") ?? []).find((element) =>
      element.textContent?.includes(marker)
    );
    if (!host || !row) {
      return null;
    }

    const rowRect = row.getBoundingClientRect();
    const hostRect = host.getBoundingClientRect();
    const markerStart = row.textContent?.indexOf(marker) ?? -1;
    const characterWidth = rowRect.width / Math.max(1, row.textContent?.length ?? marker.length);
    return {
      startX: rowRect.left + markerStart * characterWidth + 2,
      endX: rowRect.left + (markerStart + marker.length) * characterWidth - 2,
      y: rowRect.top + rowRect.height / 2,
      fallbackX: hostRect.left + 24
    };
  });
  if (!markerBox) {
    throw new Error("Terminal row for right-click copy smoke was not found");
  }

  await window.mouse.move(markerBox.startX, markerBox.y);
  await window.mouse.down();
  await window.mouse.move(markerBox.endX, markerBox.y, { steps: 8 });
  await window.mouse.up();
  await window.mouse.click(markerBox.fallbackX, markerBox.y, { button: "right" });
  await window.waitForFunction(() => window.wmux?.clipboard.readText().includes("WMUX_RIGHT_CLICK_COPY"), null, {
    timeout: 5_000
  });
  const copiedAfter = await app.evaluate(({ clipboard }) => clipboard.readText());
  if (!copiedAfter.includes("WMUX_RIGHT_CLICK_COPY")) {
    throw new Error(`Terminal right-click did not copy selection: ${JSON.stringify(copiedAfter)}`);
  }
  log("ok terminal right click copy");

  await app.evaluate(({ clipboard }) => clipboard.writeText("WMUX_RIGHT_CLICK_PASTE"));
  await window.locator(".titleBar").getByRole("button", { name: "Command", exact: true }).click();
  const commandSearch = window.getByLabel("Command search");
  await commandSearch.waitFor({ timeout: 15_000 });
  await commandSearch.fill("prefix ");
  await commandSearch.evaluate((input) => input.setSelectionRange(input.value.length, input.value.length));
  await commandSearch.click({ button: "right" });
  await window.waitForFunction(
    () => document.querySelector('input[aria-label="Command search"]')?.value === "prefix WMUX_RIGHT_CLICK_PASTE",
    null,
    { timeout: 5_000 }
  );
  await commandSearch.press("Escape");
  await window.getByLabel("Command palette").waitFor({ state: "detached", timeout: 15_000 });
  log("ok input right click paste");
}

async function navigateActiveBrowser(activePane, url) {
  const address = activePane.locator(".surfaceBodyFrameActive .browserSurface input[aria-label='Browser address']");
  await address.waitFor({ timeout: 15_000 });
  const webview = activePane.locator(".surfaceBodyFrameActive webview");
  const navigation = webview.evaluate(
    (webviewElement, targetUrl) =>
      new Promise((resolve, reject) => {
        const matchesTarget = () => {
          const currentUrl = webviewElement.getURL?.() ?? "";
          return currentUrl === targetUrl || decodeURIComponent(currentUrl) === targetUrl;
        };
        if (matchesTarget()) {
          resolve(webviewElement.getURL?.());
          return;
        }
        let attempts = 0;
        const poll = window.setInterval(() => {
          attempts += 1;
          if (matchesTarget()) {
            cleanup();
            resolve(webviewElement.getURL?.());
          }
          if (attempts > 150) {
            cleanup();
            reject(new Error(`browser did not navigate to ${targetUrl}`));
          }
        }, 100);
        const cleanup = () => {
          window.clearInterval(poll);
          webviewElement.removeEventListener("did-navigate", handleNavigate);
          webviewElement.removeEventListener("did-finish-load", handleNavigate);
        };
        const handleNavigate = () => {
          if (matchesTarget()) {
            cleanup();
            resolve(targetUrl);
          }
        };
        webviewElement.addEventListener("did-navigate", handleNavigate);
        webviewElement.addEventListener("did-finish-load", handleNavigate);
      }),
    url
  );
  await address.fill(url);
  await address.evaluate((input) => input.dispatchEvent(new Event("input", { bubbles: true })));
  await address.evaluate((input) => input.blur());
  await address.evaluate((input) => {
    input.form?.requestSubmit();
  });
  await navigation;
}

function activeBrowserUrlMatches(targetUrl) {
  const activeBrowser = document.querySelector(".surfaceBodyFrameActive .browserSurface input[aria-label='Browser address']");
  const currentUrl = activeBrowser?.closest(".surfaceBodyFrameActive")?.querySelector("webview")?.getURL?.();
  return typeof currentUrl === "string" && (currentUrl === targetUrl || decodeURIComponent(currentUrl) === targetUrl);
}

function activeBrowserPane(window) {
  return window
    .locator(".pane")
    .filter({
      has: window.locator(".surfaceBodyFrameActive .browserSurface input[aria-label='Browser address']")
    })
    .first();
}

function activeBrowserControl(window, label) {
  return activeBrowserPane(window).locator(".surfaceBodyFrameActive").getByLabel(label);
}

async function runEightTerminalSurfaceLatencySmoke(window) {
  log("eight terminal surface latency");
  await window.getByLabel("Open workspace API Server").click();
  await window.getByRole("heading", { name: "API Server" }).waitFor({ timeout: 15_000 });
  await window.locator('button.surfaceTab[aria-label="Codex Agent"]').click();
  await window.waitForSelector(".paneActive .surfaceBodyFrameActive .terminalHost .xterm textarea", {
    state: "attached",
    timeout: 15_000
  });

  const creationSamples = [];
  let tabCount = await window.locator(".paneActive button.surfaceTab").count();
  while (tabCount < 8) {
    const startedAt = Date.now();
    await window.locator(".paneActive .surfaceAdd").click();
    await window.waitForFunction((count) => document.querySelectorAll(".paneActive button.surfaceTab").length === count + 1, tabCount, {
      timeout: 15_000
    });
    await window.waitForSelector(".paneActive .surfaceBodyFrameActive .terminalHost .xterm textarea", {
      state: "attached",
      timeout: 15_000
    });
    creationSamples.push(Date.now() - startedAt);
    tabCount += 1;
  }

  const commandStartedAt = Date.now();
  await runTerminalCommand(window, "Write-Output WMUX_EIGHT_SURFACE_LATENCY", "WMUX_EIGHT_SURFACE_LATENCY");
  const commandMs = Date.now() - commandStartedAt;
  if (commandMs > 5_000) {
    throw new Error(`Eight terminal surface command latency exceeded threshold: ${JSON.stringify({ commandMs, creationSamples })}`);
  }

  log(`ok eight terminal surface latency ${JSON.stringify({ commandMs, creationSamples })}`);
}

async function runCliCommand(args) {
  const { stdout, stderr } = await execFileAsync(process.execPath, ["scripts/wmux-cli.mjs", ...args], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      WMUX_SOCKET_PATH: smokeSocketPath,
      WMUX_SOCKET_TOKEN: smokeSocketToken
    },
    timeout: 10_000
  });
  return `${stdout}${stderr}`.trim();
}

async function runCliCommandWithStatus(args) {
  try {
    const output = await runCliCommand(args);
    return { code: 0, output };
  } catch (error) {
    return {
      code: error.code,
      output: `${error.stdout ?? ""}${error.stderr ?? ""}`.trim()
    };
  }
}

async function runCliCommandFailure(args) {
  try {
    await runCliCommand(args);
  } catch (error) {
    return {
      code: error.code,
      output: `${error.stdout ?? ""}${error.stderr ?? ""}`.trim()
    };
  }

  throw new Error(`wmux command unexpectedly succeeded: ${args.join(" ")}`);
}

async function runCliSocketSmoke(window) {
  log("cli socket");

  const helpOutput = await runCliCommandWithStatus(["--help"]);
  const helpAliasOutput = await runCliCommandWithStatus(["help"]);
  if (helpOutput.code !== 0 || helpAliasOutput.code !== 0 || !helpOutput.output.includes("wmux current-workspace")) {
    throw new Error(`wmux help did not exit cleanly: ${JSON.stringify({ helpOutput, helpAliasOutput })}`);
  }
  log("ok wmux help");

  const pingOutput = await runCliCommand(["ping"]);
  if (!pingOutput.includes("pong")) {
    throw new Error(`wmux ping did not return pong: ${pingOutput}`);
  }
  log("ok wmux ping");

  const identifyOutput = await runCliCommand(["identify", "--json"]);
  const identify = JSON.parse(identifyOutput);
  if (identify.app !== "wmux" || !identify.workspaceId || !identify.paneId || !identify.surfaceId) {
    throw new Error(`wmux identify did not return active ids: ${identifyOutput}`);
  }
  log("ok wmux identify");

  const capabilitiesOutput = await runCliCommand(["capabilities", "--json"]);
  const capabilities = JSON.parse(capabilitiesOutput);
  for (const method of [
    "system.identify",
    "system.capabilities",
    "workspace.create",
    "workspace.select",
    "workspace.close",
    "workspace.rename",
    "surface.list",
    "surface.createTerminal",
    "surface.createBrowser",
    "surface.focus",
    "surface.sendKey",
    "status.clear",
    "status.list",
    "browser.list"
  ]) {
    if (!capabilities.methods?.includes(method)) {
      throw new Error(`wmux capabilities did not include ${method}: ${capabilitiesOutput}`);
    }
  }
  log("ok wmux capabilities");

  const workspaceOutput = await runCliCommand(["list-workspaces"]);
  if (!workspaceOutput.includes("API Server")) {
    throw new Error(`wmux list-workspaces did not include API Server: ${workspaceOutput}`);
  }
  log("ok wmux list-workspaces");

  const currentWorkspaceOutput = await runCliCommand(["current-workspace", "--json"]);
  const currentWorkspace = JSON.parse(currentWorkspaceOutput);
  if (currentWorkspace.id !== "workspace-api" || !currentWorkspace.active) {
    throw new Error(`wmux current-workspace did not return active API Server: ${currentWorkspaceOutput}`);
  }
  const currentWorkspaceText = await runCliCommand(["current-workspace"]);
  if (!currentWorkspaceText.includes("workspace-api") || !currentWorkspaceText.includes("API Server")) {
    throw new Error(`wmux current-workspace human output was incomplete: ${currentWorkspaceText}`);
  }
  log("ok wmux current-workspace");

  const createWorkspaceOutput = await runCliCommand(["new-workspace", "--name", "CLI Create Smoke", "--cwd", "."]);
  if (!createWorkspaceOutput.includes("created CLI Create Smoke")) {
    throw new Error(`wmux new-workspace did not report created CLI Create Smoke: ${createWorkspaceOutput}`);
  }
  const createdWorkspaceIdentifyOutput = await runCliCommand(["identify", "--json"]);
  const createdWorkspaceIdentify = JSON.parse(createdWorkspaceIdentifyOutput);
  if (createdWorkspaceIdentify.workspaceName !== "CLI Create Smoke" || createdWorkspaceIdentify.cwd !== "D:/IdeaProject/codex/wmux") {
    throw new Error(`wmux new-workspace did not activate expected workspace: ${createdWorkspaceIdentifyOutput}`);
  }
  await runCliCommand(["close-workspace", "--workspace", createdWorkspaceIdentify.workspaceId]);
  await runCliCommand(["select-workspace", "--workspace", "workspace-api"]);
  log("ok wmux new-workspace");

  const selectDocsOutput = await runCliCommand(["select-workspace", "--workspace", "workspace-docs"]);
  if (!selectDocsOutput.includes("selected Docs")) {
    throw new Error(`wmux select-workspace did not report selected Docs: ${selectDocsOutput}`);
  }
  const selectedDocsOutput = await runCliCommand(["identify", "--json"]);
  const selectedDocs = JSON.parse(selectedDocsOutput);
  if (selectedDocs.workspaceId !== "workspace-docs" || selectedDocs.workspaceName !== "Docs") {
    throw new Error(`wmux select-workspace did not activate Docs: ${selectedDocsOutput}`);
  }
  const selectApiOutput = await runCliCommand(["select-workspace", "--workspace", "workspace-api"]);
  if (!selectApiOutput.includes("selected API Server")) {
    throw new Error(`wmux select-workspace did not report selected API Server: ${selectApiOutput}`);
  }
  const selectedApiOutput = await runCliCommand(["identify", "--json"]);
  const selectedApi = JSON.parse(selectedApiOutput);
  if (selectedApi.workspaceId !== "workspace-api" || selectedApi.workspaceName !== "API Server") {
    throw new Error(`wmux select-workspace did not restore API Server: ${selectedApiOutput}`);
  }
  log("ok wmux select-workspace");

  await window.getByLabel("New workspace").click();
  await renameWorkspace(window, await getActiveWorkspaceName(window), "CLI Close Smoke");
  const cliCloseWorkspaceOutput = await runCliCommand(["list-workspaces", "--json"]);
  const cliCloseWorkspaceList = JSON.parse(cliCloseWorkspaceOutput);
  const cliCloseWorkspace = cliCloseWorkspaceList.workspaces?.find((workspace) => workspace.name === "CLI Close Smoke");
  if (!cliCloseWorkspace?.id) {
    throw new Error(`wmux list-workspaces did not include CLI Close Smoke: ${cliCloseWorkspaceOutput}`);
  }
  const closeWorkspaceOutput = await runCliCommand(["close-workspace", "--workspace", cliCloseWorkspace.id]);
  if (!closeWorkspaceOutput.includes("closed CLI Close Smoke")) {
    throw new Error(`wmux close-workspace did not report closed CLI Close Smoke: ${closeWorkspaceOutput}`);
  }
  const afterCloseWorkspaceOutput = await runCliCommand(["list-workspaces", "--json"]);
  const afterCloseWorkspaceList = JSON.parse(afterCloseWorkspaceOutput);
  if (afterCloseWorkspaceList.workspaces?.some((workspace) => workspace.id === cliCloseWorkspace.id)) {
    throw new Error(`wmux close-workspace did not remove workspace: ${afterCloseWorkspaceOutput}`);
  }
  await runCliCommand(["select-workspace", "--workspace", "workspace-api"]);
  log("ok wmux close-workspace");

  await window.getByLabel("New workspace").click();
  await renameWorkspace(window, await getActiveWorkspaceName(window), "CLI Rename Smoke");
  const cliRenameWorkspaceOutput = await runCliCommand(["list-workspaces", "--json"]);
  const cliRenameWorkspaceList = JSON.parse(cliRenameWorkspaceOutput);
  const cliRenameWorkspace = cliRenameWorkspaceList.workspaces?.find((workspace) => workspace.name === "CLI Rename Smoke");
  if (!cliRenameWorkspace?.id) {
    throw new Error(`wmux list-workspaces did not include CLI Rename Smoke: ${cliRenameWorkspaceOutput}`);
  }
  const renameWorkspaceOutput = await runCliCommand([
    "rename-workspace",
    "--workspace",
    cliRenameWorkspace.id,
    "--name",
    "CLI Renamed Smoke"
  ]);
  if (!renameWorkspaceOutput.includes("renamed CLI Renamed Smoke")) {
    throw new Error(`wmux rename-workspace did not report renamed CLI Renamed Smoke: ${renameWorkspaceOutput}`);
  }
  const afterRenameWorkspaceOutput = await runCliCommand(["list-workspaces", "--json"]);
  const afterRenameWorkspaceList = JSON.parse(afterRenameWorkspaceOutput);
  if (!afterRenameWorkspaceList.workspaces?.some((workspace) => workspace.id === cliRenameWorkspace.id && workspace.name === "CLI Renamed Smoke")) {
    throw new Error(`wmux rename-workspace did not update workspace name: ${afterRenameWorkspaceOutput}`);
  }
  await runCliCommand(["close-workspace", "--workspace", cliRenameWorkspace.id]);
  await runCliCommand(["select-workspace", "--workspace", "workspace-api"]);
  log("ok wmux rename-workspace");

  const surfaceOutput = await runCliCommand(["surface", "list"]);
  if (!surfaceOutput.includes("surface-agent") || !surfaceOutput.includes("terminal") || !surfaceOutput.includes("API Server")) {
    throw new Error(`wmux surface list did not include API Server terminal surfaces: ${surfaceOutput}`);
  }
  const surfaceJsonOutput = await runCliCommand(["surface", "list", "--json"]);
  const surfaceList = JSON.parse(surfaceJsonOutput);
  if (!surfaceList.surfaces?.some((surface) => surface.surfaceId === "surface-agent" && surface.active)) {
    throw new Error(`wmux surface list --json did not include active surface-agent: ${surfaceJsonOutput}`);
  }
  const listSurfacesOutput = await runCliCommand(["list-surfaces", "--json"]);
  const listSurfaces = JSON.parse(listSurfacesOutput);
  if (!listSurfaces.surfaces?.some((surface) => surface.surfaceId === "surface-agent" && surface.active)) {
    throw new Error(`wmux list-surfaces alias did not include active surface-agent: ${listSurfacesOutput}`);
  }
  log("ok wmux surface list");

  const focusShellOutput = await runCliCommand(["surface", "focus", "--surface", "surface-shell"]);
  if (!focusShellOutput.includes("focused surface-shell")) {
    throw new Error(`wmux surface focus did not report focused surface-shell: ${focusShellOutput}`);
  }
  const focusedShellOutput = await runCliCommand(["identify", "--json"]);
  const focusedShell = JSON.parse(focusedShellOutput);
  if (focusedShell.surfaceId !== "surface-shell" || focusedShell.paneId !== "pane-terminal") {
    throw new Error(`wmux surface focus did not activate surface-shell: ${focusedShellOutput}`);
  }
  const focusAgentOutput = await runCliCommand(["surface", "focus", "--surface", "surface-agent"]);
  if (!focusAgentOutput.includes("focused surface-agent")) {
    throw new Error(`wmux surface focus did not report focused surface-agent: ${focusAgentOutput}`);
  }
  const focusedAgentOutput = await runCliCommand(["identify", "--json"]);
  const focusedAgent = JSON.parse(focusedAgentOutput);
  if (focusedAgent.surfaceId !== "surface-agent" || focusedAgent.paneId !== "pane-terminal") {
    throw new Error(`wmux surface focus did not restore surface-agent: ${focusedAgentOutput}`);
  }
  const focusSurfaceAliasOutput = await runCliCommand(["focus-surface", "--surface", "surface-shell"]);
  if (!focusSurfaceAliasOutput.includes("focused surface-shell")) {
    throw new Error(`wmux focus-surface alias did not report focused surface-shell: ${focusSurfaceAliasOutput}`);
  }
  await runCliCommand(["focus-surface", "--surface", "surface-agent"]);
  log("ok wmux surface focus");

  const createTerminalOutput = await runCliCommand(["new-terminal", "--name", "CLI Terminal Smoke", "--cwd", "."]);
  if (!createTerminalOutput.includes("created CLI Terminal Smoke")) {
    throw new Error(`wmux new-terminal did not report created CLI Terminal Smoke: ${createTerminalOutput}`);
  }
  const createdTerminalOutput = await runCliCommand(["identify", "--json"]);
  const createdTerminal = JSON.parse(createdTerminalOutput);
  if (createdTerminal.surfaceType !== "terminal") {
    throw new Error(`wmux new-terminal did not activate a terminal surface: ${createdTerminalOutput}`);
  }
  const surfaceAfterCreateOutput = await runCliCommand(["surface", "list", "--json"]);
  const surfacesAfterCreate = JSON.parse(surfaceAfterCreateOutput);
  if (
    !surfacesAfterCreate.surfaces?.some(
      (surface) => surface.surfaceId === createdTerminal.surfaceId && surface.name === "CLI Terminal Smoke" && surface.active
    )
  ) {
    throw new Error(`wmux surface list did not include active CLI Terminal Smoke: ${surfaceAfterCreateOutput}`);
  }
  await runCliCommand(["send", "Write-Output WMUX_CLI_NEW_TERMINAL\n"]);
  await window.waitForFunction(() => document.body.textContent?.includes("WMUX_CLI_NEW_TERMINAL"), null, {
    timeout: 15_000
  });
  await runCliCommand(["surface", "focus", "--surface", "surface-agent"]);
  log("ok wmux new-terminal");

  const createBrowserOutput = await runCliCommand([
    "new-browser",
    "--name",
    "CLI Browser Smoke",
    "--url",
    "data:text/html,<title>CLI Browser Smoke</title><h1>WMUX_CLI_BROWSER</h1>"
  ]);
  if (!createBrowserOutput.includes("created CLI Browser Smoke")) {
    throw new Error(`wmux new-browser did not report created CLI Browser Smoke: ${createBrowserOutput}`);
  }
  const createdBrowserOutput = await runCliCommand(["identify", "--json"]);
  const createdBrowser = JSON.parse(createdBrowserOutput);
  if (createdBrowser.surfaceType !== "browser") {
    throw new Error(`wmux new-browser did not activate a browser surface: ${createdBrowserOutput}`);
  }
  const browserAfterCreateOutput = await runCliCommand(["browser", "list", "--json"]);
  const browsersAfterCreate = JSON.parse(browserAfterCreateOutput);
  if (
    !browsersAfterCreate.browsers?.some(
      (browser) =>
        browser.surfaceId === createdBrowser.surfaceId &&
        browser.title === "CLI Browser Smoke" &&
        browser.url.includes("WMUX_CLI_BROWSER")
    )
  ) {
    throw new Error(`wmux browser list did not include CLI Browser Smoke: ${browserAfterCreateOutput}`);
  }
  await runCliCommand(["surface", "focus", "--surface", "surface-agent"]);
  log("ok wmux new-browser");

  const directedBrowserSendFailure = await runCliCommandFailure([
    "send-surface",
    "--surface",
    createdBrowser.surfaceId,
    "Write-Output WMUX_SHOULD_NOT_SEND\n"
  ]);
  if (directedBrowserSendFailure.code !== 1 || !directedBrowserSendFailure.output.includes("SURFACE_TYPE_MISMATCH")) {
    throw new Error(`wmux send-surface to browser did not fail clearly: ${JSON.stringify(directedBrowserSendFailure)}`);
  }
  const directedMissingSendFailure = await runCliCommandFailure(["send-surface", "--surface", "surface-missing", "hello"]);
  if (directedMissingSendFailure.code !== 1 || !directedMissingSendFailure.output.includes("NOT_FOUND")) {
    throw new Error(`wmux send-surface missing surface did not fail clearly: ${JSON.stringify(directedMissingSendFailure)}`);
  }
  log("ok wmux send-surface errors");

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

  const sendSurfaceOutput = await runCliCommand(["send-surface", "--surface", "surface-agent", "Write-Output WMUX_CLI_SEND_SURFACE\n"]);
  if (!sendSurfaceOutput.includes("sent")) {
    throw new Error(`wmux send-surface did not report sent bytes: ${sendSurfaceOutput}`);
  }
  await window.waitForFunction(() => document.body.textContent?.includes("WMUX_CLI_SEND_SURFACE"), null, {
    timeout: 15_000
  });
  log("ok wmux send-surface");

  const sendKeyText = "Write-Output WMUX_CLI_SEND_KEY";
  const sendKeyTextOutput = await runCliCommand(["send", sendKeyText]);
  if (!sendKeyTextOutput.includes("sent")) {
    throw new Error(`wmux send did not report sent bytes for send-key smoke: ${sendKeyTextOutput}`);
  }
  const sendKeyOutput = await runCliCommand(["send-key", "enter"]);
  if (!sendKeyOutput.includes("sent key enter")) {
    throw new Error(`wmux send-key did not report sent key: ${sendKeyOutput}`);
  }
  await window.waitForFunction(() => document.body.textContent?.includes("WMUX_CLI_SEND_KEY"), null, {
    timeout: 15_000
  });
  log("ok wmux send-key");

  const sendKeySurfaceText = "Write-Output WMUX_CLI_SEND_KEY_SURFACE";
  await runCliCommand(["send-surface", "--surface", "surface-agent", sendKeySurfaceText]);
  const sendKeySurfaceOutput = await runCliCommand(["send-key-surface", "--surface", "surface-agent", "enter"]);
  if (!sendKeySurfaceOutput.includes("sent key enter")) {
    throw new Error(`wmux send-key-surface did not report sent key: ${sendKeySurfaceOutput}`);
  }
  await window.waitForFunction(() => document.body.textContent?.includes("WMUX_CLI_SEND_KEY_SURFACE"), null, {
    timeout: 15_000
  });
  log("ok wmux send-key-surface");

  const invalidSplitOutput = await runCliCommandFailure(["new-split", "--direction", "diagonal"]);
  if (invalidSplitOutput.code !== 2 || !invalidSplitOutput.output.includes("new-split 需要 --direction")) {
    throw new Error(`wmux new-split invalid direction was not a CLI usage error: ${JSON.stringify(invalidSplitOutput)}`);
  }
  const paneCountBeforeCliSplit = await window.locator(".pane").count();
  const splitOutput = await runCliCommand(["new-split", "--direction", "vertical", "--json"]);
  const splitResult = JSON.parse(splitOutput);
  if (splitResult.workspaceId !== "workspace-api" || !splitResult.paneId || !splitResult.surfaceId) {
    throw new Error(`wmux new-split did not report split: ${splitOutput}`);
  }
  await window.waitForFunction((count) => document.querySelectorAll(".pane").length === count + 1, paneCountBeforeCliSplit, {
    timeout: 15_000
  });
  const splitIdentifyOutput = await runCliCommand(["identify", "--json"]);
  const splitIdentify = JSON.parse(splitIdentifyOutput);
  if (splitIdentify.surfaceType !== "terminal" || splitIdentify.workspaceId !== "workspace-api") {
    throw new Error(`wmux new-split did not activate a terminal surface: ${splitIdentifyOutput}`);
  }
  await window.locator(".paneActive").getByLabel("Close pane").click();
  await window.waitForFunction((count) => document.querySelectorAll(".pane").length === count, paneCountBeforeCliSplit, {
    timeout: 15_000
  });
  await runCliCommand(["focus-surface", "--surface", "surface-agent"]);
  log("ok wmux new-split");

  await window.getByRole("button", { name: /Notifications/ }).click();
  await window.getByLabel("Notifications panel").waitFor({ timeout: 15_000 });
  await window.getByLabel("Notifications panel").getByText("API Server").waitFor({ timeout: 15_000 });
  await window.getByLabel("Notifications panel").getByText("uvicorn ready on 8787").waitFor({ timeout: 15_000 });
  log("ok notifications panel initial state");

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
  const apiWorkspaceItem = window.locator(".workspaceItem").filter({ hasText: "API Server" }).first();
  await apiWorkspaceItem.getByText("Needs input").waitFor({ timeout: 15_000 });
  await apiWorkspaceItem.getByText("WMUX_CLI_NOTIFY: socket smoke").waitFor({ timeout: 15_000 });
  await window.getByLabel("Notifications panel").getByText("WMUX_CLI_NOTIFY: socket smoke").waitFor({ timeout: 15_000 });

  const statusListOutput = await runCliCommand(["status", "list"]);
  if (!statusListOutput.includes("API Server") || !statusListOutput.includes("WMUX_CLI_NOTIFY: socket smoke")) {
    throw new Error(`wmux status list did not include the active notice: ${statusListOutput}`);
  }
  const statusListJsonOutput = await runCliCommand(["status", "list", "--json"]);
  const statusList = JSON.parse(statusListJsonOutput);
  if (!statusList.statuses?.some((item) => item.name === "API Server" && item.notice === "WMUX_CLI_NOTIFY: socket smoke")) {
    throw new Error(`wmux status list --json did not include the active notice: ${statusListJsonOutput}`);
  }
  log("ok wmux status list");

  const missingWorkspace = await runCliCommandFailure(["status", "list", "--workspace", "workspace:missing"]);
  if (
    missingWorkspace.code !== 1 ||
    !missingWorkspace.output.includes("NOT_FOUND") ||
    !missingWorkspace.output.includes("wmux list-workspaces")
  ) {
    throw new Error(`wmux NOT_FOUND hint was not clear: ${JSON.stringify(missingWorkspace)}`);
  }
  log("ok wmux not-found hint");

  const clearOutput = await runCliCommand(["clear-status"]);
  if (!clearOutput.includes("cleared")) {
    throw new Error(`wmux clear-status did not report success: ${clearOutput}`);
  }
  await window.waitForFunction(() => !document.body.textContent?.includes("WMUX_CLI_NOTIFY: socket smoke"), null, {
    timeout: 15_000
  });
  await apiWorkspaceItem.getByText("Idle").waitFor({ timeout: 15_000 });
  log("ok wmux clear-status");

  const uiNotifyOutput = await runCliCommand([
    "notify",
    "--title",
    "WMUX_UI_CLEAR",
    "--body",
    "socket smoke"
  ]);
  if (!uiNotifyOutput.includes("notified")) {
    throw new Error(`wmux notify did not report success for UI clear smoke: ${uiNotifyOutput}`);
  }
  await window.getByLabel("Notifications panel").getByText("WMUX_UI_CLEAR: socket smoke").waitFor({ timeout: 15_000 });
  await window.getByLabel("Clear notification API Server").click();
  await window.waitForFunction(() => !document.body.textContent?.includes("WMUX_UI_CLEAR: socket smoke"), null, {
    timeout: 15_000
  });
  await apiWorkspaceItem.getByText("Idle").waitFor({ timeout: 15_000 });
  log("ok notification clear button");

  await window.getByRole("button", { name: /Notifications/ }).click();
  await window.getByLabel("Notifications panel").waitFor({ state: "detached", timeout: 15_000 });
  log("ok wmux notify");
}

async function renameWorkspace(window, currentName, nextName) {
  await window.getByRole("heading", { name: currentName }).waitFor({ timeout: 15_000 });
  await window.getByLabel(`Open workspace ${currentName}`).focus();
  await window.keyboard.press("F2");
  const nameInput = window.getByLabel("Workspace name");
  await nameInput.fill(nextName);
  await nameInput.press("Enter");
  await window.getByRole("heading", { name: nextName }).waitFor({ timeout: 15_000 });
}

async function getActiveWorkspaceName(window) {
  return window.locator(".titleIdentity h1").textContent();
}

async function runWorkspaceCrud(window) {
  log("workspace crud");
  await window.getByLabel("New workspace").click();
  await renameWorkspace(window, await getActiveWorkspaceName(window), "Smoke Workspace");
  await runTerminalCommand(window, "Write-Output WMUX_WORKSPACE_SMOKE", "WMUX_WORKSPACE_SMOKE");

  await window.getByLabel("Open workspace API Server").click();
  await window.getByRole("heading", { name: "API Server" }).waitFor({ timeout: 15_000 });

  await window.getByLabel("Open workspace Smoke Workspace").click();
  await window.getByRole("heading", { name: "Smoke Workspace" }).waitFor({ timeout: 15_000 });

  await renameWorkspace(window, "Smoke Workspace", "Smoke Renamed");

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
  await renameWorkspace(window, await getActiveWorkspaceName(window), "Split Smoke");

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
  const titleBar = window.locator(".titleBar");
  await titleBar.getByRole("button", { name: "Browser", exact: true }).click();
  const browserTab = window.locator(".pane button.surfaceTab").filter({ hasText: /Browser/ }).first();
  await browserTab.waitFor({ timeout: 15_000 });
  await browserTab.click();
  const activePane = activeBrowserPane(window);
  await activePane.waitFor({ timeout: 15_000 });
  await activePane.locator(".surfaceBodyFrameActive webview").waitFor({ timeout: 15_000 });

  const firstUrl = "data:text/html,<title>WMUX Browser One</title><h1>WMUX_BROWSER_ONE</h1>";
  const secondUrl = "data:text/html,<title>WMUX Browser Two</title><h1>WMUX_BROWSER_TWO</h1>";

  await navigateActiveBrowser(activePane, firstUrl);
  await window.waitForFunction(activeBrowserUrlMatches, firstUrl, { timeout: 15_000 });
  log("ok browser first url");
  const browserMetrics = await activePane.locator(".surfaceBodyFrameActive webview").evaluate((webview) => {
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
  await activePane.locator(".surfaceBodyFrameActive webview").waitFor({ timeout: 15_000 });
  log("ok browser resize adaptive");
  const resizedBrowserWidth = await activePane
    .locator(".surfaceBodyFrameActive webview")
    .evaluate((webview) => webview.getBoundingClientRect().width);
  await window.waitForFunction(
    async ({ shouldZoom }) => {
      const activeBrowser = document.querySelector(
        ".surfaceBodyFrameActive .browserSurface input[aria-label='Browser address']"
      );
      const zoomFactor = await activeBrowser?.closest(".surfaceBodyFrameActive")?.querySelector("webview")?.getZoomFactor?.();
      return typeof zoomFactor === "number" && (!shouldZoom || zoomFactor < 0.98);
    },
    { shouldZoom: resizedBrowserWidth < 960 },
    { timeout: 15_000 }
  );
  log("ok browser auto zoom fit");

  await navigateActiveBrowser(activePane, secondUrl);
  await window.waitForFunction(activeBrowserUrlMatches, secondUrl, { timeout: 15_000 });
  log("ok browser second url");

  await expectEnabled(activeBrowserControl(window, "Back"));
  await activeBrowserControl(window, "Back").click();
  await window.waitForFunction(activeBrowserUrlMatches, firstUrl, { timeout: 15_000 });
  log("ok browser back");

  await expectEnabled(activeBrowserControl(window, "Forward"));
  await activeBrowserControl(window, "Forward").click();
  await window.waitForFunction(activeBrowserUrlMatches, secondUrl, { timeout: 15_000 });
  log("ok browser forward");

  await activeBrowserControl(window, "Reload").click();
  await window.waitForFunction(activeBrowserUrlMatches, secondUrl, { timeout: 15_000 });
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

async function runCommandPaletteSmoke(window) {
  log("command palette");

  await window.getByRole("button", { name: "Command" }).click();
  await window.getByLabel("Command palette").waitFor({ timeout: 15_000 });
  await window.getByText("5 个命令（全局 2 / 项目 4）").waitFor({ timeout: 15_000 });
  log("ok project wmux config");

  const commandSearch = window.getByLabel("Command search");
  await commandSearch.fill("layout");
  await commandSearch.press("Escape");
  await window.getByLabel("Command palette").waitFor({ state: "detached", timeout: 15_000 });

  await window.getByRole("button", { name: "Command" }).click();
  await commandSearch.fill("global marker");
  await commandSearch.press("Enter");
  await window.getByLabel("Confirm project command").waitFor({ timeout: 15_000 });
  await window.getByRole("button", { name: "Run project command" }).click();
  await window.getByLabel("Command palette").waitFor({ state: "detached", timeout: 15_000 });
  await window.waitForFunction(() => document.body.textContent?.includes("WMUX_GLOBAL_COMMAND"), null, {
    timeout: 15_000
  });
  log("ok global command");

  await window.getByRole("button", { name: "Command" }).click();
  await commandSearch.fill("run smoke");
  await commandSearch.press("ArrowDown");
  await commandSearch.press("ArrowUp");
  await commandSearch.press("Enter");
  await window.getByLabel("Confirm project command").waitFor({ timeout: 15_000 });
  await window.getByRole("button", { name: "Cancel" }).click();
  await window.getByLabel("Confirm project command").waitFor({ state: "detached", timeout: 15_000 });
  const commandRanBeforeConfirm = await window.evaluate(() => document.body.textContent?.includes("WMUX_COMMAND_SMOKE"));
  if (commandRanBeforeConfirm) {
    throw new Error("Project command ran before confirmation");
  }
  await commandSearch.focus();
  await commandSearch.press("Enter");
  await window.getByLabel("Confirm project command").waitFor({ timeout: 15_000 });
  await window.getByRole("button", { name: "Run project command" }).click();
  await window.getByLabel("Command palette").waitFor({ state: "detached", timeout: 15_000 });
  log("ok command palette keyboard");
  await window.waitForFunction(() => document.body.textContent?.includes("WMUX_COMMAND_SMOKE"), null, {
    timeout: 15_000
  });
  log("ok simple command");

  await window.getByRole("button", { name: "Command" }).click();
  await commandSearch.fill("dev layout");
  await commandSearch.press("Enter");
  await window.getByLabel("Confirm project command").waitFor({ state: "detached", timeout: 15_000 });
  await window.getByRole("heading", { name: "Command Layout Smoke" }).waitFor({ timeout: 15_000 });
  await window.waitForFunction(() => document.querySelectorAll(".pane").length >= 2, null, { timeout: 15_000 });
  await window.waitForFunction(
    () => Array.from(document.querySelectorAll("webview")).some((webview) => webview.getURL?.().includes("WMUX_LAYOUT_BROWSER")),
    null,
    { timeout: 15_000 }
  );
  await window.waitForFunction(() => document.body.textContent?.includes("WMUX_LAYOUT_TERMINAL"), null, {
    timeout: 15_000
  });
  log("ok workspace command layout");

  const workspaceCountBeforeRestartIgnore = await window.locator(".workspaceItem").count();
  await window.locator(".titleBar").getByRole("button", { name: "Command", exact: true }).click();
  await commandSearch.fill("dev layout");
  await commandSearch.press("Enter");
  await window.getByLabel("Command palette").waitFor({ state: "detached", timeout: 15_000 });
  await window.getByRole("heading", { name: "Command Layout Smoke" }).waitFor({ timeout: 15_000 });
  await window.waitForFunction(
    (count) => document.querySelectorAll(".workspaceItem").length === count,
    workspaceCountBeforeRestartIgnore,
    { timeout: 15_000 }
  );
  await window.waitForFunction(() => document.body.textContent?.includes("已存在，跳过重复运行：Open Dev Layout"), null, {
    timeout: 15_000
  });
  log("ok workspace command restart ignore");

  await window.locator(".titleBar").getByRole("button", { name: "Command", exact: true }).click();
  await commandSearch.fill("confirm layout");
  await commandSearch.press("Enter");
  await window.getByRole("heading", { name: "Command Confirm Smoke" }).waitFor({ timeout: 15_000 });
  await window.waitForFunction(() => document.body.textContent?.includes("WMUX_CONFIRM_LAYOUT"), null, {
    timeout: 15_000
  });
  const firstConfirmWorkspaceList = JSON.parse(await runCliCommand(["list-workspaces", "--json"]));
  const firstConfirmWorkspace = firstConfirmWorkspaceList.workspaces?.find(
    (workspace) => workspace.name === "Command Confirm Smoke"
  );
  if (!firstConfirmWorkspace?.id) {
    throw new Error("Workspace command restart confirm did not create the initial workspace");
  }
  const workspaceCountBeforeRestartConfirm = await window.locator(".workspaceItem").count();
  await window.locator(".titleBar").getByRole("button", { name: "Command", exact: true }).click();
  await commandSearch.fill("confirm layout");
  await commandSearch.press("Enter");
  await window.getByLabel("Confirm project command").waitFor({ timeout: 15_000 });
  await window.getByRole("button", { name: "Cancel" }).click();
  await window.getByLabel("Confirm project command").waitFor({ state: "detached", timeout: 15_000 });
  await window.waitForFunction(
    (count) => document.querySelectorAll(".workspaceItem").length === count,
    workspaceCountBeforeRestartConfirm,
    { timeout: 15_000 }
  );
  const canceledConfirmWorkspaceList = JSON.parse(await runCliCommand(["list-workspaces", "--json"]));
  const canceledConfirmWorkspace = canceledConfirmWorkspaceList.workspaces?.find(
    (workspace) => workspace.name === "Command Confirm Smoke"
  );
  if (canceledConfirmWorkspace?.id !== firstConfirmWorkspace.id) {
    throw new Error("Workspace command restart confirm recreated after cancel");
  }
  await window.locator(".titleBar").getByRole("button", { name: "Command", exact: true }).click();
  await commandSearch.fill("confirm layout");
  await commandSearch.press("Enter");
  await window.getByLabel("Confirm project command").waitFor({ timeout: 15_000 });
  await window.getByRole("button", { name: "Recreate workspace" }).click();
  await window.getByLabel("Command palette").waitFor({ state: "detached", timeout: 15_000 });
  await window.waitForFunction(
    (count) => document.querySelectorAll(".workspaceItem").length === count,
    workspaceCountBeforeRestartConfirm,
    { timeout: 15_000 }
  );
  const recreatedConfirmWorkspaceList = JSON.parse(await runCliCommand(["list-workspaces", "--json"]));
  const recreatedConfirmWorkspace = recreatedConfirmWorkspaceList.workspaces?.find(
    (workspace) => workspace.name === "Command Confirm Smoke"
  );
  if (!recreatedConfirmWorkspace?.id || recreatedConfirmWorkspace.id === firstConfirmWorkspace.id) {
    throw new Error("Workspace command restart confirm did not recreate after confirmation");
  }
  log("ok workspace command restart confirm");

  await window.locator(".titleBar").getByRole("button", { name: "Command", exact: true }).click();
  await commandSearch.fill("recreate layout");
  await commandSearch.press("Enter");
  await window.getByRole("heading", { name: "Command Recreate Smoke" }).waitFor({ timeout: 15_000 });
  await window.waitForFunction(() => document.body.textContent?.includes("WMUX_RECREATE_LAYOUT"), null, {
    timeout: 15_000
  });
  const firstRecreateWorkspaceList = JSON.parse(await runCliCommand(["list-workspaces", "--json"]));
  const firstRecreateWorkspace = firstRecreateWorkspaceList.workspaces?.find(
    (workspace) => workspace.name === "Command Recreate Smoke"
  );
  if (!firstRecreateWorkspace?.id) {
    throw new Error("Workspace command restart recreate did not create the initial workspace");
  }
  const workspaceCountBeforeRestartRecreate = await window.locator(".workspaceItem").count();
  await window.locator(".titleBar").getByRole("button", { name: "Command", exact: true }).click();
  await commandSearch.fill("recreate layout");
  await commandSearch.press("Enter");
  await window.getByLabel("Command palette").waitFor({ state: "detached", timeout: 15_000 });
  await window.waitForFunction(
    (count) => document.querySelectorAll(".workspaceItem").length === count,
    workspaceCountBeforeRestartRecreate,
    { timeout: 15_000 }
  );
  const secondRecreateWorkspaceList = JSON.parse(await runCliCommand(["list-workspaces", "--json"]));
  const secondRecreateWorkspace = secondRecreateWorkspaceList.workspaces?.find(
    (workspace) => workspace.name === "Command Recreate Smoke"
  );
  if (!secondRecreateWorkspace?.id || secondRecreateWorkspace.id === firstRecreateWorkspace.id) {
    throw new Error("Workspace command restart recreate did not replace the existing workspace");
  }
  log("ok workspace command restart recreate");

  await window.getByLabel("Open workspace API Server").click();
  await window.getByRole("heading", { name: "API Server" }).waitFor({ timeout: 15_000 });
}

async function expectEnabled(locator) {
  await locator.waitFor({ timeout: 15_000 });
  await locator.page().waitForFunction((element) => !element.disabled, await locator.elementHandle(), {
    timeout: 15_000
  });
}

async function dragSurfaceToPaneEdge(source, target, edge, expectedPaneCount) {
  const targetBox = await target.boundingBox();
  if (!targetBox) {
    throw new Error("Target pane did not expose a bounding box for surface drag");
  }
  const targetPosition =
    edge === "right"
      ? { x: targetBox.width - 12, y: targetBox.height / 2 }
      : edge === "left"
        ? { x: 12, y: targetBox.height / 2 }
        : edge === "bottom"
          ? { x: targetBox.width / 2, y: targetBox.height - 12 }
          : { x: targetBox.width / 2, y: 12 };

  for (let attempt = 0; attempt < 3; attempt += 1) {
    await source.dragTo(target, { targetPosition });
    try {
      await target.page().waitForFunction((count) => document.querySelectorAll(".pane").length === count, expectedPaneCount, {
        timeout: 5_000
      });
      return;
    } catch (error) {
      if (attempt === 2) {
        throw error;
      }
    }
  }
}

async function waitForWorkspaceStateText(text) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 15_000) {
    if (existsSync(smokeWorkspaceStatePath) && readFileSync(smokeWorkspaceStatePath, "utf8").includes(text)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`workspace state did not include ${text}`);
}

async function waitForWorkspaceState(workspaceName, predicate, description) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 15_000) {
    if (existsSync(smokeWorkspaceStatePath)) {
      const state = JSON.parse(readFileSync(smokeWorkspaceStatePath, "utf8"));
      const workspace = state.workspaces?.find((item) => item.name === workspaceName);
      if (workspace && predicate(workspace, state)) {
        return;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`workspace state did not satisfy ${description}`);
}

async function runSessionRestoreSmoke(currentApp, window) {
  log("session restore");
  await window.getByLabel("New workspace").click();
  await window.getByRole("heading", { name: /Workspace/ }).waitFor({ timeout: 15_000 });
  const workspaceHeading = await window.locator(".titleIdentity h1").textContent();
  if (!workspaceHeading) {
    throw new Error("New workspace heading was empty before restore smoke");
  }

  await renameWorkspace(window, workspaceHeading, "Restore Smoke");
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
  await window.waitForFunction(() => document.querySelector(".surfaceStage > .split") !== null, null, { timeout: 15_000 });
  await waitForWorkspaceState(
    "Restore Smoke",
    (workspace) => workspace.layout?.type === "split" && Object.keys(workspace.panes ?? {}).length >= 2,
    "Restore Smoke split layout"
  );
  await waitForWorkspaceState(
    "Restore Smoke",
    (_workspace, state) => JSON.stringify(state.browserSessions ?? {}).includes(restoreUrl),
    "Restore Smoke browser session URL"
  );

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
  await restoredWindow.locator("button.surfaceTab").filter({ hasText: /^Terminal$/ }).first().click();
  await restoredWindow.waitForSelector(".paneActive .surfaceBodyFrameActive .terminalHost .xterm textarea", {
    state: "attached",
    timeout: 15_000
  });
  log("ok session restore");

  return { app: restoredApp, window: restoredWindow };
}

let app;
let smokePortServer;

try {
  smokePortServer = await startSmokePortServer();
  app = await launchApp();
  let window = await getReadyWindow(app);
  const loadedConfig = await window.evaluate(() => window.wmux?.config.loadProjectConfig());
  const loadedCommands = loadedConfig?.config?.commands ?? [];
  if (!loadedCommands.some((command) => command.name === "Run Global Marker" && command.source === "global")) {
    throw new Error(`Global wmux config command was not loaded: ${JSON.stringify(loadedConfig)}`);
  }
  const smokeMarkerCommands = loadedCommands.filter((command) => command.name === "Run Smoke Marker");
  if (smokeMarkerCommands.length !== 1 || smokeMarkerCommands[0]?.source !== "project") {
    throw new Error(`Project wmux config did not override global command: ${JSON.stringify(loadedConfig)}`);
  }
  log("ok global/project wmux config merge");
  const shellOptions = await window
    .locator('select[aria-label="Terminal shell"] option')
    .evaluateAll((options) => options.map((option) => ({ value: option.value, label: option.textContent })));
  log(`shell options ${JSON.stringify(shellOptions)}`);

  await runWorkspaceInspectionSmoke(window, smokePortServer.port);
  await runSettingsSmoke(window);
  await runKeyboardShortcutSmoke(window);
  await runCompactLayoutSmoke(window);
  await runWorkspaceSwitchLatencySmoke(window);
  await runCliSocketSmoke(window);
  await runWorkspaceCrud(window);
  await runSplitCrud(window);
  await runBrowserCrud(window);
  await runCommandPaletteSmoke(window);

  await runTerminalCommand(window, "pwd", "D:\\IdeaProject\\codex\\wmux");
  await runTerminalCommand(window, "ls package.json", "package.json");
  await runTerminalCommand(window, "clear", "Codex Agent");
  await runTerminalCommand(window, "Write-Output WMUX_TERMINAL_SMOKE", "WMUX_TERMINAL_SMOKE");
  await runTerminalSelectionStabilitySmoke(window);
  await runRightClickClipboardSmoke(app, window);
  await runEightTerminalSurfaceLatencySmoke(window);
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
  await dragSurfaceToPaneEdge(newTerminalTab, tabDragTargetPane, "right", paneCountBeforeTabDrag + 1);
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
  await dragSurfaceToPaneEdge(singleSurfaceTab, targetPane, "left", paneCountBeforeSinglePaneDrag);
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
  await stopSmokePortServer(smokePortServer);
  if (hadProjectConfig) {
    writeFileSync(projectConfigPath, originalProjectConfig, "utf8");
  } else {
    rmSync(projectConfigPath, { force: true });
  }
  rmSync(globalConfigPath, { force: true });
  rmSync(projectConfigBackupPath, { force: true });
}

process.exit(0);

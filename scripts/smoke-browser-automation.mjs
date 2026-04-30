import { _electron as electron } from "playwright";
import electronPath from "electron";
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const outputDir = resolve("output/playwright");
const smokeUserDataPath = resolve(outputDir, "wmux-browser-smoke-user-data");
const smokeSocketPath =
  process.platform === "win32" ? "\\\\.\\pipe\\wmux-browser-smoke" : resolve(outputDir, "wmux-browser-smoke.sock");
const smokeSocketToken = "wmux-browser-smoke-token";
const allowAllSocketPath =
  process.platform === "win32" ? "\\\\.\\pipe\\wmux-browser-smoke-allow-all" : resolve(outputDir, "wmux-browser-smoke-allow-all.sock");
const offSocketPath =
  process.platform === "win32" ? "\\\\.\\pipe\\wmux-browser-smoke-off" : resolve(outputDir, "wmux-browser-smoke-off.sock");
const screenshotPath = resolve(outputDir, "browser-automation-smoke.png");

mkdirSync(outputDir, { recursive: true });
rmSync(smokeUserDataPath, { force: true, recursive: true });
rmSync(screenshotPath, { force: true });

function log(message) {
  console.log(message);
}

async function launchApp({ socketPath = smokeSocketPath, securityMode = "wmuxOnly", token = smokeSocketToken } = {}) {
  return electron.launch({
    executablePath: electronPath,
    args: ["out/main/index.js"],
    env: {
      ...process.env,
      WMUX_USER_DATA_DIR: smokeUserDataPath,
      WMUX_SOCKET_PATH: socketPath,
      ...(token ? { WMUX_SOCKET_TOKEN: token } : {}),
      WMUX_SECURITY_MODE: securityMode
    }
  });
}

async function getReadyWindow(app) {
  const window = await app.firstWindow();
  await window.waitForLoadState("domcontentloaded");
  await window.waitForSelector(".terminalHost .xterm textarea", { state: "attached", timeout: 15_000 });
  return window;
}

async function runCli(args, options = {}) {
  const tokenEnv =
    options.token === null
      ? {}
      : {
          WMUX_SOCKET_TOKEN: options.token ?? smokeSocketToken
        };
  try {
    const result = await execFileAsync(process.execPath, ["scripts/wmux-cli.mjs", ...args], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        WMUX_SOCKET_PATH: options.socketPath ?? smokeSocketPath,
        ...tokenEnv
      },
      timeout: 20_000
    });
    return { code: 0, stdout: result.stdout.trim(), stderr: result.stderr.trim() };
  } catch (error) {
    if (options.allowFailure) {
      return {
        code: error.code ?? 1,
        stdout: error.stdout?.trim() ?? "",
        stderr: error.stderr?.trim() ?? String(error)
      };
    }
    throw error;
  }
}

function parseJson(output) {
  return JSON.parse(output);
}

const smokeHtml = encodeURIComponent(`<!doctype html>
<title>WMUX Browser Automation Smoke</title>
<main>
  <h1>WMUX_BROWSER_AUTOMATION</h1>
  <input id="name" />
  <button id="submit" onclick="document.body.dataset.clicked=document.querySelector('#name').value;document.querySelector('#result').textContent='clicked: '+document.body.dataset.clicked">Submit</button>
  <p id="result"></p>
</main>`);
const smokeUrl = `data:text/html,${smokeHtml}`;

async function startTerminalLinkServer() {
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end("<!doctype html><title>WMUX Terminal Link</title><h1>WMUX_TERMINAL_LINK_BROWSER</h1>");
  });

  await new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", resolveListen);
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error(`terminal link server did not expose a port: ${JSON.stringify(address)}`);
  }

  return {
    server,
    url: `http://127.0.0.1:${address.port}/terminal-link`
  };
}

async function closeServer(server) {
  await new Promise((resolveClose) => server.close(resolveClose));
}

let app;
let terminalLinkServer;

try {
  app = await launchApp({ socketPath: allowAllSocketPath, securityMode: "allowAll", token: null });
  const allowAllWindow = await getReadyWindow(app);
  const allowAllPing = await runCli(["ping"], { socketPath: allowAllSocketPath, token: null });
  if (!allowAllPing.stdout.includes("pong")) {
    throw new Error(`allowAll should allow ping without token: ${JSON.stringify(allowAllPing)}`);
  }
  await allowAllWindow.waitForFunction(() => document.body.textContent?.includes("WMUX_SECURITY_MODE=allowAll"), null, {
    timeout: 15_000
  });
  log("ok browser auth allowAll warning and no-token ping");
  await Promise.race([app.close(), new Promise((resolvePromise) => setTimeout(resolvePromise, 3_000))]);
  app = undefined;

  app = await launchApp({ socketPath: offSocketPath, securityMode: "off", token: null });
  await getReadyWindow(app);
  const offPing = await runCli(["ping"], { allowFailure: true, socketPath: offSocketPath, token: null });
  if (offPing.code !== 3) {
    throw new Error(`off mode should not start socket: ${JSON.stringify(offPing)}`);
  }
  log("ok browser auth off disables socket");
  await Promise.race([app.close(), new Promise((resolvePromise) => setTimeout(resolvePromise, 3_000))]);
  app = undefined;

  app = await launchApp();
  await getReadyWindow(app);
  await app.windows()[0].waitForTimeout(1_000);

  const noToken = await runCli(["ping"], { allowFailure: true, token: null });
  if (noToken.code !== 1 || !noToken.stderr.includes("UNAUTHORIZED")) {
    throw new Error(`missing token should be unauthorized: ${JSON.stringify(noToken)}`);
  }
  log("ok browser auth missing token rejected");

  const wrongToken = await runCli(["ping"], { allowFailure: true, token: "wrong-token" });
  if (wrongToken.code !== 1 || !wrongToken.stderr.includes("UNAUTHORIZED")) {
    throw new Error(`wrong token should be unauthorized: ${JSON.stringify(wrongToken)}`);
  }
  log("ok browser auth wrong token rejected");

  const ping = await runCli(["ping"]);
  if (!ping.stdout.includes("pong")) {
    throw new Error(`correct token should ping: ${JSON.stringify(ping)}`);
  }
  log("ok browser auth correct token");

  const workspaces = await runCli(["list-workspaces"]);
  if (!workspaces.stdout.includes("API Server")) {
    throw new Error(`list-workspaces should succeed with token: ${JSON.stringify(workspaces)}`);
  }
  log("ok browser auth list-workspaces with token");

  const notify = await runCli(["notify", "--title", "WMUX_TOKEN_NOTIFY", "--body", "socket smoke"]);
  if (!notify.stdout.includes("notified")) {
    throw new Error(`notify should succeed with token: ${JSON.stringify(notify)}`);
  }
  log("ok browser auth notify with token");

  const terminalLink = await startTerminalLinkServer();
  terminalLinkServer = terminalLink.server;
  const terminalClickUrl = `${terminalLink.url}?source=terminal-click`;

  const sendLink = await runCli(["send", `Write-Output "${terminalClickUrl}"\r`]);
  if (!sendLink.stdout.includes("sent")) {
    throw new Error(`send should write terminal link: ${JSON.stringify(sendLink)}`);
  }
  await app.windows()[0].waitForFunction(
    (url) => Array.from(document.querySelectorAll(".xterm-rows > div")).some((element) => element.textContent?.includes(url)),
    terminalClickUrl,
    { timeout: 15_000 }
  );
  const terminalLinkClicked = await app.windows()[0].evaluate((url) => {
    const row = Array.from(document.querySelectorAll(".xterm-rows > div")).find((element) =>
      element.textContent?.includes(url)
    );
    if (!row) {
      return false;
    }
    const rect = row.getBoundingClientRect();
    row.dispatchEvent(
      new globalThis.MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2
      })
    );
    return true;
  }, terminalClickUrl);
  if (!terminalLinkClicked) {
    throw new Error(`terminal link text was not visible: ${terminalClickUrl}`);
  }
  await app.windows()[0].waitForFunction(
    (url) =>
      Array.from(document.querySelectorAll("webview")).some((webview) => {
        try {
          const getURL = webview.getURL;
          return typeof getURL === "function" && getURL.call(webview).startsWith(url);
        } catch {
          return false;
        }
      }),
    terminalClickUrl,
    { timeout: 15_000 }
  );
  log("ok browser terminal link opens internal browser");

  const navigate = parseJson(
    (await runCli(["browser", "navigate", smokeUrl, "--create", "--json"])).stdout
  );
  if (!navigate.surfaceId || !navigate.url.startsWith("data:text/html")) {
    throw new Error(`navigate failed: ${JSON.stringify(navigate)}`);
  }
  log("ok browser navigate");

  const list = parseJson((await runCli(["browser", "list", "--json"])).stdout);
  const listedBrowser = list.browsers?.find((browser) => browser.surfaceId === navigate.surfaceId);
  if (!listedBrowser || listedBrowser.workspaceId !== navigate.workspaceId || listedBrowser.paneId !== navigate.paneId) {
    throw new Error(`browser list did not include navigated surface: ${JSON.stringify(list)}`);
  }
  log("ok browser list");

  const snapshot = parseJson((await runCli(["browser", "snapshot", "--surface", navigate.surfaceId, "--json"])).stdout);
  const snapshotText = JSON.stringify(snapshot);
  if (!snapshotText.includes("WMUX Browser Automation Smoke") || !snapshotText.includes("submit")) {
    throw new Error(`snapshot did not include expected content: ${snapshotText}`);
  }
  log("ok browser snapshot");

  await runCli(["browser", "fill", "#name", "wmux", "--surface", navigate.surfaceId]);
  const filledValue = parseJson(
    (await runCli(["browser", "eval", "document.querySelector('#name').value", "--surface", navigate.surfaceId, "--json"])).stdout
  );
  if (filledValue.value !== "wmux") {
    throw new Error(`fill did not update input: ${JSON.stringify(filledValue)}`);
  }
  log("ok browser fill");

  await runCli(["browser", "click", "#submit", "--surface", navigate.surfaceId]);
  const clickedValue = parseJson(
    (await runCli(["browser", "eval", "document.body.dataset.clicked", "--surface", navigate.surfaceId, "--json"])).stdout
  );
  if (clickedValue.value !== "wmux") {
    throw new Error(`click did not update dataset: ${JSON.stringify(clickedValue)}`);
  }
  log("ok browser click");
  log("ok browser eval");

  const screenshot = parseJson(
    (await runCli(["browser", "screenshot", "--surface", navigate.surfaceId, "--out", screenshotPath, "--json"])).stdout
  );
  if (!existsSync(screenshot.path) || screenshot.bytes < 1024) {
    throw new Error(`screenshot file invalid: ${JSON.stringify(screenshot)}`);
  }
  log("ok browser screenshot file");

  const screenshotBase64 = parseJson(
    (await runCli(["browser", "screenshot", "--surface", navigate.surfaceId, "--base64", "--json"])).stdout
  );
  if (screenshotBase64.mimeType !== "image/png" || !screenshotBase64.base64) {
    throw new Error(`screenshot base64 invalid: ${JSON.stringify(screenshotBase64)}`);
  }
  log("ok browser screenshot base64");

  const second = parseJson(
    (await runCli(["browser", "open", "data:text/html,<title>Second</title><h1>SECOND_BROWSER</h1>", "--json"])).stdout
  );
  if (!second.surfaceId || second.surfaceId === navigate.surfaceId) {
    throw new Error(`second browser was not created: ${JSON.stringify(second)}`);
  }
  const ambiguous = await runCli(["browser", "snapshot"], { allowFailure: true });
  if (
    ambiguous.code !== 1 ||
    !ambiguous.stderr.includes("多个 browser surface") ||
    !ambiguous.stderr.includes(`--surface ${navigate.surfaceId}`) ||
    !ambiguous.stderr.includes(`--surface ${second.surfaceId}`)
  ) {
    throw new Error(`ambiguous target did not fail as expected: ${JSON.stringify(ambiguous)}`);
  }
  parseJson((await runCli(["browser", "snapshot", "--surface", navigate.surfaceId, "--json"])).stdout);
  log("ok browser ambiguous target");

  const createRejected = await runCli(["browser", "click", "#submit", "--create"], { allowFailure: true });
  if (createRejected.code !== 2) {
    throw new Error(`--create should be rejected by CLI with code 2: ${JSON.stringify(createRejected)}`);
  }
  log("ok browser create rejected for non-navigate");

  log("browser automation smoke ok");
} catch (error) {
  const window = app?.windows()[0];
  await window?.screenshot({ path: resolve(outputDir, "browser-automation-smoke-failure.png") }).catch(() => {});
  throw error;
} finally {
  if (terminalLinkServer) {
    await closeServer(terminalLinkServer).catch(() => {});
  }
  if (app) {
    await Promise.race([app.close(), new Promise((resolvePromise) => setTimeout(resolvePromise, 3_000))]);
  }
}

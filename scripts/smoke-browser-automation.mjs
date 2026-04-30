import { _electron as electron } from "playwright";
import electronPath from "electron";
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const outputDir = resolve("output/playwright");
const smokeUserDataPath = resolve(outputDir, "wmux-browser-smoke-user-data");
const smokeSocketPath =
  process.platform === "win32" ? "\\\\.\\pipe\\wmux-browser-smoke" : resolve(outputDir, "wmux-browser-smoke.sock");
const screenshotPath = resolve(outputDir, "browser-automation-smoke.png");

mkdirSync(outputDir, { recursive: true });
rmSync(smokeUserDataPath, { force: true, recursive: true });
rmSync(screenshotPath, { force: true });

function log(message) {
  console.log(message);
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
  await window.waitForSelector(".terminalHost .xterm textarea", { state: "attached", timeout: 15_000 });
  return window;
}

async function runCli(args, options = {}) {
  try {
    const result = await execFileAsync(process.execPath, ["scripts/wmux-cli.mjs", ...args], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        WMUX_SOCKET_PATH: smokeSocketPath
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

let app;

try {
  app = await launchApp();
  await getReadyWindow(app);

  const navigate = parseJson((await runCli(["browser", "navigate", smokeUrl, "--create", "--json"])).stdout);
  if (!navigate.surfaceId || !navigate.url.startsWith("data:text/html")) {
    throw new Error(`navigate failed: ${JSON.stringify(navigate)}`);
  }
  log("ok browser navigate");

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
  if (ambiguous.code !== 1 || !ambiguous.stderr.includes("多个 browser surface")) {
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
  if (app) {
    await Promise.race([app.close(), new Promise((resolvePromise) => setTimeout(resolvePromise, 3_000))]);
  }
}

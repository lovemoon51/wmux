import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { detectNodeVersion, detectPythonVenv, inspectWorkspaceRuntime, parsePackageNodeEngine } from "./workspaceRuntime";

async function makeRuntimeFixture(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "wmux-runtime-"));
}

describe("workspaceRuntime", () => {
  it("优先读取最近的 .nvmrc", async () => {
    const root = await makeRuntimeFixture();
    const child = path.join(root, "apps", "web");
    await mkdir(child, { recursive: true });
    await writeFile(path.join(root, "package.json"), JSON.stringify({ engines: { node: ">=18" } }));
    await writeFile(path.join(child, ".nvmrc"), "v20.18.0\n");

    await expect(detectNodeVersion(child)).resolves.toBe("v20.18.0");
  });

  it("没有 .nvmrc 时读取 package.json engines.node", async () => {
    const root = await makeRuntimeFixture();
    const child = path.join(root, "docs");
    await mkdir(child, { recursive: true });
    await writeFile(path.join(root, "package.json"), JSON.stringify({ engines: { node: ">=20 <23" } }));

    await expect(detectNodeVersion(child)).resolves.toBe(">=20 <23");
  });

  it(".nvmrc 优先于更近的 package.json engines.node", async () => {
    const root = await makeRuntimeFixture();
    const child = path.join(root, "packages", "web");
    await mkdir(child, { recursive: true });
    await writeFile(path.join(root, ".nvmrc"), "22\n");
    await writeFile(path.join(child, "package.json"), JSON.stringify({ engines: { node: ">=18" } }));

    await expect(detectNodeVersion(child)).resolves.toBe("22");
  });

  it("忽略非法 package.json engines", () => {
    expect(parsePackageNodeEngine("{not-json")).toBeUndefined();
    expect(parsePackageNodeEngine(JSON.stringify({ engines: { node: 20 } }))).toBeUndefined();
  });

  it("从当前目录或父目录识别 Python venv", async () => {
    const root = await makeRuntimeFixture();
    const child = path.join(root, "packages", "api");
    await mkdir(path.join(root, ".venv", "Scripts"), { recursive: true });
    await mkdir(child, { recursive: true });
    await writeFile(path.join(root, ".venv", "Scripts", "python.exe"), "");

    await expect(detectPythonVenv(child)).resolves.toBe(".venv");
  });

  it("组合返回 venv 与 nodeVersion", async () => {
    const root = await makeRuntimeFixture();
    await mkdir(path.join(root, "venv"), { recursive: true });
    await writeFile(path.join(root, "venv", "pyvenv.cfg"), "home = python\n");
    await writeFile(path.join(root, ".nvmrc"), "lts/*\n");

    await expect(inspectWorkspaceRuntime(root)).resolves.toEqual({
      venv: "venv",
      nodeVersion: "lts/*"
    });
  });
});

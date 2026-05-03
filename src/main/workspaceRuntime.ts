import { access, readFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

export type WorkspaceRuntimeInspection = {
  venv?: string;
  nodeVersion?: string;
};

const runtimeSearchDepth = 6;
const pythonVenvDirectoryNames = [".venv", "venv", "env"];

export async function inspectWorkspaceRuntime(cwd: string): Promise<WorkspaceRuntimeInspection> {
  const [venv, nodeVersion] = await Promise.all([detectPythonVenv(cwd), detectNodeVersion(cwd)]);
  return { venv, nodeVersion };
}

export async function detectPythonVenv(cwd: string): Promise<string | undefined> {
  for (const directory of getRuntimeSearchDirectories(cwd)) {
    for (const name of pythonVenvDirectoryNames) {
      const root = join(directory, name);
      if (
        (await pathExists(join(root, "pyvenv.cfg"))) ||
        (await pathExists(join(root, "Scripts", "python.exe"))) ||
        (await pathExists(join(root, "bin", "python")))
      ) {
        return name || basename(root);
      }
    }
  }
  return undefined;
}

export async function detectNodeVersion(cwd: string): Promise<string | undefined> {
  const directories = getRuntimeSearchDirectories(cwd);
  for (const directory of directories) {
    const nvmrcVersion = await readNvmrcVersion(join(directory, ".nvmrc"));
    if (nvmrcVersion) {
      return nvmrcVersion;
    }
  }

  for (const directory of directories) {
    const packageEngine = await readPackageNodeEngine(join(directory, "package.json"));
    if (packageEngine) {
      return packageEngine;
    }
  }
  return undefined;
}

export function parsePackageNodeEngine(content: string): string | undefined {
  try {
    const parsed = JSON.parse(content) as unknown;
    if (!isRecord(parsed) || !isRecord(parsed.engines) || typeof parsed.engines.node !== "string") {
      return undefined;
    }
    return parsed.engines.node.trim() || undefined;
  } catch {
    return undefined;
  }
}

function getRuntimeSearchDirectories(cwd: string): string[] {
  const directories: string[] = [];
  let current = resolve(cwd);

  for (let depth = 0; depth < runtimeSearchDepth; depth += 1) {
    directories.push(current);
    const parent = dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }

  return directories;
}

async function readNvmrcVersion(path: string): Promise<string | undefined> {
  try {
    const content = await readFile(path, "utf8");
    return (
      content
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find((line) => line && !line.startsWith("#")) ?? undefined
    );
  } catch {
    return undefined;
  }
}

async function readPackageNodeEngine(path: string): Promise<string | undefined> {
  try {
    return parsePackageNodeEngine(await readFile(path, "utf8"));
  } catch {
    return undefined;
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

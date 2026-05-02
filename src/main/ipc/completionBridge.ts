import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { ipcMain } from "electron";
import type {
  CompletionDirectoryEntry,
  CompletionListDirectoryParams,
  CompletionListDirectoryResult,
  CompletionListGitBranchesParams,
  CompletionListGitBranchesResult
} from "../../shared/types";

const execFileAsync = promisify(execFile);
const defaultCompletionLimit = 50;
const maxCompletionLimit = 100;
const ignoredDirectoryNames = new Set([".git", "node_modules", "out", ".claude"]);

export function registerCompletionIpc(): void {
  ipcMain.handle(
    "completion:listDirectory",
    async (_event, params: CompletionListDirectoryParams): Promise<CompletionListDirectoryResult> => ({
      entries: await listCompletionDirectory(params)
    })
  );

  ipcMain.handle(
    "completion:listGitBranches",
    async (_event, params: CompletionListGitBranchesParams): Promise<CompletionListGitBranchesResult> => ({
      branches: await listCompletionGitBranches(params)
    })
  );
}

export async function listCompletionDirectory(
  params: CompletionListDirectoryParams
): Promise<CompletionDirectoryEntry[]> {
  const limit = normalizeLimit(params.limit);
  const resolved = await resolveWorkspaceBoundPath(params.cwd, readQueryDirectory(params.query));
  if (!resolved) {
    return [];
  }

  try {
    const entries = await readdir(resolved.target, { withFileTypes: true });
    return entries
      .filter((entry) => shouldIncludeDirectoryEntry(entry.name, params.includeHidden ?? false))
      .slice(0, limit)
      .map((entry) => {
        const entryPath = path.join(resolved.target, entry.name);
        return {
          name: entry.name,
          kind: entry.isDirectory() ? "directory" : "file",
          relativePath: normalizeRelativePathForCompletion(resolved.root, entryPath)
        };
      });
  } catch {
    return [];
  }
}

export async function listCompletionGitBranches(params: CompletionListGitBranchesParams): Promise<string[]> {
  const limit = normalizeLimit(params.limit);
  const resolved = await resolveWorkspaceBoundPath(params.cwd, ".");
  if (!resolved) {
    return [];
  }

  try {
    const { stdout } = await execFileAsync(
      "git",
      ["-C", resolved.root, "for-each-ref", "refs/heads", "refs/remotes", "--format=%(refname:short)"],
      { timeout: 2500, windowsHide: true }
    );
    const prefix = params.prefix?.trim() ?? "";
    return [...new Set(stdout.split(/\r?\n/).map((branch) => branch.trim()).filter(Boolean))]
      .filter((branch) => !branch.includes("HEAD ->"))
      .filter((branch) => !prefix || branch.toLowerCase().startsWith(prefix.toLowerCase()))
      .slice(0, limit);
  } catch {
    return [];
  }
}

export async function resolveWorkspaceBoundPath(
  cwd: string,
  queryDirectory: string
): Promise<{ root: string; target: string } | null> {
  if (!cwd.trim() || path.isAbsolute(queryDirectory)) {
    return null;
  }

  const root = path.resolve(cwd);
  if (!existsSync(root)) {
    return null;
  }

  const target = path.resolve(root, queryDirectory || ".");
  if (!isPathInside(root, target)) {
    return null;
  }

  try {
    const [realRoot, realTarget] = await Promise.all([realpath(root), realpath(target)]);
    if (!isPathInside(realRoot, realTarget)) {
      return null;
    }
    return { root: realRoot, target: realTarget };
  } catch {
    return null;
  }
}

export function isPathInside(root: string, target: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export function normalizeRelativePathForCompletion(root: string, entryPath: string): string {
  return path.relative(root, entryPath).replace(/\\/g, "/");
}

function readQueryDirectory(query: string): string {
  const normalized = query.replace(/\\/g, "/");
  if (!normalized || normalized.endsWith("/")) {
    return normalized || ".";
  }
  const slashIndex = normalized.lastIndexOf("/");
  return slashIndex >= 0 ? normalized.slice(0, slashIndex + 1) : ".";
}

function shouldIncludeDirectoryEntry(name: string, includeHidden: boolean): boolean {
  if (ignoredDirectoryNames.has(name)) {
    return false;
  }
  if (!includeHidden && name.startsWith(".")) {
    return false;
  }
  return true;
}

function normalizeLimit(limit: number | undefined): number {
  if (typeof limit !== "number" || !Number.isFinite(limit)) {
    return defaultCompletionLimit;
  }
  return Math.max(1, Math.min(maxCompletionLimit, Math.floor(limit)));
}

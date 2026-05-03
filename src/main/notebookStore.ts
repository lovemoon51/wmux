import { existsSync } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { NotebookLoadResult, NotebookSaveResult } from "../shared/types";

const notebookDirectory = ".wmux/notebooks";
const notebookIdPattern = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;

export function isValidNotebookId(value: string): boolean {
  return notebookIdPattern.test(value);
}

export function createDefaultNotebook(title: string | undefined): string {
  const heading = title?.trim() || "Notebook";
  return [
    `# ${heading}`,
    "",
    "```powershell",
    "Get-Location",
    "```",
    ""
  ].join("\n");
}

export function resolveNotebookPath(cwd: string, notebookId: string): { root: string; path: string; relativePath: string } {
  if (!cwd.trim()) {
    throw new Error("notebook cwd 不能为空");
  }
  if (!isValidNotebookId(notebookId)) {
    throw new Error("notebookId 只能包含字母、数字、点、下划线和短横线，且长度不超过 128");
  }

  const root = path.resolve(cwd);
  const notebookRoot = path.resolve(root, notebookDirectory);
  const notebookPath = path.resolve(notebookRoot, `${notebookId}.md`);
  if (!isPathInside(notebookRoot, notebookPath)) {
    throw new Error("notebook 路径越界");
  }

  return {
    root: notebookRoot,
    path: notebookPath,
    relativePath: path.relative(root, notebookPath).replace(/\\/g, "/")
  };
}

export async function loadNotebook(cwd: string, notebookId: string, title?: string): Promise<NotebookLoadResult> {
  const resolved = resolveNotebookPath(cwd, notebookId);
  if (!existsSync(resolved.path)) {
    return {
      notebookId,
      path: resolved.path,
      relativePath: resolved.relativePath,
      content: createDefaultNotebook(title),
      exists: false
    };
  }

  const [content, info] = await Promise.all([readFile(resolved.path, "utf8"), stat(resolved.path)]);
  return {
    notebookId,
    path: resolved.path,
    relativePath: resolved.relativePath,
    content,
    exists: true,
    updatedAt: info.mtime.toISOString()
  };
}

export async function saveNotebook(cwd: string, notebookId: string, content: string): Promise<NotebookSaveResult> {
  const resolved = resolveNotebookPath(cwd, notebookId);
  await mkdir(resolved.root, { recursive: true });
  await writeFile(resolved.path, content, "utf8");
  const info = await stat(resolved.path);

  return {
    notebookId,
    path: resolved.path,
    relativePath: resolved.relativePath,
    bytes: Buffer.byteLength(content, "utf8"),
    updatedAt: info.mtime.toISOString()
  };
}

function isPathInside(root: string, target: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

import type { Surface } from "@shared/types";

export function normalizeNotebookId(value: string | undefined, number: number, now = Date.now()): string {
  const fallback = `notebook-${now}-${number}`;
  const raw = (value?.trim() || fallback).replace(/^surface-notebook-/, "");
  const sanitized = raw.replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 128);
  return /^[a-zA-Z0-9]/.test(sanitized) ? sanitized : fallback;
}

export function createNotebookSurface(options: { number: number; name?: string; notebookId?: string; now?: number }): Surface {
  const notebookId = normalizeNotebookId(options.notebookId, options.number, options.now);
  return {
    id: `surface-notebook-${notebookId}`,
    type: "notebook",
    name: options.name?.trim() || `Notebook ${options.number}`,
    subtitle: `.wmux/notebooks/${notebookId}.md`,
    status: "idle",
    notebookId
  };
}

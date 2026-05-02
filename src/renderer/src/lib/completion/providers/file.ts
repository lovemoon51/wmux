import type { ShellCompletionContext, ShellCompletionItem } from "../types";

export async function completeFilePath(context: ShellCompletionContext): Promise<ShellCompletionItem[]> {
  if (context.position !== "path" && !expectsPathArgument(context)) {
    return [];
  }

  const result = await window.wmux?.completion.listDirectory({
    workspaceId: context.workspaceId,
    cwd: context.cwd,
    query: context.currentWord,
    limit: 50
  });

  const prefix = readPathPrefix(context.currentWord);
  const leaf = readPathLeaf(context.currentWord).toLowerCase();
  return (result?.entries ?? [])
    .filter((entry) => !leaf || entry.name.toLowerCase().startsWith(leaf))
    .map((entry): ShellCompletionItem => {
      const apply = `${prefix}${entry.name}${entry.kind === "directory" ? "/" : ""}`;
      return {
        label: entry.kind === "directory" ? `${entry.name}/` : entry.name,
        apply,
        detail: entry.kind,
        kind: entry.kind
      };
    });
}

function expectsPathArgument(context: ShellCompletionContext): boolean {
  return Boolean(context.command && ["cat", "cd", "ls", "cp", "mv", "rm", "mkdir", "touch", "grep"].includes(context.command));
}

function readPathPrefix(value: string): string {
  const normalized = value.replace(/\\/g, "/");
  const slashIndex = normalized.lastIndexOf("/");
  return slashIndex >= 0 ? normalized.slice(0, slashIndex + 1) : "";
}

function readPathLeaf(value: string): string {
  const normalized = value.replace(/\\/g, "/");
  const slashIndex = normalized.lastIndexOf("/");
  return slashIndex >= 0 ? normalized.slice(slashIndex + 1) : normalized;
}

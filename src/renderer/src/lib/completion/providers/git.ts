import type { ShellCompletionContext, ShellCompletionItem } from "../types";

const branchSubcommands = new Set(["checkout", "switch", "merge", "rebase", "branch"]);

export async function completeGitBranches(context: ShellCompletionContext): Promise<ShellCompletionItem[]> {
  if (context.command !== "git" || !context.subcommand || !branchSubcommands.has(context.subcommand)) {
    return [];
  }
  if (context.currentWord.startsWith("-")) {
    return [];
  }

  const result = await window.wmux?.completion.listGitBranches({
    workspaceId: context.workspaceId,
    cwd: context.cwd,
    prefix: context.currentWord,
    limit: 50
  });

  return (result?.branches ?? []).map((branch) => ({
    label: branch,
    apply: branch,
    detail: "branch",
    kind: "branch"
  }));
}

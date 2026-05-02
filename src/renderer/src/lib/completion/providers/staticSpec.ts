import type { ShellCompletionContext, ShellCompletionItem } from "../types";

type StaticCommandSpec = {
  subcommands?: ShellCompletionItem[];
  flags?: ShellCompletionItem[];
  subcommandFlags?: Record<string, ShellCompletionItem[]>;
};

const staticSpecs: Record<string, StaticCommandSpec> = {
  git: {
    subcommands: [
      item("checkout", "subcommand", "Switch branches or restore paths"),
      item("cherry-pick", "subcommand", "Apply commits"),
      item("switch", "subcommand", "Switch branches"),
      item("merge", "subcommand", "Join histories"),
      item("rebase", "subcommand", "Reapply commits"),
      item("branch", "subcommand", "List or create branches"),
      item("status", "subcommand", "Show working tree status"),
      item("log", "subcommand", "Show commit logs"),
      item("pull", "subcommand", "Fetch and integrate"),
      item("push", "subcommand", "Update remote refs")
    ],
    flags: [item("--help", "flag", "Show help"), item("--version", "flag", "Show version")],
    subcommandFlags: {
      checkout: [item("-b", "flag", "Create and checkout a branch"), item("--track", "flag", "Track remote branch")],
      log: [item("--oneline", "flag", "Compact commits"), item("--graph", "flag", "Show graph")],
      branch: [item("-a", "flag", "List all branches"), item("-d", "flag", "Delete branch")]
    }
  },
  npm: {
    subcommands: ["install", "run", "test", "start", "build", "publish"].map((label) =>
      item(label, "subcommand", "npm command")
    ),
    flags: [item("--help", "flag", "Show help"), item("--version", "flag", "Show version")]
  },
  pnpm: {
    subcommands: ["install", "run", "test", "start", "build", "add"].map((label) =>
      item(label, "subcommand", "pnpm command")
    )
  },
  yarn: {
    subcommands: ["install", "run", "test", "start", "build", "add"].map((label) =>
      item(label, "subcommand", "yarn command")
    )
  },
  node: { flags: [item("--watch", "flag", "Restart on changes"), item("--inspect", "flag", "Enable inspector")] },
  ls: { flags: [item("-la", "flag", "Long list with hidden files"), item("-lh", "flag", "Human readable sizes")] },
  cat: {},
  cd: {},
  cp: {},
  mv: {},
  rm: { flags: [item("-r", "flag", "Recursive"), item("-f", "flag", "Force")] },
  mkdir: { flags: [item("-p", "flag", "Create parent directories")] },
  touch: {},
  grep: { flags: [item("-n", "flag", "Show line numbers"), item("-R", "flag", "Recursive")] }
};

export function completeFromStaticSpec(context: ShellCompletionContext): ShellCompletionItem[] {
  if (context.position === "command") {
    return Object.keys(staticSpecs).map((label) => item(label, "subcommand", "Command"));
  }

  const spec = context.command ? staticSpecs[context.command] : undefined;
  if (!spec) {
    return [];
  }

  if (context.position === "subcommand") {
    return spec.subcommands ?? [];
  }

  if (context.position === "flag") {
    return [...(context.subcommand ? spec.subcommandFlags?.[context.subcommand] ?? [] : []), ...(spec.flags ?? [])];
  }

  return [];
}

function item(label: string, kind: ShellCompletionItem["kind"], detail: string): ShellCompletionItem {
  return {
    label,
    apply: kind === "subcommand" ? `${label} ` : label,
    detail,
    kind
  };
}

import type { Completion } from "@codemirror/autocomplete";
import type { ShellProfile } from "@shared/types";

export type ShellCompletionKind = "subcommand" | "flag" | "file" | "directory" | "branch";

export type ShellCompletionItem = {
  label: string;
  apply?: string;
  detail?: string;
  info?: string;
  kind: ShellCompletionKind;
  boost?: number;
};

export type ShellCompletionRequest = {
  text: string;
  cursor: number;
  cwd: string;
  workspaceId: string;
  surfaceId: string;
  shell: ShellProfile;
};

export type ShellCompletionProvider = (
  context: ShellCompletionContext
) => ShellCompletionItem[] | Promise<ShellCompletionItem[]>;

export type ShellCompletionContext = {
  text: string;
  cursor: number;
  command?: string;
  subcommand?: string;
  currentWord: string;
  from: number;
  position: "command" | "subcommand" | "flag" | "path" | "argument";
  argv: string[];
  cwd: string;
  workspaceId: string;
  surfaceId: string;
  shell: ShellProfile;
};

export function toCodeMirrorCompletion(item: ShellCompletionItem): Completion {
  return {
    label: item.label,
    apply: item.apply,
    detail: item.detail,
    info: item.info,
    type: readCodeMirrorCompletionType(item.kind),
    boost: item.boost
  };
}

function readCodeMirrorCompletionType(kind: ShellCompletionKind): string {
  if (kind === "flag") {
    return "keyword";
  }
  if (kind === "file" || kind === "directory") {
    return "property";
  }
  if (kind === "branch") {
    return "variable";
  }
  return "function";
}

import type { ShellCompletionContext, ShellCompletionRequest } from "./types";

export function resolveShellCompletionContext(request: ShellCompletionRequest): ShellCompletionContext | null {
  const beforeCursor = request.text.slice(0, request.cursor);
  const currentWordMatch = beforeCursor.match(/[^\s]*$/);
  const currentWord = currentWordMatch?.[0] ?? "";
  const from = request.cursor - currentWord.length;
  const argv = splitShellWords(beforeCursor);
  const command = argv[0];
  const subcommand = command === "git" ? argv.find((item, index) => index > 0 && !item.startsWith("-")) : argv[1];
  const lastCommittedWord = /\s$/.test(beforeCursor) ? "" : currentWord;

  return {
    text: request.text,
    cursor: request.cursor,
    command,
    subcommand,
    currentWord: lastCommittedWord,
    from,
    position: readCompletionPosition(command, subcommand, lastCommittedWord, argv),
    argv,
    cwd: request.cwd,
    workspaceId: request.workspaceId,
    surfaceId: request.surfaceId,
    shell: request.shell
  };
}

export function splitShellWords(input: string): string[] {
  const words: string[] = [];
  let current = "";
  let quote: "'" | '"' | "`" | undefined;
  let escaped = false;

  for (const char of input) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (char === quote) {
        quote = undefined;
      } else {
        current += char;
      }
      continue;
    }
    if (char === "'" || char === '"' || char === "`") {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) {
        words.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }

  if (current) {
    words.push(current);
  }
  return words;
}

function readCompletionPosition(
  command: string | undefined,
  subcommand: string | undefined,
  currentWord: string,
  argv: string[]
): ShellCompletionContext["position"] {
  if (!command || argv.length <= 1) {
    return "command";
  }
  if (command === "git" && argv.length <= 2 && !currentWord.startsWith("-")) {
    return "subcommand";
  }
  if (currentWord.startsWith("-")) {
    return "flag";
  }
  if (isPathLike(currentWord)) {
    return "path";
  }
  if (command === "git" && subcommand && ["checkout", "switch", "merge", "rebase", "branch"].includes(subcommand)) {
    return "argument";
  }
  return "argument";
}

function isPathLike(value: string): boolean {
  return value.startsWith(".") || value.startsWith("/") || value.includes("/") || value.includes("\\");
}

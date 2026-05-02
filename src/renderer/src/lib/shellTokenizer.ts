export type ShellTokenKind =
  | "command"
  | "argument"
  | "flag"
  | "string"
  | "variable"
  | "operator"
  | "comment"
  | "whitespace"
  | "error";

export type ShellToken = {
  kind: ShellTokenKind;
  value: string;
  start: number;
  end: number;
};

export type ShellSyntaxState = {
  quote?: "single" | "double" | "backtick";
  parenDepth: number;
  bracketDepth: number;
  braceDepth: number;
  escaped: boolean;
  hasTrailingContinuation: boolean;
};

export function tokenizeShellInput(input: string): ShellToken[] {
  const tokens: ShellToken[] = [];
  let tokenStart = 0;
  let token = "";
  let quote: ShellSyntaxState["quote"];
  let escaped = false;
  let commandSeen = false;

  const flushWord = (end: number): void => {
    if (!token) {
      tokenStart = end;
      return;
    }
    tokens.push({
      kind: readWordKind(token, commandSeen),
      value: token,
      start: tokenStart,
      end
    });
    commandSeen = commandSeen || !/^\s+$/.test(token);
    token = "";
    tokenStart = end;
  };

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    const next = input[index + 1];

    if (!token) {
      tokenStart = index;
    }

    if (escaped) {
      token += char;
      escaped = false;
      continue;
    }

    if (char === "\\") {
      token += char;
      escaped = true;
      continue;
    }

    if (quote) {
      token += char;
      if (
        (quote === "single" && char === "'") ||
        (quote === "double" && char === '"') ||
        (quote === "backtick" && char === "`")
      ) {
        tokens.push({ kind: "string", value: token, start: tokenStart, end: index + 1 });
        commandSeen = true;
        token = "";
        quote = undefined;
        tokenStart = index + 1;
      }
      continue;
    }

    if (char === "'" || char === '"' || char === "`") {
      flushWord(index);
      quote = char === "'" ? "single" : char === '"' ? "double" : "backtick";
      token = char;
      tokenStart = index;
      continue;
    }

    if (char === "#") {
      flushWord(index);
      tokens.push({ kind: "comment", value: input.slice(index), start: index, end: input.length });
      return tokens;
    }

    if (/\s/.test(char)) {
      flushWord(index);
      const start = index;
      while (index + 1 < input.length && /\s/.test(input[index + 1])) {
        index += 1;
      }
      tokens.push({ kind: "whitespace", value: input.slice(start, index + 1), start, end: index + 1 });
      tokenStart = index + 1;
      continue;
    }

    if (isOperatorStart(char, next)) {
      flushWord(index);
      const value = next && isTwoCharOperator(`${char}${next}`) ? `${char}${next}` : char;
      tokens.push({ kind: "operator", value, start: index, end: index + value.length });
      index += value.length - 1;
      tokenStart = index + 1;
      continue;
    }

    if (char === "$") {
      flushWord(index);
      const end = readVariableEnd(input, index);
      tokens.push({ kind: "variable", value: input.slice(index, end), start: index, end });
      commandSeen = true;
      index = end - 1;
      tokenStart = end;
      continue;
    }

    token += char;
  }

  flushWord(input.length);
  if (quote && token) {
    tokens.push({ kind: "error", value: token, start: tokenStart, end: input.length });
  }
  return tokens;
}

export function analyzeShellSyntax(input: string): ShellSyntaxState {
  let quote: ShellSyntaxState["quote"];
  let escaped = false;
  let parenDepth = 0;
  let bracketDepth = 0;
  let braceDepth = 0;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (
        (quote === "single" && char === "'") ||
        (quote === "double" && char === '"') ||
        (quote === "backtick" && char === "`")
      ) {
        quote = undefined;
      }
      continue;
    }
    if (char === "'" || char === '"' || char === "`") {
      quote = char === "'" ? "single" : char === '"' ? "double" : "backtick";
      continue;
    }
    if (char === "#") {
      break;
    }
    if (char === "(") {
      parenDepth += 1;
    } else if (char === ")") {
      parenDepth = Math.max(0, parenDepth - 1);
    } else if (char === "[") {
      bracketDepth += 1;
    } else if (char === "]") {
      bracketDepth = Math.max(0, bracketDepth - 1);
    } else if (char === "{") {
      braceDepth += 1;
    } else if (char === "}") {
      braceDepth = Math.max(0, braceDepth - 1);
    }
  }

  return {
    quote,
    parenDepth,
    bracketDepth,
    braceDepth,
    escaped,
    hasTrailingContinuation: /\\\s*$/.test(input)
  };
}

export function isShellInputStructurallyOpen(state: ShellSyntaxState): boolean {
  return Boolean(
    state.quote ||
      state.parenDepth > 0 ||
      state.bracketDepth > 0 ||
      state.braceDepth > 0 ||
      state.hasTrailingContinuation
  );
}

function readWordKind(value: string, commandSeen: boolean): ShellTokenKind {
  if (/^-{1,2}[\w-]/.test(value)) {
    return "flag";
  }
  return commandSeen ? "argument" : "command";
}

function isOperatorStart(char: string, next?: string): boolean {
  return "|&;()[]{}".includes(char) || Boolean(next && isTwoCharOperator(`${char}${next}`));
}

function isTwoCharOperator(value: string): boolean {
  return value === "&&" || value === "||" || value === ">>" || value === "$(" || value === "${";
}

function readVariableEnd(input: string, start: number): number {
  const next = input[start + 1];
  if (next === "{" || next === "(") {
    return Math.min(input.length, start + 2);
  }
  let end = start + 1;
  while (end < input.length && /[A-Za-z0-9_]/.test(input[end])) {
    end += 1;
  }
  return end > start + 1 ? end : start + 1;
}

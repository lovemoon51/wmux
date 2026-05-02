export type CommandSubmission =
  | { kind: "empty"; data: "" }
  | { kind: "command"; data: string; text: string }
  | { kind: "aiPrompt"; data: string; text: string; prompt: string };

export function normalizeSubmittedCommand(text: string): string {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  return normalized.endsWith("\n") ? normalized : `${normalized}\n`;
}

export function prepareCommandSubmission(text: string): CommandSubmission {
  if (!text.trim()) {
    return { kind: "empty", data: "" };
  }

  const data = normalizeSubmittedCommand(text);
  const trimmed = text.trimStart();
  if (trimmed.startsWith("#")) {
    return {
      kind: "aiPrompt",
      data,
      text,
      prompt: trimmed.slice(1).trim()
    };
  }

  return { kind: "command", data, text };
}

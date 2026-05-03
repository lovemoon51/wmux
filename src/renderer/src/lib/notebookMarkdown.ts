export type NotebookTextBlock = {
  type: "markdown";
  id: string;
  text: string;
};

export type NotebookCodeBlock = {
  type: "code";
  id: string;
  index: number;
  language: string;
  code: string;
};

export type NotebookBlock = NotebookTextBlock | NotebookCodeBlock;

const fencedCodeBlockPattern = /^```([^\r\n`]*)\r?\n([\s\S]*?)(?:\r?\n```|$)/gm;

export function parseNotebookBlocks(markdown: string): NotebookBlock[] {
  const blocks: NotebookBlock[] = [];
  let cursor = 0;
  let codeIndex = 0;

  for (const match of markdown.matchAll(fencedCodeBlockPattern)) {
    const start = match.index ?? 0;
    if (start > cursor) {
      const text = markdown.slice(cursor, start);
      if (text.trim()) {
        blocks.push({ type: "markdown", id: `markdown-${blocks.length}`, text });
      }
    }

    codeIndex += 1;
    blocks.push({
      type: "code",
      id: `code-${codeIndex}`,
      index: codeIndex,
      language: normalizeNotebookLanguage(match[1]),
      code: match[2].replace(/\r\n/g, "\n")
    });
    cursor = start + match[0].length;
  }

  if (cursor < markdown.length) {
    const text = markdown.slice(cursor);
    if (text.trim()) {
      blocks.push({ type: "markdown", id: `markdown-${blocks.length}`, text });
    }
  }

  return blocks.length ? blocks : [{ type: "markdown", id: "markdown-empty", text: markdown }];
}

export function extractNotebookCodeBlocks(markdown: string): NotebookCodeBlock[] {
  return parseNotebookBlocks(markdown).filter((block): block is NotebookCodeBlock => block.type === "code");
}

export function normalizeNotebookLanguage(language: string | undefined): string {
  const normalized = language?.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  if (!normalized) {
    return "shell";
  }
  if (normalized === "sh" || normalized === "shell-session" || normalized === "console") {
    return "shell";
  }
  if (normalized === "ps1" || normalized === "pwsh") {
    return "powershell";
  }
  return normalized;
}


import { describe, expect, it } from "vitest";
import { extractNotebookCodeBlocks, normalizeNotebookLanguage, parseNotebookBlocks } from "./notebookMarkdown";

describe("notebookMarkdown", () => {
  it("splits markdown and fenced code blocks in order", () => {
    const blocks = parseNotebookBlocks("# Demo\n\n```bash\nnpm test\n```\n\nNotes\n\n```ps1\nGet-Location\n```\n");

    expect(blocks.map((block) => block.type)).toEqual(["markdown", "code", "markdown", "code"]);
    expect(extractNotebookCodeBlocks("# Demo\n\n```bash\nnpm test\n```")).toEqual([
      {
        type: "code",
        id: "code-1",
        index: 1,
        language: "bash",
        code: "npm test"
      }
    ]);
  });

  it("normalizes shell language aliases", () => {
    expect(normalizeNotebookLanguage("")).toBe("shell");
    expect(normalizeNotebookLanguage("pwsh")).toBe("powershell");
    expect(normalizeNotebookLanguage("shell-session")).toBe("shell");
  });

  it("treats an unclosed fenced block as executable code", () => {
    const blocks = parseNotebookBlocks("Intro\n\n```bash\nnpm test\nnpm run lint");

    expect(blocks).toEqual([
      {
        type: "markdown",
        id: "markdown-0",
        text: "Intro\n\n"
      },
      {
        type: "code",
        id: "code-1",
        index: 1,
        language: "bash",
        code: "npm test\nnpm run lint"
      }
    ]);
  });
});

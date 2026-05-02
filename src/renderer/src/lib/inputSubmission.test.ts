import { describe, expect, it } from "vitest";
import { normalizeSubmittedCommand, prepareCommandSubmission } from "./inputSubmission";

describe("inputSubmission", () => {
  it("adds exactly one trailing newline for command submission", () => {
    expect(normalizeSubmittedCommand("npm test")).toBe("npm test\n");
    expect(normalizeSubmittedCommand("npm test\n")).toBe("npm test\n");
    expect(normalizeSubmittedCommand("npm test\r\n")).toBe("npm test\n");
  });

  it("preserves multiline command bodies and indentation", () => {
    const script = "for file in *.png\n  do\n    echo \"$file\"\n  done";
    expect(prepareCommandSubmission(script)).toEqual({
      kind: "command",
      text: script,
      data: `${script}\n`
    });
  });

  it("returns empty for blank input", () => {
    expect(prepareCommandSubmission("  \n\t")).toEqual({ kind: "empty", data: "" });
  });

  it("marks hash-prefixed text as an AI prompt placeholder", () => {
    expect(prepareCommandSubmission("# convert png to webp")).toEqual({
      kind: "aiPrompt",
      text: "# convert png to webp",
      data: "# convert png to webp\n",
      prompt: "convert png to webp"
    });
  });
});

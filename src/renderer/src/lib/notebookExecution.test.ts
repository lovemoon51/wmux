import { describe, expect, it } from "vitest";
import type { ShellProfile } from "@shared/types";
import { buildNotebookExecutionInput } from "./notebookExecution";

describe("notebookExecution", () => {
  it.each([
    ["cmd", "echo hi\nexit /b %ERRORLEVEL%\r\n"],
    ["bash", "echo hi\nexit $?\n"],
    ["zsh", "echo hi\nexit $?\n"],
    ["pwsh", "echo hi\nexit $LASTEXITCODE\r\n"],
    ["auto", "echo hi\nexit $LASTEXITCODE\r\n"]
  ] satisfies Array<[ShellProfile, string]>)("builds execution input for %s", (shell, expected) => {
    expect(buildNotebookExecutionInput("echo hi", shell)).toBe(expected);
  });

  it("does not add an extra newline when the command already ends with line ending", () => {
    expect(buildNotebookExecutionInput("echo hi\n", "bash")).toBe("echo hi\nexit $?\n");
    expect(buildNotebookExecutionInput("echo hi\r\n", "pwsh")).toBe("echo hi\r\nexit $LASTEXITCODE\r\n");
  });
});

import { describe, expect, it } from "vitest";
import { resolveShellCompletionContext } from "./context";

const baseRequest = {
  cwd: "/repo",
  workspaceId: "workspace-a",
  surfaceId: "surface-a",
  shell: "bash" as const
};

describe("resolveShellCompletionContext", () => {
  it("detects git subcommand completion", () => {
    const context = resolveShellCompletionContext({ ...baseRequest, text: "git che", cursor: 7 });
    expect(context).toMatchObject({
      command: "git",
      currentWord: "che",
      from: 4,
      position: "subcommand"
    });
  });

  it("detects flag completion", () => {
    const context = resolveShellCompletionContext({ ...baseRequest, text: "git checkout -", cursor: 14 });
    expect(context).toMatchObject({
      command: "git",
      subcommand: "checkout",
      currentWord: "-",
      position: "flag"
    });
  });

  it("detects path completion", () => {
    const context = resolveShellCompletionContext({ ...baseRequest, text: "cat ./src/", cursor: 10 });
    expect(context).toMatchObject({
      command: "cat",
      currentWord: "./src/",
      position: "path"
    });
  });
});

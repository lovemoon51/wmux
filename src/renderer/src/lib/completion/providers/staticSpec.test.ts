import { describe, expect, it } from "vitest";
import { resolveShellCompletionContext } from "../context";
import { completeFromStaticSpec } from "./staticSpec";

const baseRequest = {
  cwd: "/repo",
  workspaceId: "workspace-a",
  surfaceId: "surface-a",
  shell: "bash" as const
};

describe("completeFromStaticSpec", () => {
  it("returns matching git subcommands", () => {
    const context = resolveShellCompletionContext({ ...baseRequest, text: "git che", cursor: 7 });
    expect(context).not.toBeNull();
    const labels = completeFromStaticSpec(context!).map((item) => item.label);
    expect(labels).toContain("checkout");
    expect(labels).toContain("cherry-pick");
  });

  it("returns subcommand flags", () => {
    const context = resolveShellCompletionContext({ ...baseRequest, text: "git checkout -", cursor: 14 });
    expect(context).not.toBeNull();
    expect(completeFromStaticSpec(context!).map((item) => item.label)).toContain("-b");
  });
});

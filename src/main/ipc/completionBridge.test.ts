import { mkdtemp, mkdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  isPathInside,
  listCompletionDirectory,
  normalizeRelativePathForCompletion,
  resolveWorkspaceBoundPath
} from "./completionBridge";

describe("completionBridge", () => {
  it("keeps resolved paths inside workspace root", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "wmux-completion-"));
    await mkdir(path.join(root, "src"));

    await expect(resolveWorkspaceBoundPath(root, "src")).resolves.toMatchObject({
      root: expect.any(String),
      target: expect.stringContaining("src")
    });
    await expect(resolveWorkspaceBoundPath(root, "../")).resolves.toBeNull();
    await expect(resolveWorkspaceBoundPath(root, path.resolve(root, "src"))).resolves.toBeNull();
  });

  it("handles Windows-style case-insensitive path containment through path.relative", () => {
    const root = path.resolve("C:/Repo");
    expect(isPathInside(root, path.resolve("C:/Repo/src"))).toBe(true);
    expect(isPathInside(root, path.resolve("C:/Elsewhere"))).toBe(false);
  });

  it("lists files with filtering and limit", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "wmux-completion-"));
    await mkdir(path.join(root, "src"));
    await mkdir(path.join(root, ".git"));
    await mkdir(path.join(root, "node_modules"));
    await writeFile(path.join(root, "README.md"), "");
    await writeFile(path.join(root, ".env"), "");

    const entries = await listCompletionDirectory({
      workspaceId: "workspace-a",
      cwd: root,
      query: ".",
      limit: 10
    });

    expect(entries.map((entry) => entry.name).sort()).toEqual(["README.md", "src"]);
  });

  it("normalizes relative paths for completion", () => {
    expect(normalizeRelativePathForCompletion("C:/repo", "C:/repo/src/index.ts")).toBe("src/index.ts");
  });

  it("does not follow symlink directories outside root", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "wmux-completion-"));
    const outside = await mkdtemp(path.join(tmpdir(), "wmux-completion-outside-"));
    const linkPath = path.join(root, "outside-link");
    try {
      await symlink(outside, linkPath, "dir");
    } catch {
      return;
    }

    await expect(resolveWorkspaceBoundPath(root, "outside-link")).resolves.toBeNull();
  });
});

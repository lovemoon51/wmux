import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  createDefaultNotebook,
  isValidNotebookId,
  loadNotebook,
  resolveNotebookPath,
  saveNotebook
} from "./notebookStore";

describe("notebookStore", () => {
  it("validates notebook ids before resolving file paths", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "wmux-notebook-"));

    expect(isValidNotebookId("surface-notebook-1")).toBe(true);
    expect(isValidNotebookId("../escape")).toBe(false);
    expect(isValidNotebookId("nested/path")).toBe(false);
    expect(() => resolveNotebookPath(root, "../escape")).toThrow(/notebookId/);
  });

  it("loads a default markdown document before the file exists", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "wmux-notebook-"));
    const result = await loadNotebook(root, "notebook-a", "Release Notes");

    expect(result.exists).toBe(false);
    expect(result.relativePath).toBe(".wmux/notebooks/notebook-a.md");
    expect(result.content).toBe(createDefaultNotebook("Release Notes"));
  });

  it("saves notebooks under .wmux/notebooks and reads them back", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "wmux-notebook-"));
    const content = "# Demo\n\n```bash\nnpm test\n```\n";

    const saved = await saveNotebook(root, "demo", content);
    expect(saved.relativePath).toBe(".wmux/notebooks/demo.md");
    expect(saved.bytes).toBe(Buffer.byteLength(content, "utf8"));
    await expect(readFile(path.join(root, ".wmux", "notebooks", "demo.md"), "utf8")).resolves.toBe(content);

    await expect(loadNotebook(root, "demo")).resolves.toMatchObject({
      notebookId: "demo",
      content,
      exists: true,
      relativePath: ".wmux/notebooks/demo.md"
    });
  });
});

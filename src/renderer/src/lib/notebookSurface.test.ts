import { describe, expect, it } from "vitest";
import { createNotebookSurface, normalizeNotebookId } from "./notebookSurface";

describe("notebookSurface", () => {
  it("normalizes user supplied notebook ids", () => {
    expect(normalizeNotebookId(" surface-notebook-Run Book/Today ", 7, 1234)).toBe("Run-Book-Today");
    expect(normalizeNotebookId("notes.v1_2026", 7, 1234)).toBe("notes.v1_2026");
  });

  it("falls back when the id is empty or does not start with an ascii letter or digit", () => {
    expect(normalizeNotebookId("", 3, 1234)).toBe("notebook-1234-3");
    expect(normalizeNotebookId("---", 3, 1234)).toBe("notebook-1234-3");
  });

  it("limits notebook ids to 128 characters", () => {
    expect(normalizeNotebookId("a".repeat(160), 1, 1234)).toHaveLength(128);
  });

  it("creates stable notebook surface metadata from the normalized id", () => {
    expect(createNotebookSurface({ number: 4, name: " Runbook ", notebookId: "runbook", now: 1234 })).toEqual({
      id: "surface-notebook-runbook",
      type: "notebook",
      name: "Runbook",
      subtitle: ".wmux/notebooks/runbook.md",
      status: "idle",
      notebookId: "runbook"
    });
  });

  it("uses a numbered default name when no name is provided", () => {
    expect(createNotebookSurface({ number: 5, now: 1234 }).name).toBe("Notebook 5");
  });
});

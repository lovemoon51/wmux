import { describe, expect, it } from "vitest";
import { mergeCompletionItems } from "./merge";
import type { ShellCompletionItem } from "./types";

describe("mergeCompletionItems", () => {
  it("filters by prefix, sorts by kind and removes duplicates", () => {
    const items: ShellCompletionItem[] = [
      { label: "checkout", kind: "subcommand" },
      { label: "checkout", kind: "subcommand" },
      { label: "cherry-pick", kind: "subcommand" },
      { label: "feature", kind: "branch" }
    ];
    expect(mergeCompletionItems(items, "che").map((item) => item.label)).toEqual(["checkout", "cherry-pick"]);
  });
});

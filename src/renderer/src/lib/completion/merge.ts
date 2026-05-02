import type { ShellCompletionItem } from "./types";

const kindRank: Record<ShellCompletionItem["kind"], number> = {
  subcommand: 0,
  flag: 1,
  branch: 2,
  directory: 3,
  file: 4
};

export function mergeCompletionItems(items: ShellCompletionItem[], prefix: string, limit = 8): ShellCompletionItem[] {
  const normalizedPrefix = prefix.toLowerCase();
  const seen = new Set<string>();
  return items
    .filter((item) => !normalizedPrefix || item.label.toLowerCase().startsWith(normalizedPrefix))
    .sort((first, second) => {
      const boost = (second.boost ?? 0) - (first.boost ?? 0);
      if (boost !== 0) {
        return boost;
      }
      const rank = kindRank[first.kind] - kindRank[second.kind];
      if (rank !== 0) {
        return rank;
      }
      return first.label.localeCompare(second.label);
    })
    .filter((item) => {
      const key = `${item.kind}:${item.label}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    })
    .slice(0, limit);
}

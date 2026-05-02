import type { PaletteCommand, PaletteCommandCategory } from "@shared/types";

export type CommandRegistryEntry = PaletteCommand & {
  registeredAt: number;
};

export type PaletteRecentUsage = {
  count: number;
  lastUsedAt: number;
};

export type PaletteRecentUsageStore = Record<string, PaletteRecentUsage>;

export type CommandRegistryListOptions = {
  recentUsage?: PaletteRecentUsageStore;
  limit?: number;
};

const categoryOrder: Record<PaletteCommandCategory, number> = {
  workspace: 10,
  surface: 20,
  project: 30,
  workflow: 40,
  block: 50,
  ai: 60,
  settings: 70
};

const commands = new Map<string, CommandRegistryEntry>();

export function registerCommand(command: PaletteCommand): () => void {
  const entry: CommandRegistryEntry = {
    ...command,
    registeredAt: Date.now()
  };
  commands.set(command.id, entry);

  return () => unregisterCommand(command.id);
}

export function unregisterCommand(id: string): void {
  commands.delete(id);
}

export function clearCommandRegistry(): void {
  commands.clear();
}

export function getRegisteredCommand(id: string): CommandRegistryEntry | undefined {
  return commands.get(id);
}

export function listCommands(query = "", options: CommandRegistryListOptions = {}): CommandRegistryEntry[] {
  return rankCommands([...commands.values()], query, options).slice(0, options.limit ?? Number.POSITIVE_INFINITY);
}

export function rankPaletteCommands(
  candidates: PaletteCommand[],
  query = "",
  options: CommandRegistryListOptions = {}
): PaletteCommand[] {
  return rankCommands(
    candidates.map((command, index) => ({ ...command, registeredAt: index })),
    query,
    options
  );
}

export function rankCommands(
  candidates: CommandRegistryEntry[],
  query = "",
  options: CommandRegistryListOptions = {}
): CommandRegistryEntry[] {
  const normalizedQuery = normalizeQuery(query);
  return candidates
    .map((command) => ({
      command,
      score: scoreCommand(command, normalizedQuery),
      recentScore: scoreRecentUsage(command.id, options.recentUsage)
    }))
    .filter((item) => normalizedQuery.length === 0 || item.score > Number.NEGATIVE_INFINITY)
    .sort((first, second) => {
      if (second.score !== first.score) {
        return second.score - first.score;
      }
      if (second.recentScore !== first.recentScore) {
        return second.recentScore - first.recentScore;
      }
      const categoryDelta = categoryOrder[first.command.category] - categoryOrder[second.command.category];
      if (categoryDelta !== 0) {
        return categoryDelta;
      }
      return first.command.title.localeCompare(second.command.title);
    })
    .map((item) => item.command);
}

export function recordRecentCommandUsage(
  store: PaletteRecentUsageStore,
  id: string,
  now = Date.now(),
  maxItems = 50
): PaletteRecentUsageStore {
  const nextStore: PaletteRecentUsageStore = {
    ...store,
    [id]: {
      count: (store[id]?.count ?? 0) + 1,
      lastUsedAt: now
    }
  };
  const sortedEntries = Object.entries(nextStore).sort((first, second) => {
    const countDelta = second[1].count - first[1].count;
    if (countDelta !== 0) {
      return countDelta;
    }
    return second[1].lastUsedAt - first[1].lastUsedAt;
  });
  return Object.fromEntries(sortedEntries.slice(0, maxItems));
}

function scoreRecentUsage(id: string, store?: PaletteRecentUsageStore): number {
  const usage = store?.[id];
  if (!usage) {
    return 0;
  }
  return usage.count * 100 + Math.min(99, usage.lastUsedAt / 1_000_000_000);
}

function scoreCommand(command: CommandRegistryEntry, normalizedQuery: string): number {
  if (!normalizedQuery) {
    return 0;
  }

  const fields = [command.title, command.subtitle, command.shortcut, command.category, ...(command.keywords ?? [])]
    .filter((value): value is string => Boolean(value))
    .map(normalizeQuery);

  let bestScore = Number.NEGATIVE_INFINITY;
  for (const field of fields) {
    bestScore = Math.max(bestScore, scoreText(field, normalizedQuery));
  }
  return bestScore;
}

function scoreText(text: string, query: string): number {
  if (!text || !query) {
    return Number.NEGATIVE_INFINITY;
  }
  if (text === query) {
    return 1000;
  }
  if (text.startsWith(query)) {
    return 820 - text.length * 0.1;
  }
  const substringIndex = text.indexOf(query);
  if (substringIndex >= 0) {
    return 680 - substringIndex * 2 - text.length * 0.05;
  }

  let queryIndex = 0;
  let firstMatch = -1;
  let lastMatch = -1;
  let adjacencyBonus = 0;
  for (let textIndex = 0; textIndex < text.length && queryIndex < query.length; textIndex += 1) {
    if (text[textIndex] !== query[queryIndex]) {
      continue;
    }
    if (firstMatch < 0) {
      firstMatch = textIndex;
    }
    if (lastMatch === textIndex - 1) {
      adjacencyBonus += 14;
    }
    lastMatch = textIndex;
    queryIndex += 1;
  }

  if (queryIndex < query.length) {
    return Number.NEGATIVE_INFINITY;
  }

  const span = lastMatch - firstMatch + 1;
  const startBonus = firstMatch === 0 ? 90 : 0;
  return 420 + startBonus + adjacencyBonus - span * 3 - firstMatch * 2;
}

function normalizeQuery(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

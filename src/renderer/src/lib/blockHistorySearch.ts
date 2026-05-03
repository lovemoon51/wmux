import type { Block } from "@shared/types";

export type BlockHistoryRecord = Block & {
  workspaceName?: string;
  surfaceName?: string;
};

type NumberOperator = "=" | "!=" | "<" | "<=" | ">" | ">=";
type AgeOperator = "<" | "<=" | ">" | ">=";

export type BlockHistoryFilter =
  | { field: "exit"; operator: NumberOperator; value: number }
  | { field: "cwd" | "shell"; value: string }
  | { field: "age"; operator: AgeOperator; valueMs: number };

export type BlockHistoryQuery = {
  text: string;
  filters: BlockHistoryFilter[];
  errors: string[];
};

export type SearchBlockHistoryOptions = {
  includeOutput?: boolean;
  now?: number;
  limit?: number;
};

const filterPattern = /^(exit|cwd|shell|age):(.+)$/i;
const exitPattern = /^(<=|>=|!=|=|<|>)?(-?\d+)$/;
const agePattern = /^(<=|>=|<|>)?(\d+)([mhdw])$/i;

export function parseBlockHistoryQuery(rawQuery: string): BlockHistoryQuery {
  const filters: BlockHistoryFilter[] = [];
  const errors: string[] = [];
  const textTerms: string[] = [];

  splitQueryTerms(rawQuery).forEach((term) => {
    const match = term.match(filterPattern);
    if (!match) {
      textTerms.push(term);
      return;
    }

    const field = match[1].toLowerCase();
    const value = match[2].trim();
    if (field === "exit") {
      const exitMatch = value.match(exitPattern);
      if (!exitMatch) {
        errors.push(`exit filter expects a number: ${term}`);
        return;
      }
      filters.push({
        field: "exit",
        operator: (exitMatch[1] || "=") as NumberOperator,
        value: Number(exitMatch[2])
      });
      return;
    }

    if (field === "cwd" || field === "shell") {
      if (!value) {
        errors.push(`${field} filter expects text: ${term}`);
        return;
      }
      filters.push({ field, value: value.toLowerCase() });
      return;
    }

    const ageMatch = value.match(agePattern);
    if (!ageMatch) {
      errors.push(`age filter expects a duration like <7d: ${term}`);
      return;
    }
    filters.push({
      field: "age",
      operator: (ageMatch[1] || "<") as AgeOperator,
      valueMs: Number(ageMatch[2]) * ageUnitMs(ageMatch[3])
    });
  });

  return {
    text: textTerms.join(" ").trim(),
    filters,
    errors
  };
}

export function searchBlockHistory(
  blocks: BlockHistoryRecord[],
  rawQuery: string,
  options: SearchBlockHistoryOptions = {}
): { query: BlockHistoryQuery; results: BlockHistoryRecord[] } {
  const query = parseBlockHistoryQuery(rawQuery);
  const now = options.now ?? Date.now();
  const text = normalizeText(query.text);
  const limit = options.limit ?? 50;

  const results = blocks
    .filter((block) => block.command.trim())
    .filter((block) => query.filters.every((filter) => matchesFilter(block, filter, now)))
    .map((block) => ({
      block,
      score: text ? scoreBlock(block, text, options.includeOutput ?? false) + recencyScore(block, now) : startedAtMs(block)
    }))
    .filter((item) => !text || item.score > Number.NEGATIVE_INFINITY)
    .sort((first, second) => {
      if (second.score !== first.score) {
        return second.score - first.score;
      }
      return startedAtMs(second.block) - startedAtMs(first.block);
    })
    .slice(0, limit)
    .map((item) => item.block);

  return { query, results };
}

function splitQueryTerms(rawQuery: string): string[] {
  return rawQuery.trim().split(/\s+/).filter(Boolean);
}

function matchesFilter(block: BlockHistoryRecord, filter: BlockHistoryFilter, now: number): boolean {
  if (filter.field === "exit") {
    if (typeof block.exitCode !== "number") {
      return false;
    }
    return compareNumber(block.exitCode, filter.operator, filter.value);
  }

  if (filter.field === "cwd") {
    return normalizeText(block.cwd ?? "").includes(filter.value);
  }

  if (filter.field === "shell") {
    return normalizeText(block.shell ?? "").includes(filter.value);
  }

  if (filter.field === "age") {
    const ageMs = Math.max(0, now - startedAtMs(block));
    return compareNumber(ageMs, filter.operator, filter.valueMs);
  }

  return true;
}

function scoreBlock(block: BlockHistoryRecord, text: string, includeOutput: boolean): number {
  const fields = [
    { value: block.command, weight: 1000 },
    { value: block.cwd ?? "", weight: 260 },
    { value: block.shell ?? "", weight: 180 },
    { value: block.workspaceName ?? "", weight: 140 },
    { value: block.surfaceName ?? "", weight: 120 },
    { value: includeOutput ? (block as { outputExcerpt?: string }).outputExcerpt ?? "" : "", weight: 80 }
  ];

  return fields.reduce((bestScore, field) => Math.max(bestScore, scoreText(normalizeText(field.value), text) + field.weight), Number.NEGATIVE_INFINITY);
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

function compareNumber(left: number, operator: NumberOperator | AgeOperator, right: number): boolean {
  switch (operator) {
    case "!=":
      return left !== right;
    case "<":
      return left < right;
    case "<=":
      return left <= right;
    case ">":
      return left > right;
    case ">=":
      return left >= right;
    case "=":
    default:
      return left === right;
  }
}

function ageUnitMs(unit: string): number {
  switch (unit.toLowerCase()) {
    case "m":
      return 60 * 1000;
    case "h":
      return 60 * 60 * 1000;
    case "d":
      return 24 * 60 * 60 * 1000;
    case "w":
      return 7 * 24 * 60 * 60 * 1000;
    default:
      return 1;
  }
}

function startedAtMs(block: BlockHistoryRecord): number {
  const parsed = Date.parse(block.endedAt ?? block.startedAt);
  return Number.isFinite(parsed) ? parsed : 0;
}

function recencyScore(block: BlockHistoryRecord, now: number): number {
  const ageMs = Math.max(0, now - startedAtMs(block));
  return Math.max(0, 240 - ageMs / (60 * 60 * 1000));
}

function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

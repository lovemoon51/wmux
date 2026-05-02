// 终端 scrollback 跨重启持久化：序列化/反序列化纯函数
// 关键约束：
// - 单 entry 与总字节都设上限，避免无限增长占用磁盘
// - 截断时按换行对齐，避免半截 ANSI 序列污染
// - 反序列化对损坏文件静默降级到空 Map，不让坏盘卡 app 启动
// - 文件格式带 version，便于以后 schema 升级

import type { Block } from "../../shared/types";

export const persistedScrollbackMaxPerEntry = 64 * 1024;
export const persistedScrollbackMaxTotalBytes = 2 * 1024 * 1024;
export const persistedScrollbackFileVersion = 2;
export const persistedBlocksMaxPerEntry = 500;

type PersistedScrollbackPayload = {
  version: number;
  entries: Record<string, string>;
  blocks?: Record<string, Block[]>;
};

export type SerializeOutputBuffersOptions = {
  maxPerEntry?: number;
  maxTotal?: number;
  blocks?: Map<string, Block[]>;
  maxBlocksPerEntry?: number;
};

function tailWithNewlineAlign(value: string, maxBytes: number): string {
  if (value.length <= maxBytes) {
    return value;
  }
  const sliced = value.slice(-maxBytes);
  const newlineIdx = sliced.indexOf("\n");
  return newlineIdx >= 0 ? sliced.slice(newlineIdx + 1) : sliced;
}

export function serializeOutputBuffers(
  state: Map<string, string>,
  options: SerializeOutputBuffersOptions = {}
): string {
  const maxPer = options.maxPerEntry ?? persistedScrollbackMaxPerEntry;
  const maxTotal = options.maxTotal ?? persistedScrollbackMaxTotalBytes;
  const maxBlocks = options.maxBlocksPerEntry ?? persistedBlocksMaxPerEntry;
  const entries: Record<string, string> = {};
  const blocks: Record<string, Block[]> = {};
  let total = 0;

  for (const [id, value] of state) {
    if (!value) {
      continue;
    }
    const trimmed = tailWithNewlineAlign(value, maxPer);
    if (!trimmed) {
      continue;
    }
    if (total + trimmed.length > maxTotal) {
      // 总量到顶：丢弃后续 entry，先到先得
      break;
    }
    entries[id] = trimmed;
    total += trimmed.length;
  }

  for (const [id, value] of options.blocks ?? []) {
    const trimmedBlocks = value.slice(-maxBlocks);
    if (trimmedBlocks.length > 0) {
      blocks[id] = trimmedBlocks;
    }
  }

  const payload: PersistedScrollbackPayload = {
    version: persistedScrollbackFileVersion,
    entries,
    blocks
  };
  return JSON.stringify(payload);
}

export function deserializeOutputBuffers(raw: string): Map<string, string> {
  const result = new Map<string, string>();
  if (!raw) {
    return result;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return result;
  }
  if (!parsed || typeof parsed !== "object") {
    return result;
  }
  const typed = parsed as Partial<PersistedScrollbackPayload>;
  if (typed.version !== persistedScrollbackFileVersion && typed.version !== 1) {
    // 不识别的版本：直接弃用，避免 schema 不兼容时崩溃
    return result;
  }
  const entries = typed.entries;
  if (!entries || typeof entries !== "object") {
    return result;
  }
  for (const [id, value] of Object.entries(entries)) {
    if (typeof id === "string" && typeof value === "string" && value.length > 0) {
      result.set(id, value);
    }
  }
  return result;
}

export function deserializePersistedBlocks(raw: string): Map<string, Block[]> {
  const result = new Map<string, Block[]>();
  if (!raw) {
    return result;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return result;
  }
  if (!parsed || typeof parsed !== "object") {
    return result;
  }
  const typed = parsed as Partial<PersistedScrollbackPayload>;
  if (typed.version !== persistedScrollbackFileVersion || !typed.blocks || typeof typed.blocks !== "object") {
    return result;
  }
  for (const [id, blocks] of Object.entries(typed.blocks)) {
    if (typeof id === "string" && Array.isArray(blocks)) {
      const parsedBlocks = blocks.filter(isPersistedBlock);
      if (parsedBlocks.length > 0) {
        result.set(id, parsedBlocks);
      }
    }
  }
  return result;
}

function isPersistedBlock(value: unknown): value is Block {
  if (!value || typeof value !== "object") {
    return false;
  }
  const block = value as Partial<Block>;
  return (
    typeof block.id === "string" &&
    typeof block.surfaceId === "string" &&
    typeof block.workspaceId === "string" &&
    typeof block.startLine === "number" &&
    typeof block.command === "string" &&
    typeof block.startedAt === "string" &&
    (block.status === "running" || block.status === "success" || block.status === "error" || block.status === "aborted")
  );
}

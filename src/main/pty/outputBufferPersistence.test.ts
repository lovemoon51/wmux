import { describe, expect, it } from "vitest";
import {
  deserializePersistedBlocks,
  deserializeOutputBuffers,
  persistedScrollbackFileVersion,
  persistedScrollbackMaxPerEntry,
  serializeOutputBuffers
} from "./outputBufferPersistence";

describe("serializeOutputBuffers", () => {
  it("空 Map 序列化为合法 JSON 含空 entries", () => {
    const json = serializeOutputBuffers(new Map());
    expect(JSON.parse(json)).toEqual({
      version: persistedScrollbackFileVersion,
      entries: {},
      blocks: {}
    });
  });

  it("常规小 buffer 原样保留", () => {
    const state = new Map([
      ["a", "hello"],
      ["b", "world\n"]
    ]);
    const json = serializeOutputBuffers(state);
    const parsed = JSON.parse(json) as { entries: Record<string, string> };
    expect(parsed.entries).toEqual({ a: "hello", b: "world\n" });
  });

  it("跳过空字符串 entry", () => {
    const state = new Map([
      ["a", ""],
      ["b", "kept"]
    ]);
    const parsed = JSON.parse(serializeOutputBuffers(state)) as { entries: Record<string, string> };
    expect(parsed.entries).toEqual({ b: "kept" });
  });

  it("超过 per-entry 上限时按尾部 maxPerEntry 切片，并对齐到换行", () => {
    const head = "x".repeat(persistedScrollbackMaxPerEntry + 500);
    const state = new Map([["a", `${head}\nKEEP`]]);
    const parsed = JSON.parse(serializeOutputBuffers(state)) as { entries: Record<string, string> };
    expect(parsed.entries.a.length).toBeLessThanOrEqual(persistedScrollbackMaxPerEntry);
    expect(parsed.entries.a.endsWith("KEEP")).toBe(true);
    expect(parsed.entries.a.startsWith("x")).toBe(false);
  });

  it("总量到顶时跳过剩余 entry（先到先得）", () => {
    const state = new Map([
      ["a", "x".repeat(120)],
      ["b", "y".repeat(120)],
      ["c", "z".repeat(120)]
    ]);
    const json = serializeOutputBuffers(state, { maxPerEntry: 100, maxTotal: 200 });
    const parsed = JSON.parse(json) as { entries: Record<string, string> };
    // a 占 100，b 占 100 后总量 200，c 会被跳过
    expect(Object.keys(parsed.entries)).toEqual(["a", "b"]);
  });

  it("自定义 maxPerEntry 同样生效", () => {
    const state = new Map([["a", "1234567890\nABCDEFG"]]);
    const json = serializeOutputBuffers(state, { maxPerEntry: 8 });
    const parsed = JSON.parse(json) as { entries: Record<string, string> };
    // 截断 8 字节再 align 到换行：尾部 8 字节为 "BCDEFG"（含 ABCDEFG 头部）
    expect(parsed.entries.a.length).toBeLessThanOrEqual(8);
  });
});

describe("deserializeOutputBuffers", () => {
  it("空字符串 → 空 Map", () => {
    expect(deserializeOutputBuffers("")).toEqual(new Map());
  });

  it("非 JSON → 空 Map（不抛异常）", () => {
    expect(deserializeOutputBuffers("not json")).toEqual(new Map());
  });

  it("缺 version → 空 Map", () => {
    const raw = JSON.stringify({ entries: { a: "x" } });
    expect(deserializeOutputBuffers(raw)).toEqual(new Map());
  });

  it("不匹配 version → 空 Map（schema 兼容防御）", () => {
    const raw = JSON.stringify({ version: 999, entries: { a: "x" } });
    expect(deserializeOutputBuffers(raw)).toEqual(new Map());
  });

  it("缺 entries 字段 → 空 Map", () => {
    const raw = JSON.stringify({ version: persistedScrollbackFileVersion });
    expect(deserializeOutputBuffers(raw)).toEqual(new Map());
  });

  it("entries 字段含非字符串值时跳过", () => {
    const raw = JSON.stringify({
      version: persistedScrollbackFileVersion,
      entries: { a: "ok", b: 42, c: null, d: "" }
    });
    const map = deserializeOutputBuffers(raw);
    expect(map.size).toBe(1);
    expect(map.get("a")).toBe("ok");
  });

  it("正常往返：serialize → deserialize 等价", () => {
    const original = new Map([
      ["surface-1", "hello\nworld"],
      ["surface-2", "another buffer"]
    ]);
    const json = serializeOutputBuffers(original);
    const restored = deserializeOutputBuffers(json);
    expect(restored).toEqual(original);
  });

  it("兼容 v1 scrollback payload", () => {
    const raw = JSON.stringify({ version: 1, entries: { a: "legacy" } });
    expect(deserializeOutputBuffers(raw)).toEqual(new Map([["a", "legacy"]]));
  });
});

describe("deserializePersistedBlocks", () => {
  it("从 v2 payload 恢复 block 元数据", () => {
    const json = serializeOutputBuffers(new Map(), {
      blocks: new Map([
        [
          "session-1",
          [
            {
              id: "block-1",
              surfaceId: "surface-1",
              workspaceId: "workspace-1",
              startLine: 1,
              command: "npm test",
              startedAt: "2026-05-03T00:00:00.000Z",
              status: "success"
            }
          ]
        ]
      ])
    });

    expect(deserializePersistedBlocks(json).get("session-1")?.[0]?.command).toBe("npm test");
  });

  it("v1 payload 没有 blocks 时返回空 Map", () => {
    expect(deserializePersistedBlocks(JSON.stringify({ version: 1, entries: { a: "x" } }))).toEqual(new Map());
  });
});

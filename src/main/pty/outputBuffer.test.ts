import { describe, expect, it } from "vitest";
import {
  appendToOutputBuffer,
  outputBufferMaxBytes,
  outputBufferTrimBytes
} from "./outputBuffer";

describe("appendToOutputBuffer", () => {
  it("空 chunk 不修改 state", () => {
    const state = new Map<string, string>();
    appendToOutputBuffer(state, "s1", "");
    expect(state.has("s1")).toBe(false);
  });

  it("首次写入：state 置位 chunk", () => {
    const state = new Map<string, string>();
    appendToOutputBuffer(state, "s1", "hello");
    expect(state.get("s1")).toBe("hello");
  });

  it("累积写入：拼接到既有 buffer", () => {
    const state = new Map<string, string>([["s1", "abc"]]);
    appendToOutputBuffer(state, "s1", "def");
    expect(state.get("s1")).toBe("abcdef");
  });

  it("不同 id 各自独立", () => {
    const state = new Map<string, string>();
    appendToOutputBuffer(state, "a", "alpha");
    appendToOutputBuffer(state, "b", "beta");
    expect(state.get("a")).toBe("alpha");
    expect(state.get("b")).toBe("beta");
  });

  it("低于阈值时不截断（边界 = max）", () => {
    const state = new Map<string, string>();
    const exactly = "x".repeat(outputBufferMaxBytes);
    appendToOutputBuffer(state, "s1", exactly);
    expect(state.get("s1")?.length).toBe(outputBufferMaxBytes);
  });

  it("超阈值时按尾部 trim 大小切片，并对齐到下一个换行", () => {
    const state = new Map<string, string>();
    // 构造：head 长 200KB，尾随 "\nTAIL"，总长超过 max
    const headSize = outputBufferMaxBytes + 1024;
    const head = "x".repeat(headSize);
    appendToOutputBuffer(state, "s1", `${head}\nTAIL`);
    const buf = state.get("s1") ?? "";
    // 切片尾部 trim 大小，再去掉首个不完整行 → 余下应以 "TAIL" 结尾
    expect(buf.length).toBeLessThanOrEqual(outputBufferTrimBytes);
    expect(buf.endsWith("TAIL")).toBe(true);
    // 由于切片后第一个 \n 是头部尾随的换行，截断后首字符应为下一行起始
    expect(buf.startsWith("x")).toBe(false);
  });

  it("超阈值且无换行：保留尾部 trim 大小（不再二次截断）", () => {
    const state = new Map<string, string>();
    const noNewline = "y".repeat(outputBufferMaxBytes + 5_000);
    appendToOutputBuffer(state, "s1", noNewline);
    const buf = state.get("s1") ?? "";
    expect(buf.length).toBe(outputBufferTrimBytes);
    expect(buf).toBe("y".repeat(outputBufferTrimBytes));
  });

  it("多次累积超阈值后再次累积：每次都按规则收敛", () => {
    const state = new Map<string, string>();
    // 第一次写入触发截断
    appendToOutputBuffer(state, "s1", "z".repeat(outputBufferMaxBytes + 100) + "\nfirst");
    const afterFirst = (state.get("s1") ?? "").length;
    expect(afterFirst).toBeLessThanOrEqual(outputBufferTrimBytes);
    // 再追加大块再次触发
    appendToOutputBuffer(state, "s1", "z".repeat(outputBufferMaxBytes) + "\nsecond");
    const buf = state.get("s1") ?? "";
    expect(buf.length).toBeLessThanOrEqual(outputBufferTrimBytes);
    expect(buf.endsWith("second")).toBe(true);
  });
});

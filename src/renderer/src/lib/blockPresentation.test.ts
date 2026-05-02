import { describe, expect, it } from "vitest";
import { formatBlockDuration, getBlockStatusClass, getBlockStatusLabel } from "./blockPresentation";

describe("formatBlockDuration", () => {
  it("毫秒级显示 ms", () => {
    expect(formatBlockDuration(42)).toBe("42ms");
  });

  it("秒级显示 s", () => {
    expect(formatBlockDuration(1530)).toBe("1.5s");
    expect(formatBlockDuration(12_000)).toBe("12s");
  });

  it("分钟级显示 mm:ss", () => {
    expect(formatBlockDuration(65_000)).toBe("1:05");
  });
});

describe("block status presentation", () => {
  it("状态 class 映射稳定", () => {
    expect(getBlockStatusClass("running")).toBe("blockStatusRunning");
    expect(getBlockStatusClass("success")).toBe("blockStatusSuccess");
    expect(getBlockStatusClass("error")).toBe("blockStatusError");
    expect(getBlockStatusClass("aborted")).toBe("blockStatusAborted");
  });

  it("退出码 label 显示", () => {
    expect(getBlockStatusLabel("success", 0)).toBe("exit 0");
    expect(getBlockStatusLabel("error", 2)).toBe("exit 2");
    expect(getBlockStatusLabel("running")).toBe("running");
  });
});

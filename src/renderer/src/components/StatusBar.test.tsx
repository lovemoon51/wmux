import { describe, expect, it } from "vitest";
import { compactCwd } from "./StatusBar";

describe("StatusBar", () => {
  it("压缩 Windows 路径时保留盘符和末两级目录", () => {
    expect(compactCwd("D:\\IdeaProject\\codex\\wmux")).toBe("D:/.../codex/wmux");
  });

  it("短路径保持原样", () => {
    expect(compactCwd("/repo")).toBe("/repo");
    expect(compactCwd("wmux/docs")).toBe("wmux/docs");
  });
});

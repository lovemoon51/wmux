import { describe, expect, it } from "vitest";
import { detectTerminalAttentionPrompt, __testing } from "./terminalAttention";

describe("detectTerminalAttentionPrompt", () => {
  it("空字符串 → undefined", () => {
    expect(detectTerminalAttentionPrompt("")).toBeUndefined();
  });

  it("无 marker 文本 → undefined", () => {
    expect(detectTerminalAttentionPrompt("hello world")).toBeUndefined();
  });

  it("匹配命令审批 marker", () => {
    const output = "Some context...\nWould you like to run the following command?\nls -la";
    const result = detectTerminalAttentionPrompt(output);
    expect(result?.message).toBe("Agent is waiting for command approval");
  });

  it("匹配回车确认 marker", () => {
    const output = "Press Enter to confirm or Esc to cancel";
    const result = detectTerminalAttentionPrompt(output);
    expect(result?.message).toBe("Agent is waiting for confirmation");
  });

  it("大小写不敏感", () => {
    const upperOutput = "WOULD YOU LIKE TO RUN THE FOLLOWING COMMAND?";
    expect(detectTerminalAttentionPrompt(upperOutput)?.message).toBe(
      "Agent is waiting for command approval"
    );
    const mixedOutput = "press ENTER to CONFIRM or esc to cancel";
    expect(detectTerminalAttentionPrompt(mixedOutput)?.message).toBe(
      "Agent is waiting for confirmation"
    );
  });

  it("剥离 ANSI CSI 序列后再匹配", () => {
    // 红色文本包裹的 marker：\x1b[31m...\x1b[0m
    const output = "\x1b[31mWould you like to run the following command?\x1b[0m";
    const result = detectTerminalAttentionPrompt(output);
    expect(result?.message).toBe("Agent is waiting for command approval");
  });

  it("剥离 ANSI OSC 序列（标题设置等）后再匹配", () => {
    // OSC 0 set-title 不应阻止匹配
    const output = "\x1b]0;tab title\x07Press enter to confirm or esc to cancel";
    const result = detectTerminalAttentionPrompt(output);
    expect(result?.message).toBe("Agent is waiting for confirmation");
  });

  it("\\r 折成 \\n 后再匹配（Windows 风格回车）", () => {
    // marker 跨 \r 拼接
    const output = "Press enter to\rconfirm or esc to cancel";
    // 经过 \r→\n 后实际是 "Press enter to\nconfirm or esc to cancel"
    // marker 是 "press enter to confirm or esc to cancel"（无 \n）
    // 所以这条不命中——验证 \r 替换不会误把跨行变同行
    expect(detectTerminalAttentionPrompt(output)).toBeUndefined();
  });

  it("第一个匹配的 prompt 优先（按 prompts 数组顺序）", () => {
    // 同时含两个 marker 的情况下：先放命令审批 marker
    const output =
      "Would you like to run the following command?\n" +
      "Press enter to confirm or esc to cancel";
    const result = detectTerminalAttentionPrompt(output);
    expect(result?.message).toBe("Agent is waiting for command approval");
  });

  it("__testing 暴露内部 prompts 供测试访问，且 prompts 至少 2 条", () => {
    expect(__testing.terminalAttentionPrompts.length).toBeGreaterThanOrEqual(2);
    for (const prompt of __testing.terminalAttentionPrompts) {
      expect(prompt.marker).toMatch(/^[a-z 0-9?\\.,-]+$/);
      expect(prompt.message.length).toBeGreaterThan(0);
    }
  });
});

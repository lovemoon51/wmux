import { describe, expect, it } from "vitest";
import { createBlockParserState, parseTerminalBlocks } from "./blockParser";

const osc = (payload: string): string => `\x1b]${payload}\x07`;

describe("parseTerminalBlocks", () => {
  it("提取 OSC 133 块并从输出中剥离控制序列", () => {
    const state = createBlockParserState();
    const result = parseTerminalBlocks(state, {
      sessionId: "surface-a:auto",
      surfaceId: "surface-a",
      workspaceId: "workspace-a",
      shell: "bash",
      cwd: "/repo",
      startLine: 12,
      now: new Date("2026-05-03T00:00:00.000Z"),
      data: `${osc("133;A")}prompt$ ${osc("133;B")}npm test\r\n${osc("133;C")}ok\n${osc("133;D;0")}`
    });

    expect(result.cleaned).toBe("prompt$ npm test\r\nok\n");
    expect(result.events.map((event) => event.type)).toEqual([
      "block:start",
      "block:command",
      "block:output",
      "block:end"
    ]);
    expect(result.events[0]).toMatchObject({
      type: "block:start",
      surfaceId: "surface-a",
      block: {
        command: "",
        cwd: "/repo",
        shell: "bash",
        startLine: 12,
        status: "running"
      }
    });
    expect(result.events[1]).toMatchObject({
      type: "block:command",
      command: "npm test"
    });
    expect(result.events[3]).toMatchObject({
      type: "block:end",
      exitCode: 0
    });
  });

  it("跨 chunk OSC 仍能解析", () => {
    const state = createBlockParserState();
    const first = parseTerminalBlocks(state, {
      sessionId: "s",
      surfaceId: "surface",
      startLine: 0,
      data: "\x1b]133"
    });
    const second = parseTerminalBlocks(state, {
      sessionId: "s",
      surfaceId: "surface",
      startLine: 0,
      data: ";A\x07$ "
    });

    expect(first.cleaned).toBe("");
    expect(first.events).toEqual([]);
    expect(second.cleaned).toBe("$ ");
    expect(second.events[0]?.type).toBe("block:start");
  });

  it("非 OSC 133 序列原样保留", () => {
    const state = createBlockParserState();
    const result = parseTerminalBlocks(state, {
      sessionId: "s",
      surfaceId: "surface",
      startLine: 0,
      data: "\x1b]0;title\x07hello"
    });

    expect(result.cleaned).toBe("\x1b]0;title\x07hello");
    expect(result.events).toEqual([]);
  });

  it("非零退出码标记为 error", () => {
    const state = createBlockParserState();
    const result = parseTerminalBlocks(state, {
      sessionId: "s",
      surfaceId: "surface",
      startLine: 0,
      data: `${osc("133;A")}${osc("133;B")}false${osc("133;C")}boom${osc("133;D;1")}`
    });

    expect(result.events[result.events.length - 1]).toMatchObject({ type: "block:end", exitCode: 1 });
    expect(state.currentBlock).toBeUndefined();
  });
});

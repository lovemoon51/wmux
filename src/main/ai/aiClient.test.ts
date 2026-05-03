import { describe, expect, it } from "vitest";
import { buildChatCompletionsUrl, consumeSseBuffer, extractCommandSuggestions } from "./aiClient";

describe("aiClient", () => {
  it("补全 OpenAI 兼容 chat completions 地址", () => {
    expect(buildChatCompletionsUrl("https://api.example.com/v1/")).toBe("https://api.example.com/v1/chat/completions");
    expect(buildChatCompletionsUrl("https://api.example.com/v1/chat/completions")).toBe(
      "https://api.example.com/v1/chat/completions"
    );
  });

  it("解析流式 SSE token 并保留未完整帧", () => {
    const frame =
      'data: {"choices":[{"delta":{"content":"hello"}}]}\n\n' +
      'data: {"choices":[{"delta":{"content":" world"}}]}\n\n' +
      "data: [DONE]\n\n" +
      'data: {"choices"';
    const result = consumeSseBuffer(frame);

    expect(result.events).toEqual([{ token: "hello" }, { token: " world" }, { done: true }]);
    expect(result.remaining).toBe('data: {"choices"');
  });

  it("从模型文本中提取 1-3 条命令建议", () => {
    expect(extractCommandSuggestions("1. `npm test`\n2. git status\n# note\n3. npm run build\n4. npm lint")).toEqual([
      "npm test",
      "git status",
      "npm run build"
    ]);
  });
});

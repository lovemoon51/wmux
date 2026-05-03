import { describe, expect, it } from "vitest";
import { redactSecrets } from "./redaction";

describe("redactSecrets", () => {
  it("脱敏常见 token 和密钥前缀", () => {
    const raw = [
      "openai=sk-1234567890abcdefghijkl",
      "github=ghp_1234567890abcdefghijkl",
      "aws=AKIA1234567890ABCDEF",
      "token=super-secret-token-value"
    ].join("\n");

    expect(redactSecrets(raw)).toBe(["openai=<redacted>", "github=<redacted>", "aws=<redacted>", "<redacted>"].join("\n"));
  });

  it("保留普通输出文本", () => {
    expect(redactSecrets("npm ERR missing script: build")).toBe("npm ERR missing script: build");
  });
});

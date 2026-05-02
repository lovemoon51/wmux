import { describe, expect, it } from "vitest";
import { analyzeShellSyntax, isShellInputStructurallyOpen, tokenizeShellInput } from "./shellTokenizer";

describe("shellTokenizer", () => {
  it("classifies command words, flags, variables and comments", () => {
    const tokens = tokenizeShellInput("git checkout -b $BRANCH # create branch");
    expect(tokens.map((token) => token.kind)).toEqual([
      "command",
      "whitespace",
      "argument",
      "whitespace",
      "flag",
      "whitespace",
      "variable",
      "whitespace",
      "comment"
    ]);
  });

  it("tracks open quotes and escaped quotes", () => {
    expect(analyzeShellSyntax("echo 'abc").quote).toBe("single");
    expect(isShellInputStructurallyOpen(analyzeShellSyntax("echo 'abc"))).toBe(true);
    expect(isShellInputStructurallyOpen(analyzeShellSyntax('echo \\"x\\"'))).toBe(false);
  });

  it("tracks bracket depths and trailing continuations", () => {
    const state = analyzeShellSyntax("echo $(node -e \"console.log(1)\"");
    expect(state.parenDepth).toBe(1);
    expect(isShellInputStructurallyOpen(state)).toBe(true);

    const continuation = analyzeShellSyntax("echo hello \\");
    expect(continuation.hasTrailingContinuation).toBe(true);
  });

  it("does not treat hash inside quotes as a comment", () => {
    const tokens = tokenizeShellInput('echo "# not comment" # comment');
    expect(tokens.filter((token) => token.kind === "comment")).toHaveLength(1);
    expect(tokens.find((token) => token.kind === "string")?.value).toBe('"# not comment"');
  });
});

import { describe, expect, it } from "vitest";
import {
  createWorkflowArgDefaults,
  extractWorkflowPlaceholders,
  renderWorkflowCommand,
  validateWorkflowArgs
} from "./workflowTemplate";

describe("workflowTemplate", () => {
  it("提取去重后的模板变量", () => {
    expect(extractWorkflowPlaceholders("git rebase {{ base }} {{branch}} {{base}}")).toEqual(["base", "branch"]);
  });

  it("使用默认值和枚举首项初始化参数", () => {
    expect(
      createWorkflowArgDefaults([
        { name: "base", default: "main" },
        { name: "mode", enum: ["--continue", "--abort"] }
      ])
    ).toEqual({ base: "main", mode: "--continue" });
  });

  it("校验必填项、枚举值和未定义模板变量", () => {
    const result = validateWorkflowArgs(
      [
        { name: "base", required: true },
        { name: "mode", enum: ["soft", "hard"] }
      ],
      { base: "", mode: "mixed" },
      "git reset --{{mode}} {{target}}"
    );

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual({
      base: "必填",
      mode: "不在候选项中",
      target: "模板变量未定义"
    });
  });

  it("渲染模板但不附加换行", () => {
    expect(renderWorkflowCommand("git rebase {{base}} {{ branch }}", { base: "main", branch: "feature/a" })).toBe(
      "git rebase main feature/a"
    );
  });
});

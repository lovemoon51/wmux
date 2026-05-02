import { describe, expect, it } from "vitest";
import { parseWorkflowYaml } from "./workflowYamlLoader";

describe("workflowYamlLoader", () => {
  it("解析 Warp workflow YAML 为 wmux 参数化命令", () => {
    const result = parseWorkflowYaml(
      `
name: Git Rebase
command: git rebase {{base}} {{branch}}
tags:
  - git
  - history
description: Prepare a rebase command
arguments:
  - name: base
    description: Base branch
    default_value: main
  - name: branch
    description: Topic branch
`,
      "D:/repo/.warp/workflows/git-rebase.yaml"
    );

    expect(result.errors).toEqual([]);
    expect(result.commands).toEqual([
      {
        name: "Git Rebase",
        description: "Prepare a rebase command",
        keywords: ["git", "history"],
        commandTemplate: "git rebase {{base}} {{branch}}",
        args: [
          {
            name: "base",
            description: "Base branch",
            default: "main",
            required: false
          },
          {
            name: "branch",
            description: "Topic branch",
            required: true
          }
        ],
        source: "workflow",
        sourcePath: "D:/repo/.warp/workflows/git-rebase.yaml"
      }
    ]);
  });

  it("支持 commands 数组并收集非法条目错误", () => {
    const result = parseWorkflowYaml(
      `
commands:
  - name: Deploy
    command: npm run deploy -- --env {{env}}
    args:
      - name: env
        enum: [staging, production]
  - command: missing name
`,
      "D:/repo/.warp/workflows/deploy.yaml"
    );

    expect(result.commands).toHaveLength(1);
    expect(result.commands[0].args?.[0]).toEqual({
      name: "env",
      required: true,
      enum: ["staging", "production"]
    });
    expect(result.errors).toEqual(["workflows[1].name 必须是非空字符串"]);
  });
});

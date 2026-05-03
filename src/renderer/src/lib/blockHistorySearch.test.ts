import { describe, expect, it } from "vitest";
import { parseBlockHistoryQuery, searchBlockHistory, type BlockHistoryRecord } from "./blockHistorySearch";

const now = Date.parse("2026-05-03T12:00:00.000Z");

function block(partial: Partial<BlockHistoryRecord>): BlockHistoryRecord {
  return {
    id: partial.id ?? "block-1",
    surfaceId: partial.surfaceId ?? "surface-1",
    workspaceId: partial.workspaceId ?? "workspace-1",
    startLine: 1,
    command: partial.command ?? "npm test",
    cwd: partial.cwd ?? "D:/repo",
    shell: partial.shell ?? "pwsh",
    startedAt: partial.startedAt ?? "2026-05-03T11:00:00.000Z",
    endedAt: partial.endedAt,
    exitCode: partial.exitCode,
    status: partial.status ?? "success",
    workspaceName: partial.workspaceName,
    surfaceName: partial.surfaceName
  };
}

describe("blockHistorySearch", () => {
  it("解析文本与高级过滤器", () => {
    expect(parseBlockHistoryQuery("test exit:!=0 cwd:src shell:pwsh age:<7d")).toEqual({
      text: "test",
      filters: [
        { field: "exit", operator: "!=", value: 0 },
        { field: "cwd", value: "src" },
        { field: "shell", value: "pwsh" },
        { field: "age", operator: "<", valueMs: 7 * 24 * 60 * 60 * 1000 }
      ],
      errors: []
    });
  });

  it("报告非法过滤器但保留普通文本", () => {
    expect(parseBlockHistoryQuery("build exit:abc age:soon").errors).toEqual([
      "exit filter expects a number: exit:abc",
      "age filter expects a duration like <7d: age:soon"
    ]);
  });

  it("按命令文本模糊匹配并最近优先", () => {
    const results = searchBlockHistory(
      [
        block({ id: "old", command: "npm run build", startedAt: "2026-05-01T12:00:00.000Z" }),
        block({ id: "new", command: "npm run build:app", startedAt: "2026-05-03T11:59:00.000Z" }),
        block({ id: "miss", command: "git status", startedAt: "2026-05-03T11:58:00.000Z" })
      ],
      "build",
      { now }
    ).results;

    expect(results.map((item) => item.id)).toEqual(["new", "old"]);
  });

  it("应用 exit/cwd/shell/age 过滤器", () => {
    const results = searchBlockHistory(
      [
        block({ id: "match", command: "npm test", cwd: "D:/repo/src", shell: "pwsh", exitCode: 1, startedAt: "2026-05-03T11:00:00.000Z" }),
        block({ id: "exit0", command: "npm test", cwd: "D:/repo/src", shell: "pwsh", exitCode: 0, startedAt: "2026-05-03T11:00:00.000Z" }),
        block({ id: "old", command: "npm test", cwd: "D:/repo/src", shell: "pwsh", exitCode: 1, startedAt: "2026-04-01T11:00:00.000Z" })
      ],
      "exit:!=0 cwd:src shell:pwsh age:<7d",
      { now }
    ).results;

    expect(results.map((item) => item.id)).toEqual(["match"]);
  });
});

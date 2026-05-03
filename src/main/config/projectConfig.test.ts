import { describe, expect, it } from "vitest";
import { parseLayoutConfig, parseProjectConfig, parseSurfaceConfig } from "./projectConfig";

const source = { kind: "project" as const, path: "D:/repo/wmux.json" };

describe("projectConfig", () => {
  it("解析 notebook surface 配置", () => {
    const errors: string[] = [];

    expect(
      parseSurfaceConfig(
        {
          type: "notebook",
          name: "Runbook",
          notebookId: "dev-runbook",
          focus: true
        },
        errors,
        "commands[0].workspace.layout.pane.surfaces[0]"
      )
    ).toEqual({
      type: "notebook",
      name: "Runbook",
      notebookId: "dev-runbook",
      focus: true
    });
    expect(errors).toEqual([]);
  });

  it("解析包含 notebook surface 的 workspace layout", () => {
    const result = parseProjectConfig(
      {
        commands: [
          {
            name: "Open Runbook",
            workspace: {
              name: "Docs",
              layout: {
                pane: {
                  surfaces: [
                    {
                      type: "notebook",
                      name: "Runbook",
                      notebookId: "runbook"
                    }
                  ]
                }
              }
            }
          }
        ]
      },
      source
    );

    expect(result.errors).toEqual([]);
    expect(result.config.commands[0]).toMatchObject({
      name: "Open Runbook",
      source: "project",
      sourcePath: "D:/repo/wmux.json",
      workspace: {
        name: "Docs",
        layout: {
          pane: {
            surfaces: [
              {
                type: "notebook",
                name: "Runbook",
                notebookId: "runbook"
              }
            ]
          }
        }
      }
    });
  });

  it("保留非法 surface type 的错误上下文", () => {
    const errors: string[] = [];

    expect(parseLayoutConfig({ pane: { surfaces: [{ type: "unknown" }] } }, errors, "workspace.layout")).toBeNull();
    expect(errors).toEqual([
      "workspace.layout.pane.surfaces[0] 的 type 必须是 terminal、browser 或 notebook",
      "workspace.layout.pane 至少需要一个 surface"
    ]);
  });
});

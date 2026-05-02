import { describe, expect, it, beforeEach } from "vitest";
import {
  clearCommandRegistry,
  listCommands,
  recordRecentCommandUsage,
  registerCommand
} from "./commandRegistry";
import type { PaletteCommand } from "@shared/types";

function command(id: string, title: string, keywords: string[] = []): PaletteCommand {
  return {
    id,
    title,
    keywords,
    category: "surface",
    run: () => undefined
  };
}

describe("commandRegistry", () => {
  beforeEach(() => {
    clearCommandRegistry();
  });

  it("注册和注销命令", () => {
    const unregister = registerCommand(command("terminal.new", "New terminal"));
    expect(listCommands("").map((item) => item.id)).toEqual(["terminal.new"]);

    unregister();
    expect(listCommands("")).toEqual([]);
  });

  it("模糊匹配优先 exact / prefix / substring", () => {
    registerCommand(command("workspace.api", "API Server"));
    registerCommand(command("surface.browser", "New browser"));
    registerCommand(command("project.build", "Run build"));

    expect(listCommands("new").map((item) => item.id)).toEqual(["surface.browser"]);
    expect(listCommands("build").map((item) => item.id)).toEqual(["project.build"]);
    expect(listCommands("as").map((item) => item.id)).toContain("workspace.api");
  });

  it("最近使用在空查询下置顶", () => {
    registerCommand(command("a", "Alpha"));
    registerCommand(command("b", "Beta"));
    registerCommand(command("c", "Gamma"));

    let usage = {};
    usage = recordRecentCommandUsage(usage, "b", 1000);
    usage = recordRecentCommandUsage(usage, "b", 2000);
    usage = recordRecentCommandUsage(usage, "b", 3000);

    expect(listCommands("", { recentUsage: usage }).map((item) => item.id)[0]).toBe("b");
  });
});

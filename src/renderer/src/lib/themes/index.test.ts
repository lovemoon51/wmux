import { describe, expect, it } from "vitest";
import {
  builtInThemes,
  getThemeById,
  importThemesFromJson,
  mergeCustomThemes,
  normalizePersistedCustomThemes,
  serializeCustomThemes
} from "./index";

describe("themes", () => {
  it("按 id 查找主题，未知 id 回退默认主题", () => {
    expect(getThemeById(builtInThemes, "dracula").name).toBe("Dracula");
    expect(getThemeById(builtInThemes, "missing").id).toBe("default");
  });

  it("导入 xterm JSON 主题", () => {
    const result = importThemesFromJson(
      JSON.stringify({
        name: "Ocean",
        background: "#001122",
        foreground: "#ddeeff",
        blue: "#3daee9"
      })
    );

    expect(result.ok).toBe(true);
    expect(result.themes[0]).toMatchObject({
      id: "custom:ocean",
      name: "Ocean",
      source: "custom",
      colorScheme: "dark"
    });
    expect(result.themes[0].terminal.blue).toBe("#3daee9");
  });

  it("导入 iTerm2 JSON 色值", () => {
    const result = importThemesFromJson(
      JSON.stringify({
        Name: "Itermish",
        "Background Color": {
          "Red Component": 0,
          "Green Component": 0.1,
          "Blue Component": 0.2
        },
        "Foreground Color": {
          "Red Component": 0.9,
          "Green Component": 0.9,
          "Blue Component": 0.8
        }
      })
    );

    expect(result.ok).toBe(true);
    expect(result.themes[0].terminal.background).toBe("#001a33");
  });

  it("序列化并恢复自定义主题", () => {
    const imported = importThemesFromJson(
      JSON.stringify({
        name: "Paper",
        colorScheme: "light",
        terminal: {
          background: "#ffffff",
          foreground: "#111111"
        }
      })
    );

    expect(imported.ok).toBe(true);
    const serialized = serializeCustomThemes(imported.themes);
    const restored = normalizePersistedCustomThemes(serialized);
    expect(restored[0].id).toBe("custom:paper");
    expect(restored[0].colorScheme).toBe("light");
  });

  it("合并自定义主题时用同 id 替换", () => {
    const first = importThemesFromJson(JSON.stringify({ name: "Same", background: "#000000", foreground: "#ffffff" }));
    const second = importThemesFromJson(JSON.stringify({ name: "Same", background: "#111111", foreground: "#eeeeee" }));

    expect(first.ok && second.ok).toBe(true);
    const merged = first.ok && second.ok ? mergeCustomThemes(first.themes, second.themes) : [];
    expect(merged).toHaveLength(1);
    expect(merged[0].terminal.background).toBe("#111111");
  });
});

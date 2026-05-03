import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  mergeAiSettingsUpdate,
  readAppSettings,
  resolveAiSettings,
  toPublicAiSettings,
  updateAppSettings
} from "./settingsStore";

describe("settingsStore", () => {
  it("合并 AI 配置且不明文保存 apiKey", () => {
    const settings = mergeAiSettingsUpdate(
      { socketSecurityMode: "token" },
      {
        enabled: true,
        endpoint: " https://api.example.com/v1 ",
        model: "test-model",
        apiKey: "sk-1234567890abcdefghijkl",
        redactSecrets: false,
        maxOutputBytes: 8192
      }
    );

    expect(JSON.stringify(settings)).not.toContain("sk-1234567890abcdefghijkl");
    expect(settings.socketSecurityMode).toBe("token");
    expect(resolveAiSettings(settings)).toMatchObject({
      enabled: true,
      endpoint: "https://api.example.com/v1",
      model: "test-model",
      apiKeySet: true,
      redactSecrets: false,
      maxOutputBytes: 8192
    });
  });

  it("public AI settings 不返回 apiKey", () => {
    const publicSettings = toPublicAiSettings({
      enabled: true,
      endpoint: "https://api.example.com/v1",
      model: "model",
      apiKey: "secret",
      apiKeySet: true,
      redactSecrets: true,
      maxOutputBytes: 4096
    });

    expect(publicSettings.apiKey).toBeUndefined();
    expect(publicSettings.apiKeySet).toBe(true);
  });

  it("读写 settings 时保留既有字段", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "wmux-settings-"));
    const settingsPath = path.join(root, "settings.json");

    await updateAppSettings(settingsPath, () => ({ socketSecurityMode: "allowAll" }));
    await updateAppSettings(settingsPath, (settings) =>
      mergeAiSettingsUpdate(settings, { enabled: true, apiKey: "ghp_1234567890abcdefghijkl" })
    );

    const raw = await readFile(settingsPath, "utf8");
    expect(raw).not.toContain("ghp_1234567890abcdefghijkl");
    expect(readAppSettings(settingsPath).socketSecurityMode).toBe("allowAll");
  });
});

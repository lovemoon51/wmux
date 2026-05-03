import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { AiSettings, AiSettingsUpdate, SocketSecurityMode } from "../shared/types";

export type SafeStorageAdapter = {
  isEncryptionAvailable: () => boolean;
  encryptString: (plainText: string) => Buffer;
  decryptString: (encrypted: Buffer) => string;
};

export type AppSettings = {
  socketSecurityMode?: SocketSecurityMode;
  ai?: StoredAiSettings;
};

type StoredAiSettings = {
  enabled?: boolean;
  endpoint?: string;
  model?: string;
  encryptedApiKey?: string;
  apiKey?: string;
  redactSecrets?: boolean;
  maxOutputBytes?: number;
};

export const defaultAiSettings: AiSettings = {
  enabled: false,
  endpoint: "https://api.openai.com/v1",
  model: "gpt-4o-mini",
  redactSecrets: true,
  maxOutputBytes: 4096
};

export function readAppSettings(settingsPath: string): AppSettings {
  try {
    if (!existsSync(settingsPath)) {
      return {};
    }
    const parsed = JSON.parse(readFileSync(settingsPath, "utf8")) as unknown;
    return isRecord(parsed) ? (parsed as AppSettings) : {};
  } catch {
    return {};
  }
}

export async function writeAppSettings(settingsPath: string, settings: AppSettings): Promise<void> {
  await mkdir(dirname(settingsPath), { recursive: true });
  await writeFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
}

export async function updateAppSettings(
  settingsPath: string,
  updater: (settings: AppSettings) => AppSettings
): Promise<AppSettings> {
  const nextSettings = updater(readAppSettings(settingsPath));
  await writeAppSettings(settingsPath, nextSettings);
  return nextSettings;
}

export function resolveAiSettings(settings: AppSettings, safeStorage?: SafeStorageAdapter): AiSettings {
  const stored = isRecord(settings.ai) ? settings.ai : {};
  const apiKey = decryptApiKey(typeof stored.encryptedApiKey === "string" ? stored.encryptedApiKey : undefined, safeStorage);
  return {
    ...defaultAiSettings,
    enabled: typeof stored.enabled === "boolean" ? stored.enabled : defaultAiSettings.enabled,
    endpoint: readNonEmptyString(stored.endpoint) ?? defaultAiSettings.endpoint,
    model: readNonEmptyString(stored.model) ?? defaultAiSettings.model,
    apiKey,
    apiKeySet: Boolean(apiKey || stored.encryptedApiKey || stored.apiKey),
    redactSecrets: typeof stored.redactSecrets === "boolean" ? stored.redactSecrets : defaultAiSettings.redactSecrets,
    maxOutputBytes:
      typeof stored.maxOutputBytes === "number" && Number.isFinite(stored.maxOutputBytes)
        ? Math.max(512, Math.min(32_768, Math.floor(stored.maxOutputBytes)))
        : defaultAiSettings.maxOutputBytes
  };
}

export function toPublicAiSettings(settings: AiSettings): AiSettings {
  const publicSettings = { ...settings };
  delete publicSettings.apiKey;
  return publicSettings;
}

export function mergeAiSettingsUpdate(
  current: AppSettings,
  update: AiSettingsUpdate,
  safeStorage?: SafeStorageAdapter
): AppSettings {
  const previousAi = isRecord(current.ai) ? current.ai : {};
  const nextAi: StoredAiSettings = {
    ...previousAi
  };

  if (typeof update.enabled === "boolean") {
    nextAi.enabled = update.enabled;
  }
  if (typeof update.endpoint === "string") {
    nextAi.endpoint = update.endpoint.trim();
  }
  if (typeof update.model === "string") {
    nextAi.model = update.model.trim();
  }
  if (typeof update.redactSecrets === "boolean") {
    nextAi.redactSecrets = update.redactSecrets;
  }
  if (typeof update.maxOutputBytes === "number" && Number.isFinite(update.maxOutputBytes)) {
    nextAi.maxOutputBytes = Math.max(512, Math.min(32_768, Math.floor(update.maxOutputBytes)));
  }
  if (typeof update.apiKey === "string") {
    if (update.apiKey.trim()) {
      nextAi.encryptedApiKey = encryptApiKey(update.apiKey.trim(), safeStorage);
      delete nextAi.apiKey;
    } else {
      delete nextAi.encryptedApiKey;
      delete nextAi.apiKey;
    }
  }

  return {
    ...current,
    ai: nextAi
  };
}

function encryptApiKey(apiKey: string, safeStorage?: SafeStorageAdapter): string {
  if (!safeStorage?.isEncryptionAvailable()) {
    return `plain:${Buffer.from(apiKey, "utf8").toString("base64")}`;
  }
  return `safe:${safeStorage.encryptString(apiKey).toString("base64")}`;
}

function decryptApiKey(value: string | undefined, safeStorage?: SafeStorageAdapter): string | undefined {
  if (!value) {
    return undefined;
  }
  try {
    if (value.startsWith("safe:")) {
      if (!safeStorage) {
        return undefined;
      }
      return safeStorage.decryptString(Buffer.from(value.slice("safe:".length), "base64"));
    }
    if (value.startsWith("plain:")) {
      return Buffer.from(value.slice("plain:".length), "base64").toString("utf8");
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function readNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

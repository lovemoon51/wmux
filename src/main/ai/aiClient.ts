import type { AiSettings } from "../../shared/types";

export type AiChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type AiChatCompletionParams = {
  settings: AiSettings;
  messages: AiChatMessage[];
  signal?: AbortSignal;
  onToken?: (token: string) => void;
};

export type AiChatCompletionResult = {
  text: string;
};

export function normalizeAiEndpoint(endpoint: string): string {
  return endpoint.trim().replace(/\/+$/, "");
}

export function buildChatCompletionsUrl(endpoint: string): string {
  const normalized = normalizeAiEndpoint(endpoint);
  if (normalized.endsWith("/chat/completions")) {
    return normalized;
  }
  return `${normalized}/chat/completions`;
}

export async function requestChatCompletion({
  settings,
  messages,
  signal,
  onToken
}: AiChatCompletionParams): Promise<AiChatCompletionResult> {
  const response = await fetch(buildChatCompletionsUrl(settings.endpoint), {
    method: "POST",
    signal,
    headers: {
      "content-type": "application/json",
      ...(settings.apiKey ? { authorization: `Bearer ${settings.apiKey}` } : {})
    },
    body: JSON.stringify({
      model: settings.model,
      messages,
      stream: true,
      temperature: 0.2
    })
  });

  if (!response.ok) {
    throw new Error(`AI 请求失败：HTTP ${response.status}`);
  }

  if (!response.body) {
    const payload = (await response.json()) as unknown;
    const text = extractNonStreamedContent(payload);
    if (text) {
      onToken?.(text);
    }
    return { text };
  }

  const decoder = new TextDecoder();
  const reader = response.body.getReader();
  let text = "";
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    const parsed = consumeSseBuffer(buffer);
    buffer = parsed.remaining;
    for (const event of parsed.events) {
      if (event.done) {
        continue;
      }
      const token = event.token ?? "";
      if (!token) {
        continue;
      }
      text += token;
      onToken?.(token);
    }
  }

  buffer += decoder.decode();
  const parsed = consumeSseBuffer(buffer);
  for (const event of parsed.events) {
    const token = event.token ?? "";
    if (!event.done && token) {
      text += token;
      onToken?.(token);
    }
  }

  return { text };
}

export type ParsedSseEvent = {
  token?: string;
  done?: boolean;
};

export function consumeSseBuffer(buffer: string): { events: ParsedSseEvent[]; remaining: string } {
  const normalized = buffer.replace(/\r\n/g, "\n");
  const events: ParsedSseEvent[] = [];
  let cursor = 0;

  while (true) {
    const nextBoundary = normalized.indexOf("\n\n", cursor);
    if (nextBoundary < 0) {
      break;
    }
    const frame = normalized.slice(cursor, nextBoundary);
    cursor = nextBoundary + 2;
    const dataLines = frame
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice("data:".length).trim());

    for (const data of dataLines) {
      if (!data) {
        continue;
      }
      if (data === "[DONE]") {
        events.push({ done: true });
        continue;
      }
      const token = extractStreamToken(data);
      if (token !== undefined) {
        events.push({ token });
      }
    }
  }

  return {
    events,
    remaining: normalized.slice(cursor)
  };
}

export function extractCommandSuggestions(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:[-*]|\d+\.)\s*/, "").trim())
    .map((line) => line.replace(/^`{1,3}|`{1,3}$/g, "").trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"))
    .slice(0, 3);
}

function extractStreamToken(data: string): string | undefined {
  try {
    const payload = JSON.parse(data) as unknown;
    if (!isRecord(payload)) {
      return undefined;
    }
    const choices = payload.choices;
    if (!Array.isArray(choices)) {
      return undefined;
    }
    const firstChoice = choices[0];
    if (!isRecord(firstChoice)) {
      return undefined;
    }
    const delta = firstChoice.delta;
    if (isRecord(delta) && typeof delta.content === "string") {
      return delta.content;
    }
    if (typeof firstChoice.text === "string") {
      return firstChoice.text;
    }
  } catch {
    return undefined;
  }

  return undefined;
}

function extractNonStreamedContent(payload: unknown): string {
  if (!isRecord(payload) || !Array.isArray(payload.choices)) {
    return "";
  }
  const firstChoice = payload.choices[0];
  if (!isRecord(firstChoice)) {
    return "";
  }
  const message = firstChoice.message;
  if (isRecord(message) && typeof message.content === "string") {
    return message.content;
  }
  return typeof firstChoice.text === "string" ? firstChoice.text : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

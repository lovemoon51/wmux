import type { TerminalNotificationPayload } from "../../shared/types";

// OSC 9 / 99 / 777 通知序列：ESC ] code ; payload (BEL | ESC \)
// 仅识别这三个 code，其他 OSC（0 set-title、8 hyperlink）原样透传
// eslint-disable-next-line no-control-regex
export const oscNotificationPattern = /\x1b\](9|99|777);([^\x07\x1b]*)(?:\x07|\x1b\\)/g;

export function parseOscPayload(code: 9 | 99 | 777, payload: string): { title: string; body: string } {
  if (code === 777) {
    // OSC 777：notify;title;body
    const parts = payload.split(";");
    if (parts[0] === "notify" && parts.length >= 2) {
      return {
        title: parts[1] || "终端通知",
        body: parts.slice(2).join(";")
      };
    }
    return { title: "终端通知", body: payload };
  }
  if (code === 99) {
    // OSC 99：可能含 id=N; 前缀
    const semicolonIdx = payload.indexOf(";");
    if (semicolonIdx > 0 && payload.slice(0, semicolonIdx).startsWith("id=")) {
      return { title: "终端通知", body: payload.slice(semicolonIdx + 1) };
    }
    return { title: "终端通知", body: payload };
  }
  // OSC 9：单字段消息
  return { title: "终端通知", body: payload };
}

export function extractOscNotifications(
  surfaceId: string,
  data: string
): { cleaned: string; notifications: TerminalNotificationPayload[] } {
  const notifications: TerminalNotificationPayload[] = [];
  // 每次调用须重置 lastIndex：oscNotificationPattern 是模块级 /g 正则，会保留偏移
  oscNotificationPattern.lastIndex = 0;
  const cleaned = data.replace(oscNotificationPattern, (_match, codeStr: string, payload: string) => {
    const code = Number(codeStr) as 9 | 99 | 777;
    const { title, body } = parseOscPayload(code, payload);
    notifications.push({ surfaceId, code, title, body });
    return "";
  });
  return { cleaned, notifications };
}

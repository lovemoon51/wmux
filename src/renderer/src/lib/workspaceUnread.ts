import type { Workspace } from "@shared/types";

// 未读数 = recentEvents 中事件时间晚于 lastViewedAt 的条目数
// 缺 lastViewedAt 视为全部未读；recentEvents 上限 maxWorkspaceStatusEvents（4），
// 所以实际范围 0..4
export function getWorkspaceUnreadCount(workspace: Workspace): number {
  const events = workspace.recentEvents ?? [];
  if (events.length === 0) {
    return 0;
  }
  const lastViewedAt = workspace.lastViewedAt;
  if (!lastViewedAt) {
    return events.length;
  }
  return events.filter((event) => event.at > lastViewedAt).length;
}

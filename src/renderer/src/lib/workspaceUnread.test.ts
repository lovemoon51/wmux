import { describe, expect, it } from "vitest";
import type { Workspace, WorkspaceStatusEvent } from "@shared/types";
import { getWorkspaceUnreadCount } from "./workspaceUnread";

function createEvent(at: string, message = "x"): WorkspaceStatusEvent {
  return {
    id: `event-${at}`,
    at,
    status: "attention",
    message
  };
}

function createWorkspace(overrides: Partial<Workspace> = {}): Workspace {
  return {
    id: "w1",
    name: "Test",
    cwd: "/tmp",
    ports: [],
    status: "idle",
    layout: { type: "pane", id: "p1" },
    panes: { p1: { id: "p1", surfaceIds: [], activeSurfaceId: "" } },
    surfaces: {},
    activePaneId: "p1",
    ...overrides
  };
}

describe("getWorkspaceUnreadCount", () => {
  it("无 recentEvents → 0", () => {
    expect(getWorkspaceUnreadCount(createWorkspace())).toBe(0);
  });

  it("recentEvents 空数组 → 0", () => {
    expect(getWorkspaceUnreadCount(createWorkspace({ recentEvents: [] }))).toBe(0);
  });

  it("缺 lastViewedAt → 全部计为未读", () => {
    const events = [
      createEvent("2026-05-02T10:00:00Z"),
      createEvent("2026-05-02T11:00:00Z"),
      createEvent("2026-05-02T12:00:00Z")
    ];
    expect(getWorkspaceUnreadCount(createWorkspace({ recentEvents: events }))).toBe(3);
  });

  it("有 lastViewedAt：只计算晚于该时间戳的事件", () => {
    const events = [
      createEvent("2026-05-02T12:00:00Z"),
      createEvent("2026-05-02T11:00:00Z"),
      createEvent("2026-05-02T10:00:00Z")
    ];
    const workspace = createWorkspace({
      recentEvents: events,
      lastViewedAt: "2026-05-02T11:00:00Z"
    });
    // 严格大于 → 11:00 同时刻不算未读，只剩 12:00
    expect(getWorkspaceUnreadCount(workspace)).toBe(1);
  });

  it("lastViewedAt 早于全部事件 → 全部未读", () => {
    const events = [
      createEvent("2026-05-02T10:00:00Z"),
      createEvent("2026-05-02T11:00:00Z")
    ];
    const workspace = createWorkspace({
      recentEvents: events,
      lastViewedAt: "2026-05-01T00:00:00Z"
    });
    expect(getWorkspaceUnreadCount(workspace)).toBe(2);
  });

  it("lastViewedAt 晚于全部事件 → 0", () => {
    const events = [
      createEvent("2026-05-02T10:00:00Z"),
      createEvent("2026-05-02T11:00:00Z")
    ];
    const workspace = createWorkspace({
      recentEvents: events,
      lastViewedAt: "2026-05-03T00:00:00Z"
    });
    expect(getWorkspaceUnreadCount(workspace)).toBe(0);
  });
});

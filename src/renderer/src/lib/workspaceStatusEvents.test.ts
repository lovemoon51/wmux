import { describe, expect, it } from "vitest";
import type { Workspace } from "@shared/types";
import {
  createWorkspaceStatusEvent,
  isWorkspaceStatus,
  maxWorkspaceStatusEvents,
  statusClass,
  statusLabels,
  withWorkspaceStatusEvent,
  workspaceStatusValues
} from "./workspaceStatusEvents";

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

describe("statusLabels / statusClass / workspaceStatusValues", () => {
  it("statusLabels 与 statusClass 含全部 5 种状态", () => {
    for (const status of workspaceStatusValues) {
      expect(typeof statusLabels[status]).toBe("string");
      expect(statusLabels[status].length).toBeGreaterThan(0);
      expect(typeof statusClass[status]).toBe("string");
      expect(statusClass[status].length).toBeGreaterThan(0);
    }
  });

  it("workspaceStatusValues 包含已知 5 种状态", () => {
    expect(workspaceStatusValues.sort()).toEqual(
      ["attention", "error", "idle", "running", "success"].sort()
    );
  });

  it("maxWorkspaceStatusEvents 是正整数", () => {
    expect(Number.isInteger(maxWorkspaceStatusEvents)).toBe(true);
    expect(maxWorkspaceStatusEvents).toBeGreaterThan(0);
  });
});

describe("isWorkspaceStatus", () => {
  it("已知字符串通过", () => {
    expect(isWorkspaceStatus("idle")).toBe(true);
    expect(isWorkspaceStatus("attention")).toBe(true);
    expect(isWorkspaceStatus("error")).toBe(true);
  });

  it("非已知字符串拒绝", () => {
    expect(isWorkspaceStatus("unknown")).toBe(false);
    expect(isWorkspaceStatus("")).toBe(false);
    expect(isWorkspaceStatus("Idle")).toBe(false); // 区分大小写
  });

  it("非字符串类型拒绝", () => {
    expect(isWorkspaceStatus(undefined)).toBe(false);
    expect(isWorkspaceStatus(null)).toBe(false);
    expect(isWorkspaceStatus(42)).toBe(false);
    expect(isWorkspaceStatus({})).toBe(false);
  });
});

describe("createWorkspaceStatusEvent", () => {
  it("空消息返回 undefined", () => {
    expect(createWorkspaceStatusEvent({ status: "idle", message: "" })).toBeUndefined();
    expect(createWorkspaceStatusEvent({ status: "idle", message: "   " })).toBeUndefined();
    expect(createWorkspaceStatusEvent({ status: "idle" })).toBeUndefined();
  });

  it("非空消息返回事件且去除首尾空白", () => {
    const event = createWorkspaceStatusEvent({ status: "attention", message: "  hello  " });
    expect(event).toBeDefined();
    expect(event?.message).toBe("hello");
    expect(event?.status).toBe("attention");
  });

  it("生成的 id 以 event- 开头且每次唯一", () => {
    const a = createWorkspaceStatusEvent({ status: "idle", message: "x" });
    const b = createWorkspaceStatusEvent({ status: "idle", message: "x" });
    expect(a?.id.startsWith("event-")).toBe(true);
    expect(b?.id.startsWith("event-")).toBe(true);
    expect(a?.id).not.toBe(b?.id);
  });

  it("at 是合法 ISO 8601 时间戳", () => {
    const event = createWorkspaceStatusEvent({ status: "idle", message: "x" });
    expect(event?.at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    expect(Number.isNaN(Date.parse(event!.at))).toBe(false);
  });
});

describe("withWorkspaceStatusEvent", () => {
  it("空消息时返回原 workspace（同一引用）", () => {
    const workspace = createWorkspace();
    const next = withWorkspaceStatusEvent(workspace, { status: "idle", message: "" });
    expect(next).toBe(workspace);
  });

  it("追加事件到 recentEvents 头部", () => {
    const workspace = createWorkspace();
    const next = withWorkspaceStatusEvent(workspace, { status: "attention", message: "first" });
    expect(next.recentEvents).toHaveLength(1);
    expect(next.recentEvents?.[0].message).toBe("first");
  });

  it("不修改原 workspace（immutability）", () => {
    const workspace = createWorkspace();
    withWorkspaceStatusEvent(workspace, { status: "idle", message: "side effect?" });
    expect(workspace.recentEvents).toBeUndefined();
  });

  it("超过 maxWorkspaceStatusEvents 时截断保留最新", () => {
    let workspace = createWorkspace();
    for (let i = 0; i < maxWorkspaceStatusEvents + 2; i++) {
      workspace = withWorkspaceStatusEvent(workspace, {
        status: "running",
        message: `event-${i}`
      });
    }
    expect(workspace.recentEvents).toHaveLength(maxWorkspaceStatusEvents);
    // 头部应是最近一次插入的 event-(N+1)
    expect(workspace.recentEvents?.[0].message).toBe(`event-${maxWorkspaceStatusEvents + 1}`);
  });
});

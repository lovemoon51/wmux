import type { Workspace, WorkspaceStatus, WorkspaceStatusEvent } from "@shared/types";

// 状态枚举显示名：sidebar workspaceStatus span 与 notification panel 共用
export const statusLabels: Record<WorkspaceStatus, string> = {
  idle: "Idle",
  running: "Running",
  attention: "Needs input",
  success: "Done",
  error: "Error"
};

// 状态环 / 历史点 className：与 styles.css 中的 .statusIdle / .statusRunning 等对齐
export const statusClass: Record<WorkspaceStatus, string> = {
  idle: "statusIdle",
  running: "statusRunning",
  attention: "statusAttention",
  success: "statusSuccess",
  error: "statusError"
};

// 类型守卫使用的全枚举值：保持顺序稳定，便于测试
export const workspaceStatusValues: WorkspaceStatus[] = [
  "idle",
  "running",
  "attention",
  "success",
  "error"
];

// recentEvents 数组上限：未读 badge 与通知面板都依赖此值，超出会先到先得淘汰
export const maxWorkspaceStatusEvents = 4;

export type WorkspaceStatusEventInput = {
  status: WorkspaceStatus;
  message?: string;
};

export function isWorkspaceStatus(value: unknown): value is WorkspaceStatus {
  return typeof value === "string" && workspaceStatusValues.includes(value as WorkspaceStatus);
}

// 创建一条事件：消息为空时返回 undefined（调用方据此跳过追加）
// id 用 Date.now + 16 进制随机后缀保证同毫秒并发也不撞
export function createWorkspaceStatusEvent(
  input: WorkspaceStatusEventInput
): WorkspaceStatusEvent | undefined {
  const message = input.message?.trim();
  if (!message) {
    return undefined;
  }
  return {
    id: `event-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    at: new Date().toISOString(),
    status: input.status,
    message
  };
}

// 不可变追加：返回新 workspace 对象，最多保留 maxWorkspaceStatusEvents 条最近事件
// 空消息直接返回原 workspace，避免无意义 setState 触发重渲染
export function withWorkspaceStatusEvent(
  workspace: Workspace,
  input: WorkspaceStatusEventInput
): Workspace {
  const event = createWorkspaceStatusEvent(input);
  if (!event) {
    return workspace;
  }
  return {
    ...workspace,
    recentEvents: [event, ...(workspace.recentEvents ?? [])].slice(0, maxWorkspaceStatusEvents)
  };
}

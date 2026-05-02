import type { BlockStatus } from "@shared/types";

export function formatBlockDuration(durationMs: number | undefined): string {
  if (durationMs === undefined || !Number.isFinite(durationMs) || durationMs < 0) {
    return "running";
  }
  if (durationMs < 1000) {
    return `${Math.max(1, Math.round(durationMs))}ms`;
  }
  if (durationMs < 60_000) {
    return `${(durationMs / 1000).toFixed(durationMs < 10_000 ? 1 : 0)}s`;
  }

  const totalSeconds = Math.round(durationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function getBlockStatusClass(status: BlockStatus): string {
  if (status === "success") {
    return "blockStatusSuccess";
  }
  if (status === "error") {
    return "blockStatusError";
  }
  if (status === "aborted") {
    return "blockStatusAborted";
  }
  return "blockStatusRunning";
}

export function getBlockStatusLabel(status: BlockStatus, exitCode?: number): string {
  if (status === "success") {
    return "exit 0";
  }
  if (status === "error") {
    return `exit ${exitCode ?? 1}`;
  }
  if (status === "aborted") {
    return "aborted";
  }
  return "running";
}

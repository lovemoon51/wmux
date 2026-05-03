import { Box, Folder, GitBranch, Package } from "lucide-react";
import type { ReactElement } from "react";
import type { WorkspaceInspection } from "@shared/types";

export type TerminalStatusBarProps = Pick<WorkspaceInspection, "branch" | "gitDirty" | "venv" | "nodeVersion"> & {
  cwd: string;
};

export function TerminalStatusBar({
  cwd,
  branch,
  gitDirty,
  venv,
  nodeVersion
}: TerminalStatusBarProps): ReactElement {
  return (
    <span className="terminalStatusBar" aria-label="Workspace status">
      <span className="terminalStatusPill terminalStatusPath" title={cwd}>
        <Folder size={12} />
        <span className="terminalStatusText">{compactCwd(cwd)}</span>
      </span>
      {branch && (
        <span
          className={`terminalStatusPill${gitDirty ? " terminalStatusDirty" : ""}`}
          title={gitDirty === undefined ? "Git status unknown" : gitDirty ? "Git dirty" : "Git clean"}
        >
          <GitBranch size={12} />
          <span className="terminalStatusText">{gitDirty ? `${branch} *` : branch}</span>
        </span>
      )}
      {venv && (
        <span className="terminalStatusPill" title={`Python venv: ${venv}`}>
          <Box size={12} />
          <span className="terminalStatusText">venv {venv}</span>
        </span>
      )}
      {nodeVersion && (
        <span className="terminalStatusPill" title={`Node: ${nodeVersion}`}>
          <Package size={12} />
          <span className="terminalStatusText">node {nodeVersion}</span>
        </span>
      )}
    </span>
  );
}

export function compactCwd(cwd: string): string {
  const normalized = cwd.replace(/\\/g, "/");
  const drive = normalized.match(/^[A-Za-z]:/)?.[0];
  const withoutDrive = drive ? normalized.slice(drive.length) : normalized;
  const parts = withoutDrive.split("/").filter(Boolean);

  if (parts.length <= 2) {
    return normalized;
  }

  const tail = parts.slice(-2).join("/");
  return drive ? `${drive}/.../${tail}` : `.../${tail}`;
}

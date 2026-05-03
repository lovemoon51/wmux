import { Bot, Copy, Pin, Play, RotateCcw } from "lucide-react";
import { useEffect, useMemo, useState, type ReactElement } from "react";
import type { Block } from "@shared/types";
import { formatBlockDuration, getBlockStatusClass, getBlockStatusLabel } from "../lib/blockPresentation";

export type BlockOverlayProps = {
  blocks: Block[];
  focusedBlockId?: string;
  terminalHost: HTMLDivElement | null;
  viewportY: number;
  onFocusBlock: (blockId: string) => void;
  onCopyBlock: (block: Block, mode: "command" | "all") => void;
  onRerunBlock: (block: Block) => void;
  onExplainBlock?: (block: Block) => void;
  aiEnabled?: boolean;
};

type BlockGeometry = {
  block: Block;
  top: number;
  height: number;
};

export function BlockOverlay({
  blocks,
  focusedBlockId,
  terminalHost,
  viewportY,
  onFocusBlock,
  onCopyBlock,
  onRerunBlock,
  onExplainBlock,
  aiEnabled
}: BlockOverlayProps): ReactElement | null {
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!blocks.some((block) => block.status === "running")) {
      return;
    }
    const timer = window.setInterval(() => setTick((value) => value + 1), 250);
    return () => window.clearInterval(timer);
  }, [blocks]);

  const geometries = useMemo(
    () => computeBlockGeometry(blocks, terminalHost, viewportY),
    [blocks, terminalHost, viewportY]
  );

  if (!terminalHost || geometries.length === 0) {
    return null;
  }

  return (
    <div className="blockOverlay" aria-label="Terminal command blocks">
      {geometries.map(({ block, top, height }) => {
        const durationMs =
          block.status === "running" ? Math.max(0, Date.now() - Date.parse(block.startedAt)) : block.durationMs;
        return (
          <section
            className={`blockFrame ${getBlockStatusClass(block.status)} ${
              block.id === focusedBlockId ? "blockFrameFocused" : ""
            }`}
            key={block.id}
            style={{ top, height }}
            aria-label={block.command || "Terminal command block"}
            onMouseDown={(event) => {
              event.stopPropagation();
              onFocusBlock(block.id);
            }}
          >
            <div className="blockMetaBar">
              <span className="blockCommandText">{block.command || "shell command"}</span>
              <span className="blockMetaText" title={block.cwd}>
                {block.cwd ? compactPath(block.cwd) : block.shell ?? "shell"}
              </span>
              <span className="blockMetaText">{formatBlockDuration(durationMs)}</span>
              <span className="blockExitBadge">{getBlockStatusLabel(block.status, block.exitCode)}</span>
              <span className="blockActions">
                <button
                  className="blockActionButton"
                  type="button"
                  title="复制命令"
                  aria-label="复制命令"
                  onClick={() => onCopyBlock(block, "command")}
                >
                  <Copy size={12} />
                </button>
                <button
                  className="blockActionButton"
                  type="button"
                  title="复制命令和输出"
                  aria-label="复制命令和输出"
                  onClick={() => onCopyBlock(block, "all")}
                >
                  <Pin size={12} />
                </button>
                <button
                  className="blockActionButton"
                  type="button"
                  title="重新写入命令"
                  aria-label="重新写入命令"
                  onClick={() => onRerunBlock(block)}
                >
                  <RotateCcw size={12} />
                </button>
                <button className="blockActionButton" type="button" title="聚焦块" aria-label="聚焦块">
                  <Play size={12} />
                </button>
                {aiEnabled && block.status === "error" && (
                  <button
                    className="blockActionButton"
                    type="button"
                    title="Explain with AI"
                    aria-label="Explain with AI"
                    onClick={() => onExplainBlock?.(block)}
                  >
                    <Bot size={12} />
                  </button>
                )}
              </span>
            </div>
          </section>
        );
      })}
    </div>
  );
}

function computeBlockGeometry(blocks: Block[], host: HTMLDivElement | null, viewportY: number): BlockGeometry[] {
  if (!host) {
    return [];
  }

  const rows = Array.from(host.querySelectorAll<HTMLElement>(".xterm-rows > div"));
  if (rows.length === 0) {
    return [];
  }

  const hostRect = host.getBoundingClientRect();
  const firstRect = rows[0].getBoundingClientRect();
  const lastRect = rows[rows.length - 1].getBoundingClientRect();
  const measuredLineHeight =
    rows.length > 1
      ? (lastRect.bottom - firstRect.top) / Math.max(1, rows.length)
      : Math.max(16, firstRect.height || 17);
  const visibleStartLine = viewportY;
  const visibleEndLine = viewportY + rows.length - 1;

  return blocks
    .filter((block) => block.endLine === undefined || block.endLine >= visibleStartLine)
    .filter((block) => block.startLine <= visibleEndLine)
    .map((block) => {
      const startLine = Math.max(block.startLine, visibleStartLine);
      const endLine = Math.min(block.endLine ?? block.startLine + 2, visibleEndLine);
      const top = firstRect.top - hostRect.top + (startLine - visibleStartLine) * measuredLineHeight;
      const height = Math.max(28, (endLine - startLine + 1) * measuredLineHeight);
      return { block, top, height };
    });
}

function compactPath(value: string): string {
  const normalized = value.replace(/\\/g, "/");
  const parts = normalized.split("/").filter(Boolean);
  if (parts.length <= 2) {
    return normalized;
  }
  return `.../${parts.slice(-2).join("/")}`;
}

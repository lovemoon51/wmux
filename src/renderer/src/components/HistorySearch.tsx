import { Activity, Search, X } from "lucide-react";
import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent, type ReactElement } from "react";
import type { BlockHistoryQuery, BlockHistoryRecord } from "../lib/blockHistorySearch";

export function HistorySearch({
  isOpen,
  query,
  parsedQuery,
  results,
  selectedIndex,
  onClose,
  onQueryChange,
  onSelectedIndexChange,
  onRun
}: {
  isOpen: boolean;
  query: string;
  parsedQuery: BlockHistoryQuery;
  results: BlockHistoryRecord[];
  selectedIndex: number;
  onClose: () => void;
  onQueryChange: (value: string) => void;
  onSelectedIndexChange: (index: number) => void;
  onRun: (block: BlockHistoryRecord, mode: "insert" | "execute") => void;
}): ReactElement | null {
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }, [isOpen]);

  if (!isOpen) {
    return null;
  }

  const normalizedSelectedIndex = results.length ? Math.min(selectedIndex, results.length - 1) : 0;
  const selectedBlock = results[normalizedSelectedIndex];
  const handleKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      onSelectedIndexChange(results.length ? (normalizedSelectedIndex + 1) % results.length : 0);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      onSelectedIndexChange(results.length ? (normalizedSelectedIndex - 1 + results.length) % results.length : 0);
      return;
    }
    if (event.key === "Enter" && selectedBlock) {
      event.preventDefault();
      onRun(selectedBlock, event.ctrlKey || event.metaKey ? "execute" : "insert");
    }
  };

  return (
    <div className="historySearchOverlay" role="presentation" onMouseDown={onClose}>
      <section
        className="historySearch"
        role="dialog"
        aria-modal="true"
        aria-label="Command history"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="historySearchHeader">
          <Search size={16} />
          <input
            ref={inputRef}
            aria-label="History search"
            value={query}
            placeholder="搜索历史命令"
            onChange={(event) => {
              onQueryChange(event.target.value);
              onSelectedIndexChange(0);
            }}
            onKeyDown={handleKeyDown}
          />
          <button className="iconButton" type="button" aria-label="Close history" onClick={onClose}>
            <X size={14} />
          </button>
        </div>
        <div className="historySearchStatus">
          <span>{results.length} results</span>
          {parsedQuery.errors[0] && <span className="historySearchError">{parsedQuery.errors[0]}</span>}
        </div>
        <div className="historySearchList" role="listbox" aria-label="History results">
          {results.length ? (
            results.map((block, index) => (
              <button
                className={`historySearchItem ${index === normalizedSelectedIndex ? "historySearchItemActive" : ""}`}
                type="button"
                role="option"
                aria-selected={index === normalizedSelectedIndex}
                key={block.id}
                onMouseEnter={() => onSelectedIndexChange(index)}
                onClick={() => onRun(block, "insert")}
              >
                <span className="historySearchIcon">
                  <Activity size={15} />
                </span>
                <span className="historySearchMain">
                  <span className="historySearchCommand">{block.command}</span>
                  <span className="historySearchMeta">
                    {block.cwd ?? block.workspaceName ?? block.workspaceId}
                    {block.shell ? ` · ${block.shell}` : ""}
                    {typeof block.exitCode === "number" ? ` · exit ${block.exitCode}` : ""}
                    {` · ${formatHistoryTime(block.endedAt ?? block.startedAt)}`}
                  </span>
                </span>
              </button>
            ))
          ) : (
            <div className="historySearchEmpty">没有匹配的历史命令</div>
          )}
        </div>
      </section>
    </div>
  );
}

function formatHistoryTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "unknown time";
  }
  return date.toLocaleString(undefined, {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

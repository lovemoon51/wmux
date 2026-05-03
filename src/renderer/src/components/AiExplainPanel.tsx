import { Copy, Play, X } from "lucide-react";
import type { Block } from "@shared/types";
import type { ReactElement } from "react";

export type AiExplainPanelProps = {
  block: Block;
  text: string;
  status: "streaming" | "done" | "error";
  error?: string;
  suggestions: string[];
  onCancel: () => void;
  onClose: () => void;
  onInsertCommand: (command: string) => void;
  onCopy: (text: string) => void;
};

export function AiExplainPanel({
  block,
  text,
  status,
  error,
  suggestions,
  onCancel,
  onClose,
  onInsertCommand,
  onCopy
}: AiExplainPanelProps): ReactElement {
  return (
    <section className="aiExplainPanel" aria-label="AI explain panel">
      <div className="aiExplainHeader">
        <div>
          <strong>Explain Block</strong>
          <span>{block.command || "shell command"}</span>
        </div>
        <div className="aiExplainActions">
          {status === "streaming" && (
            <button type="button" className="blockActionButton" title="取消" aria-label="取消" onClick={onCancel}>
              <X size={13} />
            </button>
          )}
          <button type="button" className="blockActionButton" title="关闭" aria-label="关闭" onClick={onClose}>
            <X size={13} />
          </button>
        </div>
      </div>
      <pre className="aiExplainBody">
        {status === "error" ? error ?? "AI 请求失败" : text || "正在等待首个 token..."}
      </pre>
      {suggestions.length > 0 && (
        <div className="aiSuggestionList">
          {suggestions.map((suggestion) => (
            <div className="aiSuggestionItem" key={suggestion}>
              <code>{suggestion}</code>
              <button
                type="button"
                className="blockActionButton"
                title="写入输入框"
                aria-label="写入输入框"
                onClick={() => onInsertCommand(suggestion)}
              >
                <Play size={12} />
              </button>
              <button
                type="button"
                className="blockActionButton"
                title="复制命令"
                aria-label="复制命令"
                onClick={() => onCopy(suggestion)}
              >
                <Copy size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

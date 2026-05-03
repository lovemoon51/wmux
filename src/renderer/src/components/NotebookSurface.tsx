import {
  Check,
  FileText,
  Play,
  Save,
  SquareTerminal
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type ReactElement
} from "react";
import type { NotebookBlock, NotebookCodeBlock } from "../lib/notebookMarkdown";
import { extractNotebookCodeBlocks, parseNotebookBlocks } from "../lib/notebookMarkdown";
import type { ShellProfile, Surface } from "@shared/types";

type NotebookRunResult = {
  id: string;
  blockIndex: number;
  language: string;
  status: "running" | "success" | "error";
  output: string;
  exitCode?: number;
};

type NotebookSurfaceProps = {
  surface: Surface;
  workspaceId: string;
  cwd: string;
  shell: ShellProfile;
  onUpdateSurfaceSubtitle: (surfaceId: string, subtitle: string) => void;
};

export function NotebookSurface({
  surface,
  workspaceId,
  cwd,
  shell,
  onUpdateSurfaceSubtitle
}: NotebookSurfaceProps): ReactElement {
  const notebookId = surface.notebookId ?? surface.id.replace(/^surface-notebook-/, "");
  const [content, setContent] = useState("");
  const [pathLabel, setPathLabel] = useState(surface.subtitle ?? ".wmux/notebooks");
  const [dirty, setDirty] = useState(false);
  const [statusText, setStatusText] = useState("Loading");
  const [error, setError] = useState<string | null>(null);
  const [runResults, setRunResults] = useState<NotebookRunResult[]>([]);
  const contentRef = useRef(content);
  const loadKey = `${cwd}:${notebookId}`;
  const blocks = useMemo(() => parseNotebookBlocks(content), [content]);
  const codeBlocks = useMemo(() => extractNotebookCodeBlocks(content), [content]);

  useEffect(() => {
    contentRef.current = content;
  }, [content]);

  useEffect(() => {
    let cancelled = false;
    setStatusText("Loading");
    setError(null);
    setDirty(false);

    void window.wmux?.notebook
      .load({ cwd, notebookId, title: surface.name })
      .then((result) => {
        if (cancelled) {
          return;
        }
        if (contentRef.current !== result.content) {
          setContent(result.content);
          contentRef.current = result.content;
        }
        setPathLabel(result.relativePath);
        setDirty(!result.exists);
        setStatusText(result.exists ? "Saved" : "Draft");
        onUpdateSurfaceSubtitle(surface.id, result.relativePath);
      })
      .catch((reason) => {
        if (cancelled) {
          return;
        }
        setError(reason instanceof Error ? reason.message : String(reason));
        setStatusText("Load failed");
      });

    return () => {
      cancelled = true;
    };
  }, [cwd, loadKey, notebookId, onUpdateSurfaceSubtitle, surface.id, surface.name]);

  const saveNotebook = useCallback(async (): Promise<void> => {
    setStatusText("Saving");
    setError(null);
    try {
      const result = await window.wmux?.notebook.save({ cwd, notebookId, content: contentRef.current });
      if (result) {
        setPathLabel(result.relativePath);
        onUpdateSurfaceSubtitle(surface.id, result.relativePath);
      }
      setDirty(false);
      setStatusText("Saved");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setStatusText("Save failed");
    }
  }, [cwd, notebookId, onUpdateSurfaceSubtitle, surface.id]);

  const handleChange = (event: ChangeEvent<HTMLTextAreaElement>): void => {
    setContent(event.target.value);
    setDirty(true);
    setStatusText("Draft");
  };

  const handleEditorKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      void saveNotebook();
    }
  };

  const runCodeBlock = useCallback(
    async (block: NotebookCodeBlock): Promise<void> => {
      const trimmedCode = block.code.trim();
      if (!trimmedCode) {
        return;
      }

      const runId = `notebook-run-${surface.id}-${block.index}-${Date.now()}`;
      setRunResults((items) => [
        {
          id: runId,
          blockIndex: block.index,
          language: block.language,
          status: "running",
          output: "",
          exitCode: undefined
        },
        ...items.filter((item) => item.blockIndex !== block.index)
      ]);

      try {
        await runNotebookCode({
          sessionId: runId,
          surfaceId: surface.id,
          workspaceId,
          cwd,
          shell,
          code: trimmedCode,
          onData: (chunk) => {
            setRunResults((items) =>
              items.map((item) => (item.id === runId ? { ...item, output: `${item.output}${chunk}` } : item))
            );
          },
          onExit: (exitCode) => {
            setRunResults((items) =>
              items.map((item) =>
                item.id === runId ? { ...item, status: exitCode === 0 ? "success" : "error", exitCode } : item
              )
            );
          }
        });
      } catch (reason) {
        const message = reason instanceof Error ? reason.message : String(reason);
        setRunResults((items) =>
          items.map((item) => (item.id === runId ? { ...item, status: "error", output: message, exitCode: -1 } : item))
        );
      }
    },
    [cwd, shell, surface.id, workspaceId]
  );

  const runAll = (): void => {
    codeBlocks.forEach((block) => {
      void runCodeBlock(block);
    });
  };

  return (
    <div className="notebookSurface">
      <div className="notebookToolbar">
        <div className="notebookPath">
          <FileText size={14} />
          <span>{pathLabel}</span>
        </div>
        <span className={`notebookSaveState ${dirty ? "notebookSaveStateDirty" : ""}`}>
          {dirty ? statusText : <><Check size={13} /> {statusText}</>}
        </span>
        <button className="toolbarButton" type="button" onClick={() => void saveNotebook()}>
          <Save size={14} />
          <span>Save</span>
        </button>
        <button className="toolbarButton" type="button" disabled={codeBlocks.length === 0} onClick={runAll}>
          <Play size={14} />
          <span>Run all</span>
        </button>
      </div>
      {error ? <div className="notebookError">{error}</div> : null}
      <div className="notebookWorkspace">
        <textarea
          className="notebookEditor"
          spellCheck={false}
          value={content}
          onChange={handleChange}
          onKeyDown={handleEditorKeyDown}
        />
        <div className="notebookPreview" aria-label={`${surface.name} preview`}>
          {blocks.map((block) => (
            <NotebookPreviewBlock
              key={block.id}
              block={block}
              result={block.type === "code" ? runResults.find((item) => item.blockIndex === block.index) : undefined}
              onRun={block.type === "code" ? () => void runCodeBlock(block) : undefined}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function NotebookPreviewBlock({
  block,
  result,
  onRun
}: {
  block: NotebookBlock;
  result?: NotebookRunResult;
  onRun?: () => void;
}): ReactElement {
  if (block.type === "code") {
    return (
      <section className="notebookCodeBlock">
        <div className="notebookCodeHeader">
          <span>{block.language}</span>
          <button className="iconButton" type="button" aria-label={`Run code block ${block.index}`} onClick={onRun}>
            <Play size={13} />
          </button>
        </div>
        <pre>
          <code>{block.code}</code>
        </pre>
        {result ? (
          <div className={`notebookRunOutput notebookRunOutput-${result.status}`}>
            <div className="notebookRunMeta">
              <SquareTerminal size={13} />
              <span>{result.status === "running" ? "Running" : `Exit ${result.exitCode ?? 0}`}</span>
            </div>
            <pre>{result.output || (result.status === "running" ? "Waiting for output..." : "No output")}</pre>
          </div>
        ) : null}
      </section>
    );
  }

  return <MarkdownPreview text={block.text} />;
}

function MarkdownPreview({ text }: { text: string }): ReactElement {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const elements: ReactElement[] = [];
  let paragraph: string[] = [];

  const flushParagraph = (): void => {
    if (paragraph.length === 0) {
      return;
    }
    elements.push(<p key={`p-${elements.length}`}>{paragraph.join(" ")}</p>);
    paragraph = [];
  };

  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed) {
      flushParagraph();
      return;
    }
    const heading = /^(#{1,3})\s+(.+)$/.exec(trimmed);
    if (heading) {
      flushParagraph();
      const level = Math.min(3, heading[1].length);
      const headingText = heading[2];
      if (level === 1) {
        elements.push(<h1 key={`h-${index}`}>{headingText}</h1>);
      } else if (level === 2) {
        elements.push(<h2 key={`h-${index}`}>{headingText}</h2>);
      } else {
        elements.push(<h3 key={`h-${index}`}>{headingText}</h3>);
      }
      return;
    }
    if (/^[-*]\s+/.test(trimmed)) {
      flushParagraph();
      elements.push(<p className="notebookListLine" key={`li-${index}`}>{trimmed.replace(/^[-*]\s+/, "")}</p>);
      return;
    }
    paragraph.push(trimmed);
  });
  flushParagraph();

  return <div className="notebookMarkdownBlock">{elements}</div>;
}

async function runNotebookCode({
  sessionId,
  surfaceId,
  workspaceId,
  cwd,
  shell,
  code,
  onData,
  onExit
}: {
  sessionId: string;
  surfaceId: string;
  workspaceId: string;
  cwd: string;
  shell: ShellProfile;
  code: string;
  onData: (chunk: string) => void;
  onExit: (exitCode: number) => void;
}): Promise<void> {
  const terminal = window.wmux?.terminal;
  if (!terminal) {
    throw new Error("terminal bridge unavailable");
  }

  const hiddenSurfaceId = `${surfaceId}:hidden`;
  const removeDataListener = terminal.onData((payload) => {
    if (payload.id === sessionId) {
      onData(payload.data);
    }
  });
  const removeExitListener = terminal.onExit((payload) => {
    if (payload.id !== sessionId) {
      return;
    }
    onExit(payload.exitCode);
    removeDataListener?.();
    removeExitListener?.();
  });

  try {
    await terminal.create({
      id: sessionId,
      surfaceId: hiddenSurfaceId,
      workspaceId,
      cwd,
      cols: 120,
      rows: 32,
      shell: shell as Parameters<typeof terminal.create>[0]["shell"]
    });
    terminal.input({ id: sessionId, data: buildNotebookExecutionInput(code, shell) });
  } catch (error) {
    removeDataListener?.();
    removeExitListener?.();
    terminal.dispose({ id: sessionId });
    throw error;
  }
}

function buildNotebookExecutionInput(command: string, shell: ShellProfile): string {
  const normalizedCommand = command.endsWith("\n") || command.endsWith("\r") ? command : `${command}\n`;
  if (shell === "cmd") {
    return `${normalizedCommand}exit /b %ERRORLEVEL%\r\n`;
  }
  if (shell === "bash" || shell === "zsh") {
    return `${normalizedCommand}exit $?\n`;
  }
  return `${normalizedCommand}exit $LASTEXITCODE\r\n`;
}

import { FitAddon } from "@xterm/addon-fit";
import { Terminal as XTerm } from "@xterm/xterm";
import { Activity, Code2 } from "lucide-react";
import { useEffect, useRef, type ReactElement } from "react";
import type { ShellProfile, Surface, WorkspaceStatus } from "@shared/types";
import "@xterm/xterm/css/xterm.css";

const terminalUrlPattern = /https?:\/\/[^\s"'<>]+/gi;
const terminalUrlTrailingPunctuationPattern = /[),.;\]}]+$/;

const statusLabels: Record<WorkspaceStatus, string> = {
  idle: "Idle",
  running: "Running",
  attention: "Needs input",
  success: "Done",
  error: "Error"
};

const pendingTerminalDisposeTimers = new Map<string, number>();

function extractTerminalUrls(text: string): Array<{ url: string; index: number }> {
  return Array.from(text.matchAll(terminalUrlPattern))
    .map((match) => ({
      url: match[0].replace(terminalUrlTrailingPunctuationPattern, ""),
      index: match.index ?? 0
    }))
    .filter((match) => match.url.length > "https://".length);
}

export function TerminalSurface({
  surface,
  cwd,
  shell,
  onOpenUrl
}: {
  surface: Surface;
  cwd: string;
  shell: ShellProfile;
  onOpenUrl?: (url: string) => void;
}): ReactElement {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const onOpenUrlRef = useRef(onOpenUrl);
  const lastSelectionRef = useRef("");
  const sessionId = `${surface.id}:${shell}`;

  useEffect(() => {
    onOpenUrlRef.current = onOpenUrl;
  }, [onOpenUrl]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) {
      return;
    }

    const pendingDisposeTimer = pendingTerminalDisposeTimers.get(sessionId);
    if (pendingDisposeTimer) {
      window.clearTimeout(pendingDisposeTimer);
      pendingTerminalDisposeTimers.delete(sessionId);
    }

    const terminal = new XTerm({
      allowProposedApi: false,
      cursorBlink: true,
      convertEol: true,
      fontFamily: '"JetBrains Mono", "SFMono-Regular", Consolas, monospace',
      fontSize: 13,
      lineHeight: 1.35,
      theme: {
        background: "#101214",
        foreground: "#d7dee7",
        cursor: "#3daee9",
        selectionBackground: "#314253",
        black: "#101214",
        red: "#ef6b73",
        green: "#58c27d",
        yellow: "#e2b84d",
        blue: "#3daee9",
        magenta: "#c792ea",
        cyan: "#53c7d4",
        white: "#eceff3",
        brightBlack: "#707987",
        brightRed: "#ff858c",
        brightGreen: "#72d99a",
        brightYellow: "#f0ca62",
        brightBlue: "#65c5f2",
        brightMagenta: "#d7a6f4",
        brightCyan: "#74dce7",
        brightWhite: "#ffffff"
      }
    });
    const fitAddon = new FitAddon();

    terminal.loadAddon(fitAddon);
    terminal.open(host);
    terminal.focus();

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    const fitAndResize = (): void => {
      fitAddon.fit();
      window.wmux?.terminal.resize({
        id: sessionId,
        cols: terminal.cols,
        rows: terminal.rows
      });
    };

    const focusTerminal = (event: MouseEvent): void => {
      if (event.button === 0) {
        terminal.focus();
      }
    };
    host.addEventListener("mousedown", focusTerminal);

    const selectionChangeDisposable = terminal.onSelectionChange(() => {
      const selection = terminal.getSelection();
      if (selection.trim()) {
        lastSelectionRef.current = selection;
      }
    });

    const handleTerminalContextMenu = (event: MouseEvent): void => {
      const activeSelection = terminal.getSelection() || window.getSelection()?.toString() || "";
      const selectionToCopy = activeSelection.trim() ? activeSelection : lastSelectionRef.current;

      event.preventDefault();
      event.stopPropagation();
      if (selectionToCopy.trim()) {
        lastSelectionRef.current = "";
        window.wmux?.clipboard.writeText(selectionToCopy);
        terminal.clearSelection();
        terminal.focus();
        return;
      }

      const text = window.wmux?.clipboard.readText() ?? "";
      if (text) {
        terminal.paste(text);
      }
      terminal.focus();
    };
    host.addEventListener("contextmenu", handleTerminalContextMenu, { capture: true });

    const handleTerminalClick = (event: MouseEvent): void => {
      const openUrl = onOpenUrlRef.current;
      if (!openUrl) {
        return;
      }

      const hostRect = host.getBoundingClientRect();
      if (
        event.clientX < hostRect.left ||
        event.clientX > hostRect.right ||
        event.clientY < hostRect.top ||
        event.clientY > hostRect.bottom
      ) {
        return;
      }

      const rowElement = Array.from(host.querySelectorAll<HTMLElement>(".xterm-rows > div")).find((row) => {
        const rect = row.getBoundingClientRect();
        return event.clientY >= rect.top && event.clientY <= rect.bottom;
      });
      const rowText = rowElement?.textContent ?? "";
      const rowUrls = extractTerminalUrls(rowText);
      if (!rowElement || rowUrls.length === 0) {
        return;
      }

      if (rowUrls.length === 1) {
        openUrl(rowUrls[0].url);
        return;
      }

      const rowRect = rowElement.getBoundingClientRect();
      const characterWidth = rowRect.width / Math.max(1, terminal.cols);
      const clickedColumn = Math.floor((event.clientX - rowRect.left) / Math.max(1, characterWidth));
      const clickedUrl = rowUrls.find(
        (candidate) => clickedColumn >= candidate.index && clickedColumn <= candidate.index + candidate.url.length
      );

      if (clickedUrl) {
        openUrl(clickedUrl.url);
      }
    };
    document.addEventListener("click", handleTerminalClick, true);

    const resizeObserver = new ResizeObserver(() => fitAndResize());
    resizeObserver.observe(host);

    const inputDisposable = terminal.onData((data) => {
      window.wmux?.terminal.input({ id: sessionId, data });
    });

    const linkProviderDisposable = terminal.registerLinkProvider({
      provideLinks(bufferLineNumber, callback) {
        const line = terminal.buffer.active.getLine(bufferLineNumber) ?? terminal.buffer.active.getLine(bufferLineNumber - 1);
        const text = line?.translateToString(true) ?? "";
        const links = extractTerminalUrls(text)
          .map((match) => {
            const startColumn = match.index + 1;
            const endColumn = startColumn + match.url.length;

            return {
              range: {
                start: { x: startColumn, y: bufferLineNumber },
                end: { x: endColumn, y: bufferLineNumber }
              },
              text: match.url,
              decorations: {
                pointerCursor: true,
                underline: true
              },
              activate: (_event: MouseEvent, textToOpen: string): void => {
                onOpenUrlRef.current?.(textToOpen);
              }
            };
          })

        callback(links.length > 0 ? links : undefined);
      }
    });

    const removeDataListener = window.wmux?.terminal.onData(({ id, data }) => {
      if (id === sessionId) {
        terminal.write(data);
      }
    });

    const removeExitListener = window.wmux?.terminal.onExit(({ id, exitCode }) => {
      if (id === sessionId) {
        terminal.writeln("");
        terminal.writeln(`\x1b[33m[wmux]\x1b[0m terminal exited with code ${exitCode}`);
      }
    });

    queueMicrotask(() => {
      fitAndResize();
      void window.wmux?.terminal.create({
        id: sessionId,
        cwd,
        shell,
        cols: terminal.cols,
        rows: terminal.rows
      });
    });

    return () => {
      resizeObserver.disconnect();
      host.removeEventListener("mousedown", focusTerminal);
      host.removeEventListener("contextmenu", handleTerminalContextMenu, { capture: true });
      document.removeEventListener("click", handleTerminalClick, true);
      inputDisposable.dispose();
      selectionChangeDisposable.dispose();
      linkProviderDisposable.dispose();
      removeDataListener?.();
      removeExitListener?.();
      const disposeTimer = window.setTimeout(() => {
        pendingTerminalDisposeTimers.delete(sessionId);
        window.wmux?.terminal.dispose({ id: sessionId });
      }, 800);
      pendingTerminalDisposeTimers.set(sessionId, disposeTimer);
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, [cwd, sessionId, shell]);

  return (
    <div className="terminalSurface">
      <div className="terminalHeader">
        <span className="terminalPrompt">
          <Code2 size={14} />
          {surface.subtitle}
        </span>
        <span className="terminalState">
          <Activity size={13} />
          {statusLabels[surface.status]}
        </span>
      </div>
      <div className="terminalHost" ref={hostRef} />
    </div>
  );
}

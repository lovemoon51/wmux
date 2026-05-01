import { FitAddon } from "@xterm/addon-fit";
import { Terminal as XTerm } from "@xterm/xterm";
import { Activity, Code2, Minus, Plus } from "lucide-react";
import { useEffect, useRef, useState, type ReactElement } from "react";
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

const minTerminalFontSize = 10;
const maxTerminalFontSize = 20;
const defaultTerminalFontSize = 13;

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
  onOpenUrl,
  onOutput
}: {
  surface: Surface;
  cwd: string;
  shell: ShellProfile;
  onOpenUrl?: (url: string) => void;
  onOutput?: (surfaceId: string, output: string) => void;
}): ReactElement {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const onOpenUrlRef = useRef(onOpenUrl);
  const onOutputRef = useRef(onOutput);
  const lastSelectionRef = useRef("");
  const sessionId = `${surface.id}:${shell}`;
  const [fontSize, setFontSize] = useState(defaultTerminalFontSize);

  useEffect(() => {
    onOpenUrlRef.current = onOpenUrl;
  }, [onOpenUrl]);

  useEffect(() => {
    onOutputRef.current = onOutput;
  }, [onOutput]);

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
      fontFamily: '"JetBrains Mono", "Cascadia Code", "SFMono-Regular", Consolas, monospace',
      fontSize,
      lineHeight: 1.32,
      theme: {
        background: "#101214",
        foreground: "#d7dee7",
        cursor: "#3daee9",
        cursorAccent: "#101214",
        selectionBackground: "#314253",
        selectionForeground: "#eceff3",
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
      try {
        fitAddon.fit();
        window.wmux?.terminal.resize({
          id: sessionId,
          cols: terminal.cols,
          rows: terminal.rows
        });
      } catch {
        // xterm can throw while the surface is being unmounted or hidden.
      }
    };

    const focusTerminal = (event: MouseEvent): void => {
      if (event.button === 0) {
        terminal.focus();
      }
    };
    host.addEventListener("mousedown", focusTerminal);

    const applyFontSize = (nextFontSize: number): void => {
      terminal.options.fontSize = nextFontSize;
      window.setTimeout(() => fitAndResize(), 0);
    };

    const handleWheel = (event: WheelEvent): void => {
      if (!event.ctrlKey) {
        return;
      }
      event.preventDefault();
      setFontSize((currentFontSize) => {
        const nextFontSize = Math.min(
          maxTerminalFontSize,
          Math.max(minTerminalFontSize, currentFontSize + (event.deltaY < 0 ? 1 : -1))
        );
        applyFontSize(nextFontSize);
        return nextFontSize;
      });
    };
    host.addEventListener("wheel", handleWheel, { passive: false });

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
        onOutputRef.current?.(surface.id, data);
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
      host.removeEventListener("wheel", handleWheel);
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

  const adjustFontSize = (delta: number): void => {
    setFontSize((currentFontSize) => {
      const nextFontSize = Math.min(maxTerminalFontSize, Math.max(minTerminalFontSize, currentFontSize + delta));
      const terminal = terminalRef.current;
      const fitAddon = fitAddonRef.current;
      if (terminal && fitAddon) {
        terminal.options.fontSize = nextFontSize;
        window.setTimeout(() => {
          try {
            fitAddon.fit();
            window.wmux?.terminal.resize({
              id: sessionId,
              cols: terminal.cols,
              rows: terminal.rows
            });
          } catch {
            // Ignore resize races during surface transitions.
          }
        }, 0);
      }
      return nextFontSize;
    });
  };

  return (
    <div className="terminalSurface">
      <div className="terminalHeader">
        <span className="terminalPrompt">
          <Code2 size={13} />
          <span className="terminalPromptText">{surface.subtitle || shell}</span>
        </span>
        <span className="terminalState">
          <Activity size={12} />
          {statusLabels[surface.status]}
        </span>
        <span className="terminalFontControls">
          <button
            className="iconButton"
            type="button"
            aria-label="Decrease terminal font size"
            title="Decrease font size (Ctrl+Scroll)"
            onClick={() => adjustFontSize(-1)}
          >
            <Minus size={10} />
          </button>
          <button
            className="iconButton"
            type="button"
            aria-label="Increase terminal font size"
            title="Increase font size (Ctrl+Scroll)"
            onClick={() => adjustFontSize(1)}
          >
            <Plus size={10} />
          </button>
        </span>
      </div>
      <div className="terminalHost" ref={hostRef} />
    </div>
  );
}

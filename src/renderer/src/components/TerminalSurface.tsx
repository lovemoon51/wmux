import { FitAddon } from "@xterm/addon-fit";
import { Terminal as XTerm } from "@xterm/xterm";
import { Activity, Code2, Minus, Plus } from "lucide-react";
import { useEffect, useRef, useState, type ReactElement } from "react";
import type { ShellProfile, Surface, WorkspaceStatus } from "@shared/types";
import "@xterm/xterm/css/xterm.css";

const statusLabels: Record<WorkspaceStatus, string> = {
  idle: "Idle",
  running: "Running",
  attention: "Needs input",
  success: "Done",
  error: "Error"
};

const pendingTerminalDisposeTimers = new Map<string, number>();

// Track live terminal instances for font-size adjustment
const terminalInstances = new Map<string, { terminal: XTerm; fitAddon: FitAddon }>();

const MIN_FONT_SIZE = 10;
const MAX_FONT_SIZE = 20;
const DEFAULT_FONT_SIZE = 13;

export function TerminalSurface({
  surface,
  cwd,
  shell
}: {
  surface: Surface;
  cwd: string;
  shell: ShellProfile;
}): ReactElement {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const sessionId = `${surface.id}:${shell}`;
  const [isRunning, setIsRunning] = useState(surface.status === "running");
  const [fontSize, setFontSize] = useState(DEFAULT_FONT_SIZE);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) {
      return;
    }

    // Cancel any pending dispose for this session
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
    terminalInstances.set(sessionId, { terminal, fitAddon });

    const fitAndResize = (): void => {
      try {
        fitAddon.fit();
        window.wmux?.terminal.resize({
          id: sessionId,
          cols: terminal.cols,
          rows: terminal.rows
        });
      } catch {
        // Ignore resize errors during unmount
      }
    };

    const focusTerminal = (): void => terminal.focus();
    host.addEventListener("mousedown", focusTerminal);

    // Ctrl+Scroll to change font size
    const handleWheel = (event: WheelEvent): void => {
      if (event.ctrlKey) {
        event.preventDefault();
        setFontSize((prev) => {
          const next = event.deltaY < 0 ? prev + 1 : prev - 1;
          const clamped = Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, next));
          terminal.options.fontSize = clamped;
          window.setTimeout(() => fitAndResize(), 0);
          return clamped;
        });
      }
    };
    host.addEventListener("wheel", handleWheel, { passive: false });

    const resizeObserver = new ResizeObserver(() => fitAndResize());
    resizeObserver.observe(host);

    const inputDisposable = terminal.onData((data) => {
      window.wmux?.terminal.input({ id: sessionId, data });
    });

    const removeDataListener = window.wmux?.terminal.onData(({ id, data }) => {
      if (id === sessionId) {
        terminal.write(data);
        setIsRunning(true);
      }
    });

    const removeExitListener = window.wmux?.terminal.onExit(({ id, exitCode }) => {
      if (id === sessionId) {
        setIsRunning(false);
        terminal.writeln("");
        terminal.writeln(
          exitCode === 0
            ? `\x1b[32m[wmux]\x1b[0m process exited (code 0)`
            : `\x1b[33m[wmux]\x1b[0m process exited with code ${exitCode}`
        );
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
      inputDisposable.dispose();
      removeDataListener?.();
      removeExitListener?.();
      terminalInstances.delete(sessionId);
      const disposeTimer = window.setTimeout(() => {
        pendingTerminalDisposeTimers.delete(sessionId);
        window.wmux?.terminal.dispose({ id: sessionId });
      }, 800);
      pendingTerminalDisposeTimers.set(sessionId, disposeTimer);
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cwd, sessionId, shell]);

  const adjustFontSize = (delta: number): void => {
    setFontSize((prev) => {
      const next = Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, prev + delta));
      const instance = terminalInstances.get(sessionId);
      if (instance) {
        instance.terminal.options.fontSize = next;
        window.setTimeout(() => {
          try {
            instance.fitAddon.fit();
            window.wmux?.terminal.resize({
              id: sessionId,
              cols: instance.terminal.cols,
              rows: instance.terminal.rows
            });
          } catch {
            // ignore
          }
        }, 0);
      }
      return next;
    });
  };

  const liveStatus = isRunning ? "running" : surface.status;

  return (
    <div className="terminalSurface">
      <div className="terminalHeader">
        <span className="terminalPrompt">
          <Code2 size={13} />
          <span className="terminalPromptText">{surface.subtitle || shell}</span>
        </span>
        <span className="terminalState">
          <Activity size={12} />
          {statusLabels[liveStatus]}
        </span>
        <span style={{ display: "inline-flex", gap: 2, marginLeft: 6 }}>
          <button
            className="iconButton"
            type="button"
            aria-label="Decrease font size"
            title="Decrease font size (Ctrl+Scroll)"
            style={{ width: 20, height: 20 }}
            onClick={() => adjustFontSize(-1)}
          >
            <Minus size={10} />
          </button>
          <button
            className="iconButton"
            type="button"
            aria-label="Increase font size"
            title="Increase font size (Ctrl+Scroll)"
            style={{ width: 20, height: 20 }}
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

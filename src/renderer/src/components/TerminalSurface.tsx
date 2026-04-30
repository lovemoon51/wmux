import { FitAddon } from "@xterm/addon-fit";
import { Terminal as XTerm } from "@xterm/xterm";
import { Activity, Code2 } from "lucide-react";
import { useEffect, useRef, type ReactElement } from "react";
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

    const focusTerminal = (): void => terminal.focus();
    host.addEventListener("mousedown", focusTerminal);

    const resizeObserver = new ResizeObserver(() => fitAndResize());
    resizeObserver.observe(host);

    const inputDisposable = terminal.onData((data) => {
      window.wmux?.terminal.input({ id: sessionId, data });
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
      inputDisposable.dispose();
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

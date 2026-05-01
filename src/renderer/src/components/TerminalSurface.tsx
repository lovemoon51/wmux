import { FitAddon } from "@xterm/addon-fit";
import { LigaturesAddon } from "@xterm/addon-ligatures";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebglAddon } from "@xterm/addon-webgl";
import { Terminal as XTerm } from "@xterm/xterm";
import { Activity, Code2, Minus, Plus } from "lucide-react";
import { useEffect, useRef, useState, type ReactElement } from "react";
import type { ShellProfile, Surface, WorkspaceStatus } from "@shared/types";
import "@xterm/xterm/css/xterm.css";

// 终端字体栈：优先 Nerd Font 与等宽字体，最终退回 monospace
const terminalFontStack =
  '"JetBrainsMono Nerd Font", "JetBrains Mono", "Cascadia Code", "Fira Code", "SFMono-Regular", Consolas, monospace';

// URL 识别正则：兼容 smoke dispatchEvent 模拟点击的 DOM 路径
const terminalUrlPattern = /https?:\/\/[^\s"'<>]+/gi;
const terminalUrlTrailingPunctuationPattern = /[),.;\]}]+$/;

function extractTerminalUrls(text: string): Array<{ url: string; index: number }> {
  return Array.from(text.matchAll(terminalUrlPattern))
    .map((match) => ({
      url: match[0].replace(terminalUrlTrailingPunctuationPattern, ""),
      index: match.index ?? 0
    }))
    .filter((match) => match.url.length > "https://".length);
}

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
      // unicode11 addon 需要 proposed API 才能切换 activeVersion
      allowProposedApi: true,
      cursorBlink: true,
      convertEol: true,
      fontFamily: terminalFontStack,
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

    // Unicode11：解决中文 / emoji 宽字符显示
    const unicode11Addon = new Unicode11Addon();
    terminal.loadAddon(unicode11Addon);
    terminal.unicode.activeVersion = "11";

    terminal.open(host);
    terminal.focus();

    // Smoke 模式禁用 WebGL/Ligatures：自动化用 textContent 断言，Canvas 渲染不入 DOM
    const smokeMode = window.wmux?.isSmokeMode?.() ?? false;

    // WebGL：GPU 加速渲染；在 open 之后加载，contextLoss 时退回 canvas
    let webglAddon: WebglAddon | null = null;
    if (!smokeMode) {
      try {
        webglAddon = new WebglAddon();
        webglAddon.onContextLoss(() => {
          // GPU 上下文丢失：dispose addon，xterm 自动退回 DOM/canvas 渲染器
          webglAddon?.dispose();
          webglAddon = null;
        });
        terminal.loadAddon(webglAddon);
      } catch (error) {
        // WebGL2 不可用：保持默认 DOM 渲染器
        console.warn("[wmux] WebGL renderer unavailable, falling back", error);
        webglAddon = null;
      }
    }

    // Ligatures：必须在 webgl 之后加载（仅在 webgl 渲染下生效）
    let ligaturesAddon: LigaturesAddon | null = null;
    if (webglAddon) {
      try {
        ligaturesAddon = new LigaturesAddon();
        terminal.loadAddon(ligaturesAddon);
      } catch (error) {
        console.warn("[wmux] Ligatures addon failed to load", error);
        ligaturesAddon = null;
      }
    }

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

    // 终端 URL 点击路由：document 级 capture 监听器，兼容 smoke dispatchEvent 模拟
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

    // xterm 内置 link provider：为 hover/underline 装饰提供 buffer 路径识别
    const linkProviderDisposable = terminal.registerLinkProvider({
      provideLinks(bufferLineNumber, callback) {
        const line =
          terminal.buffer.active.getLine(bufferLineNumber) ??
          terminal.buffer.active.getLine(bufferLineNumber - 1);
        const text = line?.translateToString(true) ?? "";
        const links = extractTerminalUrls(text).map((match) => {
          const startColumn = match.index + 1;
          const endColumn = startColumn + match.url.length;
          return {
            range: {
              start: { x: startColumn, y: bufferLineNumber },
              end: { x: endColumn, y: bufferLineNumber }
            },
            text: match.url,
            decorations: { pointerCursor: true, underline: true },
            activate: (_event: MouseEvent, textToOpen: string): void => {
              onOpenUrlRef.current?.(textToOpen);
            }
          };
        });
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
      ligaturesAddon?.dispose();
      webglAddon?.dispose();
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

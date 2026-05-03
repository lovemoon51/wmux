import { FitAddon } from "@xterm/addon-fit";
import { LigaturesAddon } from "@xterm/addon-ligatures";
import { SearchAddon } from "@xterm/addon-search";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebglAddon } from "@xterm/addon-webgl";
import { Terminal as XTerm } from "@xterm/xterm";
import { Activity, Code2, Minus, Plus } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import type { Block, BlockEvent, ShellProfile, Surface, TerminalInputModeEvent, WorkspaceStatus } from "@shared/types";
import { BlockOverlay } from "./BlockOverlay";
import { InputEditor } from "./InputEditor";
import {
  createModernInputState,
  reduceModernInputState,
  shouldModernInputCapture,
  type ModernInputState
} from "../lib/inputEditorState";
import { prepareCommandSubmission } from "../lib/inputSubmission";
import "@xterm/xterm/css/xterm.css";

// 终端字体栈：优先 Nerd Font 与等宽字体，最终退回 monospace
const terminalFontStack =
  '"JetBrainsMono Nerd Font", "JetBrains Mono", "Cascadia Code", "Fira Code", "SFMono-Regular", Consolas, monospace';

// 模块级 SearchAddon 注册表：避免 LayoutRenderer/PaneView/SurfaceBody 4 层 prop drilling
// 由 App.tsx 在挂载时通过 setTerminalSearchHandlers 注入回调
type TerminalSearchHandlers = {
  onSearchReady?: (surfaceId: string, addon: SearchAddon) => () => void;
  onRequestFind?: (surfaceId: string) => void;
  onRequestHistorySearch?: () => void;
};
const terminalSearchHandlers: TerminalSearchHandlers = {};
const terminalInputDraftHandlers = new Map<string, (text: string) => boolean>();

export function setTerminalSearchHandlers(handlers: TerminalSearchHandlers): void {
  terminalSearchHandlers.onSearchReady = handlers.onSearchReady;
  terminalSearchHandlers.onRequestFind = handlers.onRequestFind;
  terminalSearchHandlers.onRequestHistorySearch = handlers.onRequestHistorySearch;
}

export function writeTerminalInputDraft(surfaceId: string, text: string): boolean {
  return terminalInputDraftHandlers.get(surfaceId)?.(text) ?? false;
}

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
  workspaceId,
  cwd,
  shell,
  onOpenUrl,
  onOutput
}: {
  surface: Surface;
  workspaceId: string;
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
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [focusedBlockId, setFocusedBlockId] = useState<string | undefined>();
  const [viewportY, setViewportY] = useState(0);
  const [modernInputState, setModernInputState] = useState<ModernInputState>(() => createModernInputState());
  const [inputDraft, setInputDraft] = useState("");
  const [inputFocusToken, setInputFocusToken] = useState(0);
  const blocksRef = useRef<Block[]>([]);
  const focusedBlockIdRef = useRef<string | undefined>(undefined);
  const modernInputStateRef = useRef(modernInputState);
  const inputDraftRef = useRef(inputDraft);
  const isModernInputCaptured = shouldModernInputCapture(modernInputState);

  useEffect(() => {
    onOpenUrlRef.current = onOpenUrl;
  }, [onOpenUrl]);

  useEffect(() => {
    onOutputRef.current = onOutput;
  }, [onOutput]);

  useEffect(() => {
    blocksRef.current = blocks;
  }, [blocks]);

  useEffect(() => {
    focusedBlockIdRef.current = focusedBlockId;
  }, [focusedBlockId]);

  useEffect(() => {
    modernInputStateRef.current = modernInputState;
  }, [modernInputState]);

  useEffect(() => {
    inputDraftRef.current = inputDraft;
  }, [inputDraft]);

  const focusBlock = useCallback((blockId: string): void => {
    setFocusedBlockId(blockId);
    const terminal = terminalRef.current;
    const block = blocksRef.current.find((item) => item.id === blockId);
    if (!terminal || !block) {
      return;
    }
    const currentViewport = terminal.buffer.active.viewportY;
    terminal.scrollLines(block.startLine - currentViewport);
    setViewportY(terminal.buffer.active.viewportY);
  }, []);

  const focusBlockByOffset = useCallback((offset: number): void => {
    const currentBlocks = blocksRef.current;
    if (currentBlocks.length === 0) {
      return;
    }
    const currentIndex = Math.max(
      0,
      currentBlocks.findIndex((block) => block.id === focusedBlockIdRef.current)
    );
    const nextIndex = Math.max(0, Math.min(currentBlocks.length - 1, currentIndex + offset));
    focusBlock(currentBlocks[nextIndex].id);
  }, [focusBlock]);

  const copyBlock = useCallback((block: Block, mode: "command" | "all"): void => {
    const commandText = block.command.trim();
    if (!commandText) {
      return;
    }
    const text = mode === "command" ? commandText : `$ ${commandText}`;
    window.wmux?.clipboard.writeText(text);
  }, []);

  const rerunBlock = useCallback((block: Block): void => {
    const commandText = block.command.trim();
    if (!commandText) {
      return;
    }
    if (shouldModernInputCapture(modernInputStateRef.current)) {
      setInputDraft(commandText);
      setInputFocusToken((token) => token + 1);
      return;
    }
    window.wmux?.terminal.input({ id: sessionId, data: commandText });
  }, [sessionId]);

  const dispatchModernInputEvent = useCallback((event: Parameters<typeof reduceModernInputState>[1]): void => {
    setModernInputState((currentState) => reduceModernInputState(currentState, event));
  }, []);

  const setInputDraftAndFocus = useCallback((text: string): boolean => {
    if (!shouldModernInputCapture(modernInputStateRef.current)) {
      return false;
    }
    setInputDraft(text);
    inputDraftRef.current = text;
    setInputFocusToken((token) => token + 1);
    return true;
  }, []);

  useEffect(() => {
    terminalInputDraftHandlers.set(surface.id, setInputDraftAndFocus);
    return () => {
      terminalInputDraftHandlers.delete(surface.id);
    };
  }, [setInputDraftAndFocus, surface.id]);

  const focusInput = useCallback((): void => {
    if (shouldModernInputCapture(modernInputStateRef.current)) {
      setInputFocusToken((token) => token + 1);
      return;
    }
    terminalRef.current?.focus();
  }, []);

  const submitInputDraft = useCallback((): void => {
    const submission = prepareCommandSubmission(inputDraftRef.current);
    if (submission.kind === "empty") {
      setInputDraft("");
      setInputFocusToken((token) => token + 1);
      return;
    }
    window.wmux?.terminal.input({ id: sessionId, data: submission.data });
    setInputDraft("");
    dispatchModernInputEvent({ type: "command:started" });
  }, [dispatchModernInputEvent, sessionId]);

  const interruptTerminal = useCallback((): void => {
    window.wmux?.terminal.input({ id: sessionId, data: "\x03" });
    setInputDraft("");
    dispatchModernInputEvent({ type: "command:started" });
  }, [dispatchModernInputEvent, sessionId]);

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

    // Search：暴露给父级管理 FindBar 操作
    const searchAddon = new SearchAddon();
    terminal.loadAddon(searchAddon);

    // Ctrl/Cmd+F 拦截：在 xterm 处理 keystroke 之前打开 FindBar
    terminal.attachCustomKeyEventHandler((event) => {
      if (event.type !== "keydown") {
        return true;
      }
      const isPrimary = event.ctrlKey || event.metaKey;
      if (isPrimary && !event.altKey && !event.shiftKey && event.key === "ArrowUp") {
        focusBlockByOffset(-1);
        return false;
      }
      if (isPrimary && !event.altKey && !event.shiftKey && event.key === "ArrowDown") {
        focusBlockByOffset(1);
        return false;
      }
      if (isPrimary && event.shiftKey && !event.altKey && event.key.toLowerCase() === "c") {
        const block = blocksRef.current.find((item) => item.id === focusedBlockIdRef.current);
        if (block) {
          copyBlock(block, "all");
          return false;
        }
      }
      if (isPrimary && event.shiftKey && !event.altKey && event.key.toLowerCase() === "r") {
        const block = blocksRef.current.find((item) => item.id === focusedBlockIdRef.current);
        if (block) {
          rerunBlock(block);
          return false;
        }
      }
      if (isPrimary && !event.altKey && event.key.toLowerCase() === "f") {
        terminalSearchHandlers.onRequestFind?.(surface.id);
        return false;
      }
      if (isPrimary && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "r") {
        terminalSearchHandlers.onRequestHistorySearch?.();
        return false;
      }
      return true;
    });

    terminal.open(host);
    terminal.focus();

    // 注册 SearchAddon 到父级 ref Map，cleanup 时注销
    const releaseSearch = terminalSearchHandlers.onSearchReady?.(surface.id, searchAddon);

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
        setViewportY(terminal.buffer.active.viewportY);
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
        if (shouldModernInputCapture(modernInputStateRef.current)) {
          setInputFocusToken((token) => token + 1);
          return;
        }
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

    const storeSelection = (selection: string): string => {
      if (selection.trim()) {
        lastSelectionRef.current = selection;
      }
      return selection;
    };

    const rememberTerminalSelection = (): string => {
      const selection = terminal.getSelection() || window.getSelection()?.toString() || "";
      return storeSelection(selection);
    };

    let dragSelectionStart: { x: number; y: number } | null = null;

    const readDragSelection = (start: { x: number; y: number }, end: { x: number; y: number }): string => {
      const rows = Array.from(host.querySelectorAll<HTMLElement>(".xterm-rows > div"));
      const rowAt = (y: number): number =>
        rows.findIndex((row) => {
          const rect = row.getBoundingClientRect();
          return y >= rect.top && y <= rect.bottom;
        });
      const startRowIndex = rowAt(start.y);
      const endRowIndex = rowAt(end.y);
      if (startRowIndex < 0 || endRowIndex < 0) {
        return "";
      }

      const columnAt = (row: HTMLElement, x: number, mode: "start" | "end"): number => {
        const text = row.textContent ?? "";
        const rect = row.getBoundingClientRect();
        const screenWidth = terminal.element?.querySelector<HTMLElement>(".xterm-screen")?.getBoundingClientRect().width;
        const characterWidth = (screenWidth || rect.width) / Math.max(1, terminal.cols);
        const rawColumn = (x - rect.left) / Math.max(1, characterWidth);
        const column = mode === "start" ? Math.floor(rawColumn) : Math.ceil(rawColumn);
        return Math.max(0, Math.min(text.length, column));
      };

      if (startRowIndex === endRowIndex) {
        const row = rows[startRowIndex];
        const text = row.textContent ?? "";
        const startColumn = columnAt(row, start.x, "start");
        const endColumn = columnAt(row, end.x, "end");
        return text.slice(Math.min(startColumn, endColumn), Math.max(startColumn, endColumn));
      }

      const firstRowIndex = Math.min(startRowIndex, endRowIndex);
      const lastRowIndex = Math.max(startRowIndex, endRowIndex);
      return rows
        .slice(firstRowIndex, lastRowIndex + 1)
        .map((row, index, selectedRows) => {
          const text = row.textContent ?? "";
          if (index === 0) {
            return text.slice(columnAt(row, firstRowIndex === startRowIndex ? start.x : end.x, "start"));
          }
          if (index === selectedRows.length - 1) {
            return text.slice(0, columnAt(row, lastRowIndex === endRowIndex ? end.x : start.x, "end"));
          }
          return text;
        })
        .join("\n");
    };

    const selectionChangeDisposable = terminal.onSelectionChange(() => {
      rememberTerminalSelection();
    });

    const captureSelectionDragStart = (event: MouseEvent): void => {
      if (event.button === 0) {
        dragSelectionStart = { x: event.clientX, y: event.clientY };
      }
    };
    host.addEventListener("mousedown", captureSelectionDragStart);

    const captureSelectionAfterMouseUp = (event: MouseEvent): void => {
      const dragStart = dragSelectionStart;
      dragSelectionStart = null;
      const dragEnd = { x: event.clientX, y: event.clientY };
      const selection = rememberTerminalSelection();
      const distance = dragStart ? Math.hypot(dragEnd.x - dragStart.x, dragEnd.y - dragStart.y) : 0;
      if (!selection.trim() && dragStart && distance > 4) {
        storeSelection(readDragSelection(dragStart, dragEnd));
      }
    };
    host.addEventListener("mouseup", captureSelectionAfterMouseUp);

    const captureSelectionBeforeContextMenu = (event: MouseEvent): void => {
      if (event.button === 2) {
        rememberTerminalSelection();
      }
    };
    host.addEventListener("mousedown", captureSelectionBeforeContextMenu, { capture: true });

    const handleTerminalContextMenu = (event: MouseEvent): void => {
      const activeSelection = rememberTerminalSelection();
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
        if (shouldModernInputCapture(modernInputStateRef.current)) {
          setInputDraft((currentValue) => `${currentValue}${text.replace(/\r\n/g, "\n").replace(/\r/g, "\n")}`);
          setInputFocusToken((token) => token + 1);
        } else {
          terminal.paste(text);
        }
      }
      focusInput();
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

    const scrollDisposable = terminal.onScroll((nextViewportY) => {
      setViewportY(nextViewportY);
    });

    const inputDisposable = terminal.onData((data) => {
      if (shouldModernInputCapture(modernInputStateRef.current)) {
        if (data === "\x03" || data === "\x04") {
          window.wmux?.terminal.input({ id: sessionId, data });
        }
        return;
      }
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
        setViewportY(terminal.buffer.active.viewportY);
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
        surfaceId: surface.id,
        workspaceId,
        cwd,
        shell,
        cols: terminal.cols,
        rows: terminal.rows
      });
    });

    return () => {
      resizeObserver.disconnect();
      host.removeEventListener("mousedown", focusTerminal);
      host.removeEventListener("mousedown", captureSelectionDragStart);
      host.removeEventListener("mousedown", captureSelectionBeforeContextMenu, { capture: true });
      host.removeEventListener("mouseup", captureSelectionAfterMouseUp);
      host.removeEventListener("wheel", handleWheel);
      host.removeEventListener("contextmenu", handleTerminalContextMenu, { capture: true });
      document.removeEventListener("click", handleTerminalClick, true);
      inputDisposable.dispose();
      scrollDisposable.dispose();
      selectionChangeDisposable.dispose();
      linkProviderDisposable.dispose();
      releaseSearch?.();
      searchAddon.dispose();
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
  }, [copyBlock, cwd, focusBlockByOffset, focusInput, fontSize, rerunBlock, sessionId, shell, surface.id, workspaceId]);

  useEffect(() => {
    setBlocks([]);
    blocksRef.current = [];
    setFocusedBlockId(undefined);
    focusedBlockIdRef.current = undefined;
    const removeBlockListener = window.wmux?.terminal.onBlock?.((event: BlockEvent) => {
      if (event.surfaceId !== surface.id) {
        return;
      }
      setBlocks((currentBlocks) => {
        if (event.type === "block:list") {
          return event.blocks.map((block) => ({ ...block }));
        }
        if (event.type === "block:start") {
          return [...currentBlocks.filter((block) => block.id !== event.block.id), { ...event.block }];
        }
        if (event.type === "block:command") {
          return currentBlocks.map((block) =>
            block.id === event.blockId ? { ...block, command: event.command } : block
          );
        }
        if (event.type === "block:output") {
          return currentBlocks;
        }
        if (event.type === "block:end") {
          const terminal = terminalRef.current;
          const endLine = terminal ? terminal.buffer.active.baseY + terminal.buffer.active.cursorY : undefined;
          return currentBlocks.map((block) =>
            block.id === event.blockId
              ? {
                  ...block,
                  endedAt: event.endedAt,
                  exitCode: event.exitCode,
                  status: event.exitCode === 0 ? "success" : "error",
                  durationMs: Math.max(0, Date.parse(event.endedAt) - Date.parse(block.startedAt)),
                  endLine
                }
              : block
          );
        }
        return currentBlocks;
      });
      if (event.type === "block:start") {
        setFocusedBlockId(event.block.id);
      }
    });

    return () => removeBlockListener?.();
  }, [surface.id]);

  useEffect(() => {
    setModernInputState(createModernInputState());
    setInputDraft("");
    const removeInputModeListener = window.wmux?.terminal.onInputMode?.((event: TerminalInputModeEvent) => {
      if (event.surfaceId !== surface.id || event.sessionId !== sessionId) {
        return;
      }
      if (event.type === "input:prompt-ready") {
        dispatchModernInputEvent({ type: "prompt:ready" });
        setInputFocusToken((token) => token + 1);
        return;
      }
      if (event.type === "input:command-started") {
        dispatchModernInputEvent({ type: "command:started" });
        setInputDraft("");
        return;
      }
      if (event.type === "input:alt-screen") {
        dispatchModernInputEvent({ type: event.active ? "altScreen:enter" : "altScreen:leave" });
      }
    });

    return () => removeInputModeListener?.();
  }, [dispatchModernInputEvent, sessionId, surface.id]);

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
      <div className="terminalHostWrap">
        <div className="terminalHost" ref={hostRef} />
        <BlockOverlay
          blocks={blocks}
          focusedBlockId={focusedBlockId}
          terminalHost={hostRef.current}
          viewportY={viewportY}
          onFocusBlock={focusBlock}
          onCopyBlock={copyBlock}
          onRerunBlock={rerunBlock}
        />
        {isModernInputCaptured && (
          <div className="terminalInputOverlay" onMouseDown={(event) => event.stopPropagation()}>
            <InputEditor
              value={inputDraft}
              enabled={isModernInputCaptured}
              focusToken={inputFocusToken}
              cwd={cwd}
              shell={shell}
              surfaceId={surface.id}
              workspaceId={workspaceId}
              onChange={setInputDraft}
              onSubmit={submitInputDraft}
              onInterrupt={interruptTerminal}
              onToggleCapture={() => dispatchModernInputEvent({ type: "manualToggle" })}
            />
          </div>
        )}
      </div>
    </div>
  );
}

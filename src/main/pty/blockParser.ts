import type { Block, BlockEvent, BlockId, TerminalInputModeEvent } from "../../shared/types";

type ParserPhase = "idle" | "prompt" | "command" | "output";

export type BlockParserState = {
  phase: ParserPhase;
  pendingOsc: string;
  pendingCsi: string;
  currentBlock?: Block;
  commandBuffer: string;
  outputByteOffset: number;
  nextBlockNumber: number;
};

export type BlockParserInput = {
  sessionId: string;
  surfaceId: string;
  workspaceId?: string;
  shell?: string;
  cwd?: string;
  data: string;
  startLine: number;
  now?: Date;
};

export type BlockParserResult = {
  cleaned: string;
  events: BlockEvent[];
  inputModeEvents: TerminalInputModeEvent[];
};

const oscPrefix = "\x1b]";
const bel = "\x07";
const st = "\x1b\\";

export function createBlockParserState(): BlockParserState {
  return {
    phase: "idle",
    pendingOsc: "",
    pendingCsi: "",
    commandBuffer: "",
    outputByteOffset: 0,
    nextBlockNumber: 1
  };
}

export function parseTerminalBlocks(state: BlockParserState, input: BlockParserInput): BlockParserResult {
  const events: BlockEvent[] = [];
  const inputModeEvents: TerminalInputModeEvent[] = [];
  const cleanedParts: string[] = [];
  const combined = `${state.pendingOsc}${input.data}`;
  state.pendingOsc = "";

  let index = 0;
  while (index < combined.length) {
    const oscIndex = combined.indexOf(oscPrefix, index);
    if (oscIndex < 0) {
      appendCleanedText(state, combined.slice(index), cleanedParts, events, input, inputModeEvents);
      break;
    }

    appendCleanedText(state, combined.slice(index, oscIndex), cleanedParts, events, input, inputModeEvents);
    const terminator = findOscTerminator(combined, oscIndex + oscPrefix.length);
    if (!terminator) {
      state.pendingOsc = combined.slice(oscIndex);
      break;
    }

    const payload = combined.slice(oscIndex + oscPrefix.length, terminator.index);
    const handled = handleOscPayload(state, payload, events, inputModeEvents, input);
    if (!handled) {
      cleanedParts.push(combined.slice(oscIndex, terminator.endIndex));
    }
    index = terminator.endIndex;
  }

  return {
    cleaned: cleanedParts.join(""),
    events,
    inputModeEvents
  };
}

function appendCleanedText(
  state: BlockParserState,
  text: string,
  cleanedParts: string[],
  events: BlockEvent[],
  input: BlockParserInput,
  inputModeEvents: TerminalInputModeEvent[]
): void {
  if (!text) {
    return;
  }
  const csiText = consumeAltScreenSequences(state, text, inputModeEvents, input);
  cleanedParts.push(csiText);

  if (state.phase === "command") {
    state.commandBuffer += csiText;
    return;
  }

  if (state.phase === "output" && state.currentBlock) {
    const chunkBytes = Buffer.byteLength(csiText, "utf8");
    state.outputByteOffset += chunkBytes;
    events.push({
      type: "block:output",
      surfaceId: input.surfaceId,
      blockId: state.currentBlock.id,
      chunkBytes
    });
  }
}

function handleOscPayload(
  state: BlockParserState,
  payload: string,
  events: BlockEvent[],
  inputModeEvents: TerminalInputModeEvent[],
  input: BlockParserInput
): boolean {
  const parts = payload.split(";");
  if (parts[0] !== "133") {
    return false;
  }

  const marker = parts[1];
  if (marker === "A") {
    startBlock(state, events, input);
    return true;
  }
  if (marker === "B") {
    state.phase = "command";
    state.commandBuffer = "";
    inputModeEvents.push({
      type: "input:prompt-ready",
      surfaceId: input.surfaceId,
      sessionId: input.sessionId,
      source: "osc133"
    });
    return true;
  }
  if (marker === "C") {
    const command = commitCommand(state, events, input);
    inputModeEvents.push({
      type: "input:command-started",
      surfaceId: input.surfaceId,
      sessionId: input.sessionId,
      command
    });
    state.phase = "output";
    return true;
  }
  if (marker === "D") {
    endBlock(state, events, input, readExitCode(parts[2]));
    return true;
  }

  return true;
}

function startBlock(state: BlockParserState, events: BlockEvent[], input: BlockParserInput): void {
  const now = input.now ?? new Date();
  const block: Block = {
    id: createBlockId(input.sessionId, state.nextBlockNumber),
    surfaceId: input.surfaceId,
    workspaceId: input.workspaceId ?? "",
    startLine: Math.max(0, input.startLine),
    command: "",
    cwd: input.cwd,
    shell: input.shell,
    startedAt: now.toISOString(),
    status: "running",
    outputByteStart: state.outputByteOffset
  };
  state.nextBlockNumber += 1;
  state.currentBlock = block;
  state.phase = "prompt";
  state.commandBuffer = "";
  events.push({ type: "block:start", surfaceId: input.surfaceId, block: { ...block } });
}

function commitCommand(state: BlockParserState, events: BlockEvent[], input: BlockParserInput): string {
  const block = state.currentBlock;
  if (!block) {
    return "";
  }
  const command = normalizeCommandText(state.commandBuffer);
  block.command = command;
  events.push({
    type: "block:command",
    surfaceId: input.surfaceId,
    blockId: block.id,
    command
  });
  return command;
}

function endBlock(
  state: BlockParserState,
  events: BlockEvent[],
  input: BlockParserInput,
  exitCode: number
): void {
  const block = state.currentBlock;
  if (!block) {
    state.phase = "idle";
    state.commandBuffer = "";
    return;
  }

  const endedAt = (input.now ?? new Date()).toISOString();
  block.endedAt = endedAt;
  block.exitCode = exitCode;
  block.status = exitCode === 0 ? "success" : "error";
  block.durationMs = Math.max(0, Date.parse(endedAt) - Date.parse(block.startedAt));
  block.outputByteEnd = state.outputByteOffset;

  events.push({
    type: "block:end",
    surfaceId: input.surfaceId,
    blockId: block.id,
    exitCode,
    endedAt
  });
  state.currentBlock = undefined;
  state.phase = "idle";
  state.commandBuffer = "";
}

function findOscTerminator(value: string, startIndex: number): { index: number; endIndex: number } | null {
  const belIndex = value.indexOf(bel, startIndex);
  const stIndex = value.indexOf(st, startIndex);

  if (belIndex < 0 && stIndex < 0) {
    return null;
  }
  if (belIndex >= 0 && (stIndex < 0 || belIndex < stIndex)) {
    return { index: belIndex, endIndex: belIndex + bel.length };
  }
  return { index: stIndex, endIndex: stIndex + st.length };
}

function readExitCode(value: string | undefined): number {
  const exitCode = Number(value ?? 0);
  return Number.isInteger(exitCode) && exitCode >= 0 ? exitCode : 0;
}

function normalizeCommandText(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "").replace(/[\r\n]+/g, " ").trim();
}

const altScreenEnter = "\x1b[?1049h";
const altScreenLeave = "\x1b[?1049l";
// eslint-disable-next-line no-control-regex
const altScreenPattern = /\x1b\[\?1049([hl])/g;

function consumeAltScreenSequences(
  state: BlockParserState,
  text: string,
  inputModeEvents: TerminalInputModeEvent[],
  input: BlockParserInput
): string {
  const combined = `${state.pendingCsi}${text}`;
  state.pendingCsi = "";
  const pending = readTrailingAltScreenPrefix(combined);
  const completeText = pending ? combined.slice(0, -pending.length) : combined;
  state.pendingCsi = pending;
  emitAltScreenEvents(completeText, inputModeEvents, input);
  return completeText;
}

function emitAltScreenEvents(
  text: string,
  inputModeEvents: TerminalInputModeEvent[],
  input: BlockParserInput
): void {
  for (const match of text.matchAll(altScreenPattern)) {
    inputModeEvents.push({
      type: "input:alt-screen",
      surfaceId: input.surfaceId,
      sessionId: input.sessionId,
      active: match[1] === "h"
    });
  }
}

function readTrailingAltScreenPrefix(value: string): string {
  const candidates = [altScreenEnter, altScreenLeave];
  let longest = "";
  for (const candidate of candidates) {
    for (let length = 1; length < candidate.length; length += 1) {
      const prefix = candidate.slice(0, length);
      if (value.endsWith(prefix) && prefix.length > longest.length) {
        longest = prefix;
      }
    }
  }
  return longest;
}

function createBlockId(sessionId: string, blockNumber: number): BlockId {
  return `${sessionId.replace(/[^a-zA-Z0-9_-]/g, "_")}-block-${blockNumber}`;
}

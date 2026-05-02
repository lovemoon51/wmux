import type { Block, BlockEvent, BlockId } from "../../shared/types";

type ParserPhase = "idle" | "prompt" | "command" | "output";

export type BlockParserState = {
  phase: ParserPhase;
  pendingOsc: string;
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
};

const oscPrefix = "\x1b]";
const bel = "\x07";
const st = "\x1b\\";

export function createBlockParserState(): BlockParserState {
  return {
    phase: "idle",
    pendingOsc: "",
    commandBuffer: "",
    outputByteOffset: 0,
    nextBlockNumber: 1
  };
}

export function parseTerminalBlocks(state: BlockParserState, input: BlockParserInput): BlockParserResult {
  const events: BlockEvent[] = [];
  const cleanedParts: string[] = [];
  const combined = `${state.pendingOsc}${input.data}`;
  state.pendingOsc = "";

  let index = 0;
  while (index < combined.length) {
    const oscIndex = combined.indexOf(oscPrefix, index);
    if (oscIndex < 0) {
      appendCleanedText(state, combined.slice(index), cleanedParts, events, input);
      break;
    }

    appendCleanedText(state, combined.slice(index, oscIndex), cleanedParts, events, input);
    const terminator = findOscTerminator(combined, oscIndex + oscPrefix.length);
    if (!terminator) {
      state.pendingOsc = combined.slice(oscIndex);
      break;
    }

    const payload = combined.slice(oscIndex + oscPrefix.length, terminator.index);
    const handled = handleOscPayload(state, payload, events, input);
    if (!handled) {
      cleanedParts.push(combined.slice(oscIndex, terminator.endIndex));
    }
    index = terminator.endIndex;
  }

  return {
    cleaned: cleanedParts.join(""),
    events
  };
}

function appendCleanedText(
  state: BlockParserState,
  text: string,
  cleanedParts: string[],
  events: BlockEvent[],
  input: BlockParserInput
): void {
  if (!text) {
    return;
  }
  cleanedParts.push(text);

  if (state.phase === "command") {
    state.commandBuffer += text;
    return;
  }

  if (state.phase === "output" && state.currentBlock) {
    const chunkBytes = Buffer.byteLength(text, "utf8");
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
    return true;
  }
  if (marker === "C") {
    commitCommand(state, events, input);
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

function commitCommand(state: BlockParserState, events: BlockEvent[], input: BlockParserInput): void {
  const block = state.currentBlock;
  if (!block) {
    return;
  }
  const command = normalizeCommandText(state.commandBuffer);
  block.command = command;
  events.push({
    type: "block:command",
    surfaceId: input.surfaceId,
    blockId: block.id,
    command
  });
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

function createBlockId(sessionId: string, blockNumber: number): BlockId {
  return `${sessionId.replace(/[^a-zA-Z0-9_-]/g, "_")}-block-${blockNumber}`;
}

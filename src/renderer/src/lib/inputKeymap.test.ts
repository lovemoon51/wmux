import { describe, expect, it } from "vitest";
import { createModernInputState, reduceModernInputState } from "./inputEditorState";
import { mapInputKey } from "./inputKeymap";

const capturedState = reduceModernInputState(createModernInputState(), { type: "prompt:ready" });

describe("inputKeymap", () => {
  it("maps enter and shift-enter in captured mode", () => {
    expect(mapInputKey({ key: "Enter" }, capturedState)).toBe("submit");
    expect(mapInputKey({ key: "Enter", shiftKey: true }, capturedState)).toBe("insertNewline");
  });

  it("passes ordinary keys through when not captured", () => {
    expect(mapInputKey({ key: "a" }, createModernInputState())).toBe("passThrough");
  });

  it("maps terminal control and editor history shortcuts", () => {
    expect(mapInputKey({ key: "c", ctrlKey: true }, capturedState)).toBe("interrupt");
    expect(mapInputKey({ key: "z", ctrlKey: true }, capturedState)).toBe("undo");
    expect(mapInputKey({ key: "y", ctrlKey: true }, capturedState)).toBe("redo");
  });

  it("maps primary backtick to capture toggle", () => {
    expect(mapInputKey({ key: "`", ctrlKey: true }, capturedState)).toBe("toggleCapture");
  });
});

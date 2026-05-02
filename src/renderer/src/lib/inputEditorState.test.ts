import { describe, expect, it } from "vitest";
import {
  createModernInputState,
  reduceModernInputState,
  shouldModernInputCapture,
  type ModernInputState
} from "./inputEditorState";

function applyEvents(...events: Parameters<typeof reduceModernInputState>[1][]): ModernInputState {
  return events.reduce(reduceModernInputState, createModernInputState());
}

describe("inputEditorState", () => {
  it("captures after prompt ready and yields when command starts", () => {
    const ready = applyEvents({ type: "prompt:ready" });
    expect(shouldModernInputCapture(ready)).toBe(true);

    const running = reduceModernInputState(ready, { type: "command:started" });
    expect(shouldModernInputCapture(running)).toBe(false);
    expect(running.promptReady).toBe(false);
  });

  it("forces passthrough while alt-screen is active", () => {
    const active = applyEvents({ type: "prompt:ready" }, { type: "altScreen:enter" });
    expect(active.altScreenActive).toBe(true);
    expect(shouldModernInputCapture(active)).toBe(false);

    const inactive = reduceModernInputState(active, { type: "altScreen:leave" });
    expect(inactive.altScreenActive).toBe(false);
    expect(shouldModernInputCapture(inactive)).toBe(true);
  });

  it("respects disabled modern input", () => {
    const state = applyEvents({ type: "disableModernInput", disabled: true }, { type: "prompt:ready" });
    expect(state.promptReady).toBe(true);
    expect(shouldModernInputCapture(state)).toBe(false);
  });

  it("manual toggle overrides automatic capture until toggled again", () => {
    const forcedPassthrough = applyEvents({ type: "prompt:ready" }, { type: "manualToggle" });
    expect(forcedPassthrough.mode).toBe("forcedPassthrough");
    expect(shouldModernInputCapture(forcedPassthrough)).toBe(false);

    const forcedCaptured = reduceModernInputState(forcedPassthrough, { type: "manualToggle" });
    expect(forcedCaptured.mode).toBe("forcedCaptured");
    expect(shouldModernInputCapture(forcedCaptured)).toBe(true);
  });
});

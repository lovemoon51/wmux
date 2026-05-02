export type ModernInputMode = "captured" | "passthrough" | "forcedCaptured" | "forcedPassthrough";

export type ModernInputState = {
  mode: ModernInputMode;
  promptReady: boolean;
  altScreenActive: boolean;
  disabled: boolean;
};

export type ModernInputEvent =
  | { type: "prompt:ready" }
  | { type: "command:started" }
  | { type: "altScreen:enter" }
  | { type: "altScreen:leave" }
  | { type: "manualToggle" }
  | { type: "disableModernInput"; disabled: boolean };

export function createModernInputState(options: Partial<Pick<ModernInputState, "disabled">> = {}): ModernInputState {
  return {
    mode: "passthrough",
    promptReady: false,
    altScreenActive: false,
    disabled: options.disabled ?? false
  };
}

export function shouldModernInputCapture(state: ModernInputState): boolean {
  return !state.disabled && (state.mode === "captured" || state.mode === "forcedCaptured");
}

export function reduceModernInputState(state: ModernInputState, event: ModernInputEvent): ModernInputState {
  if (event.type === "disableModernInput") {
    return {
      ...state,
      disabled: event.disabled,
      mode: event.disabled ? "passthrough" : nextAutomaticMode(state.promptReady, state.altScreenActive)
    };
  }

  if (state.disabled) {
    return reduceDisabledModernInputState(state, event);
  }

  if (event.type === "prompt:ready") {
    const mode = state.mode === "forcedPassthrough" ? state.mode : nextAutomaticMode(true, state.altScreenActive);
    return { ...state, promptReady: true, mode };
  }

  if (event.type === "command:started") {
    return { ...state, promptReady: false, mode: state.mode === "forcedCaptured" ? "forcedCaptured" : "passthrough" };
  }

  if (event.type === "altScreen:enter") {
    return { ...state, altScreenActive: true, mode: "passthrough" };
  }

  if (event.type === "altScreen:leave") {
    const mode = state.mode === "forcedPassthrough" ? state.mode : nextAutomaticMode(state.promptReady, false);
    return { ...state, altScreenActive: false, mode };
  }

  if (event.type === "manualToggle") {
    return {
      ...state,
      mode: shouldModernInputCapture(state) ? "forcedPassthrough" : "forcedCaptured"
    };
  }

  return state;
}

function reduceDisabledModernInputState(state: ModernInputState, event: ModernInputEvent): ModernInputState {
  if (event.type === "prompt:ready") {
    return { ...state, promptReady: true, mode: "passthrough" };
  }
  if (event.type === "command:started") {
    return { ...state, promptReady: false, mode: "passthrough" };
  }
  if (event.type === "altScreen:enter") {
    return { ...state, altScreenActive: true, mode: "passthrough" };
  }
  if (event.type === "altScreen:leave") {
    return { ...state, altScreenActive: false, mode: "passthrough" };
  }
  return { ...state, mode: "passthrough" };
}

function nextAutomaticMode(promptReady: boolean, altScreenActive: boolean): ModernInputMode {
  return promptReady && !altScreenActive ? "captured" : "passthrough";
}

import type { ModernInputState } from "./inputEditorState";
import { shouldModernInputCapture } from "./inputEditorState";

export type InputKeyDescriptor = {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
};

export type InputEditorAction =
  | "submit"
  | "insertNewline"
  | "passThrough"
  | "interrupt"
  | "toggleCapture"
  | "undo"
  | "redo"
  | "none";

export function mapInputKey(event: InputKeyDescriptor, state: ModernInputState): InputEditorAction {
  const isPrimary = Boolean(event.ctrlKey || event.metaKey);
  const key = event.key.toLowerCase();

  if (isPrimary && !event.altKey && key === "`") {
    return "toggleCapture";
  }

  if (!shouldModernInputCapture(state)) {
    return "passThrough";
  }

  if (isPrimary && !event.altKey && key === "c") {
    return "interrupt";
  }

  if (isPrimary && !event.altKey && key === "z") {
    return "undo";
  }

  if (isPrimary && !event.altKey && (key === "y" || (event.shiftKey && key === "z"))) {
    return "redo";
  }

  if (event.key === "Enter") {
    return event.shiftKey ? "insertNewline" : "submit";
  }

  return "none";
}

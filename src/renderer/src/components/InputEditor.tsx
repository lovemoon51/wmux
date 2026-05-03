import { autocompletion, completionKeymap, completionStatus, startCompletion } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { bracketMatching, foldGutter, indentOnInput } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap, lineNumbers, placeholder } from "@codemirror/view";
import type { ShellProfile } from "@shared/types";
import { useEffect, useRef, type ReactElement } from "react";
import { createShellCompletionSource } from "../lib/completion/createShellCompletionSource";

type InputEditorProps = {
  value: string;
  enabled: boolean;
  focusToken: number;
  cwd: string;
  shell: ShellProfile;
  surfaceId: string;
  workspaceId: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onAiSuggest?: (prompt: string) => void;
  onInterrupt: () => void;
  onToggleCapture: () => void;
};

export function InputEditor({
  value,
  enabled,
  focusToken,
  cwd,
  shell,
  surfaceId,
  workspaceId,
  onChange,
  onSubmit,
  onAiSuggest,
  onInterrupt,
  onToggleCapture
}: InputEditorProps): ReactElement {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const valueRef = useRef(value);
  const onChangeRef = useRef(onChange);
  const onSubmitRef = useRef(onSubmit);
  const onAiSuggestRef = useRef(onAiSuggest);
  const onInterruptRef = useRef(onInterrupt);
  const onToggleCaptureRef = useRef(onToggleCapture);
  const completionContextRef = useRef({ cwd, shell, surfaceId, workspaceId });

  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    onSubmitRef.current = onSubmit;
  }, [onSubmit]);

  useEffect(() => {
    onAiSuggestRef.current = onAiSuggest;
  }, [onAiSuggest]);

  useEffect(() => {
    onInterruptRef.current = onInterrupt;
  }, [onInterrupt]);

  useEffect(() => {
    onToggleCaptureRef.current = onToggleCapture;
  }, [onToggleCapture]);

  useEffect(() => {
    completionContextRef.current = { cwd, shell, surfaceId, workspaceId };
  }, [cwd, shell, surfaceId, workspaceId]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) {
      return;
    }

    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: valueRef.current,
        extensions: [
          lineNumbers(),
          foldGutter(),
          history(),
          indentOnInput(),
          bracketMatching(),
          placeholder("Type a command"),
          autocompletion({
            override: [createShellCompletionSource(() => completionContextRef.current)],
            maxRenderedOptions: 8,
            activateOnTyping: true
          }),
          keymap.of([
            ...completionKeymap,
            {
              key: "Enter",
              run: (editorView) => {
                if (completionStatus(editorView.state) === "active") {
                  return false;
                }
                const value = editorView.state.doc.toString().trim();
                if (value.startsWith("#") && value.slice(1).trim() && onAiSuggestRef.current) {
                  onAiSuggestRef.current(value.slice(1).trim());
                  return true;
                }
                onSubmitRef.current();
                return true;
              }
            },
            {
              key: "Ctrl-Space",
              run: startCompletion
            },
            {
              key: "Shift-Enter",
              run: (editorView) => {
                editorView.dispatch(editorView.state.replaceSelection("\n"));
                return true;
              }
            },
            {
              key: "Mod-`",
              run: () => {
                onToggleCaptureRef.current();
                return true;
              }
            },
            {
              key: "Ctrl-c",
              run: () => {
                onInterruptRef.current();
                return true;
              }
            },
            indentWithTab,
            ...historyKeymap,
            ...defaultKeymap
          ]),
          EditorView.lineWrapping,
          EditorView.updateListener.of((update) => {
            if (!update.docChanged) {
              return;
            }
            const nextValue = update.state.doc.toString();
            valueRef.current = nextValue;
            onChangeRef.current(nextValue);
          }),
          EditorView.theme({
            "&": {
              background: "transparent",
              color: "var(--text-primary)",
              fontSize: "13px",
              minHeight: "34px"
            },
            ".cm-content": {
              caretColor: "var(--accent)",
              fontFamily: "var(--font-mono)",
              padding: "8px 10px",
              minHeight: "34px"
            },
            ".cm-line": {
              padding: "0 2px"
            },
            ".cm-gutters": {
              display: "none"
            },
            ".cm-scroller": {
              fontFamily: "var(--font-mono)",
              maxHeight: "160px",
              overflow: "auto"
            },
            ".cm-placeholder": {
              color: "var(--text-muted)"
            },
            ".cm-selectionBackground": {
              background: "rgba(115, 186, 255, 0.28) !important"
            },
            "&.cm-focused": {
              outline: "none"
            }
          })
        ]
      })
    });

    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) {
      return;
    }
    const currentValue = view.state.doc.toString();
    if (currentValue === value) {
      return;
    }
    view.dispatch({
      changes: { from: 0, to: currentValue.length, insert: value }
    });
  }, [value]);

  useEffect(() => {
    if (enabled) {
      viewRef.current?.focus();
    }
  }, [enabled, focusToken]);

  return <div className="inputEditorHost" ref={hostRef} data-enabled={enabled ? "true" : "false"} />;
}

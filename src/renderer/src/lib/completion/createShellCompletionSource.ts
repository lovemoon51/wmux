import type { CompletionSource } from "@codemirror/autocomplete";
import { resolveShellCompletionContext } from "./context";
import { mergeCompletionItems } from "./merge";
import { completeFilePath } from "./providers/file";
import { completeGitBranches } from "./providers/git";
import { completeFromStaticSpec } from "./providers/staticSpec";
import { toCodeMirrorCompletion, type ShellCompletionRequest } from "./types";

export type ShellCompletionRuntimeContext = Omit<ShellCompletionRequest, "text" | "cursor">;

export function createShellCompletionSource(
  readRuntimeContext: () => ShellCompletionRuntimeContext
): CompletionSource {
  return async (completionContext) => {
    const text = completionContext.state.doc.toString();
    const request = {
      ...readRuntimeContext(),
      text,
      cursor: completionContext.pos
    };
    const context = resolveShellCompletionContext(request);
    if (!context) {
      return null;
    }
    if (!completionContext.explicit && !shouldTriggerCompletion(context.currentWord, text, completionContext.pos)) {
      return null;
    }

    const staticItems = completeFromStaticSpec(context);
    const [fileItems, branchItems] = await Promise.all([completeFilePath(context), completeGitBranches(context)]);
    if (completionContext.aborted) {
      return null;
    }

    const options = mergeCompletionItems([...staticItems, ...fileItems, ...branchItems], context.currentWord).map(
      toCodeMirrorCompletion
    );
    if (options.length === 0) {
      return null;
    }

    return {
      from: context.from,
      options,
      validFor: /^[^\s]*$/
    };
  };
}

function shouldTriggerCompletion(currentWord: string, text: string, cursor: number): boolean {
  const previous = text[cursor - 1] ?? "";
  return Boolean(currentWord || previous === " " || previous === "-" || previous === "/" || previous === ".");
}

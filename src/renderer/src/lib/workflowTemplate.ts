import type { WmuxCommandArg, WmuxCommandConfig } from "@shared/types";

export type WorkflowArgValidationResult = {
  ok: boolean;
  errors: Record<string, string>;
};

const placeholderPattern = /\{\{\s*([A-Za-z_][A-Za-z0-9_-]*)\s*\}\}/g;

export function getWorkflowCommandTemplate(command: WmuxCommandConfig): string | undefined {
  return command.commandTemplate ?? command.command;
}

export function isWorkflowCommand(command: WmuxCommandConfig): boolean {
  return Boolean(command.commandTemplate || command.args?.length);
}

export function extractWorkflowPlaceholders(template: string): string[] {
  const names = new Set<string>();
  for (const match of template.matchAll(placeholderPattern)) {
    names.add(match[1]);
  }
  return [...names];
}

export function createWorkflowArgDefaults(args: WmuxCommandArg[] = []): Record<string, string> {
  return Object.fromEntries(args.map((arg) => [arg.name, arg.default ?? arg.enum?.[0] ?? ""]));
}

export function validateWorkflowArgs(
  args: WmuxCommandArg[] = [],
  values: Record<string, string>,
  template?: string
): WorkflowArgValidationResult {
  const errors: Record<string, string> = {};
  const knownArgNames = new Set(args.map((arg) => arg.name));

  args.forEach((arg) => {
    const value = values[arg.name] ?? "";
    if (arg.required && !value.trim()) {
      errors[arg.name] = "必填";
      return;
    }
    if (arg.enum?.length && value && !arg.enum.includes(value)) {
      errors[arg.name] = "不在候选项中";
    }
  });

  if (template) {
    extractWorkflowPlaceholders(template).forEach((name) => {
      if (!knownArgNames.has(name)) {
        errors[name] = "模板变量未定义";
      }
    });
  }

  return {
    ok: Object.keys(errors).length === 0,
    errors
  };
}

export function renderWorkflowCommand(template: string, values: Record<string, string>): string {
  return template.replace(placeholderPattern, (_match, name: string) => values[name] ?? "");
}

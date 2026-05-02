import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse } from "yaml";
import type { WmuxCommandArg, WmuxCommandConfig, WmuxConfigSource, WmuxWorkflowConfig } from "../../shared/types";

export type WorkflowYamlLoadResult = {
  source: WmuxConfigSource;
  commands: WmuxCommandConfig[];
};

type WorkflowYamlParseResult = {
  commands: WmuxCommandConfig[];
  errors: string[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readOptionalString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const items = value
    .filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
    .map((item) => item.trim());
  return items.length ? items : undefined;
}

function parseWorkflowArgument(value: unknown, errors: string[], context: string): WmuxCommandArg | null {
  if (!isRecord(value)) {
    errors.push(`${context} 必须是参数对象`);
    return null;
  }

  const name = readOptionalString(value, "name");
  if (!name) {
    errors.push(`${context}.name 必须是非空字符串`);
    return null;
  }
  const defaultValue = readOptionalString(value, "default_value") ?? readOptionalString(value, "default");

  return {
    name,
    description: readOptionalString(value, "description"),
    default: defaultValue,
    required: !defaultValue,
    enum: readStringArray(value.enum) ?? readStringArray(value.options)
  };
}

function parseWorkflowObject(value: unknown, sourcePath: string, errors: string[], context: string): WmuxCommandConfig | null {
  if (!isRecord(value)) {
    errors.push(`${context} 必须是 workflow 对象`);
    return null;
  }

  const workflow = value as Partial<WmuxWorkflowConfig> & Record<string, unknown>;
  const name = readOptionalString(workflow, "name");
  const command = readOptionalString(workflow, "command") ?? readOptionalString(workflow, "commandTemplate");
  if (!name) {
    errors.push(`${context}.name 必须是非空字符串`);
    return null;
  }
  if (!command) {
    errors.push(`${context}.command 必须是非空字符串`);
    return null;
  }

  const rawArguments = Array.isArray(workflow.arguments)
    ? workflow.arguments
    : Array.isArray(workflow.args)
      ? workflow.args
      : [];
  const args = rawArguments
    .map((argument, index) => parseWorkflowArgument(argument, errors, `${context}.arguments[${index}]`))
    .filter((argument): argument is WmuxCommandArg => Boolean(argument));

  return {
    name,
    description: readOptionalString(workflow, "description"),
    keywords: readStringArray(workflow.tags) ?? readStringArray(workflow.keywords),
    commandTemplate: command,
    args: args.length ? args : undefined,
    source: "workflow",
    sourcePath
  };
}

export function parseWorkflowYaml(rawYaml: string, sourcePath: string): WorkflowYamlParseResult {
  const errors: string[] = [];
  let parsed: unknown;

  try {
    parsed = parse(rawYaml);
  } catch (error) {
    return {
      commands: [],
      errors: [`读取 ${sourcePath} 失败：${error instanceof Error ? error.message : String(error)}`]
    };
  }

  const workflowItems = Array.isArray(parsed)
    ? parsed
    : isRecord(parsed) && Array.isArray(parsed.workflows)
      ? parsed.workflows
      : isRecord(parsed) && Array.isArray(parsed.commands)
        ? parsed.commands
        : [parsed];

  const commands = workflowItems
    .map((workflow, index) => parseWorkflowObject(workflow, sourcePath, errors, `workflows[${index}]`))
    .filter((command): command is WmuxCommandConfig => Boolean(command));

  return { commands, errors };
}

export async function loadWorkflowYamlDirectory(workspaceRoot: string): Promise<WorkflowYamlLoadResult[]> {
  const workflowDirectory = join(workspaceRoot, ".warp", "workflows");
  let entries: string[];
  try {
    entries = await readdir(workflowDirectory);
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code === "ENOENT") {
      return [];
    }
    return [
      {
        source: {
          kind: "workflow",
          path: workflowDirectory,
          found: true,
          commandCount: 0,
          errors: [`读取 ${workflowDirectory} 失败：${error instanceof Error ? error.message : String(error)}`]
        },
        commands: []
      }
    ];
  }

  const workflowFiles = entries
    .filter((entry) => /\.ya?ml$/i.test(entry))
    .sort((left, right) => left.localeCompare(right));

  return Promise.all(
    workflowFiles.map(async (entry): Promise<WorkflowYamlLoadResult> => {
      const sourcePath = join(workflowDirectory, entry);
      try {
        const parsed = parseWorkflowYaml(await readFile(sourcePath, "utf8"), sourcePath);
        return {
          source: {
            kind: "workflow",
            path: sourcePath,
            found: true,
            commandCount: parsed.commands.length,
            errors: parsed.errors
          },
          commands: parsed.commands
        };
      } catch (error) {
        return {
          source: {
            kind: "workflow",
            path: sourcePath,
            found: true,
            commandCount: 0,
            errors: [`读取 ${sourcePath} 失败：${error instanceof Error ? error.message : String(error)}`]
          },
          commands: []
        };
      }
    })
  );
}

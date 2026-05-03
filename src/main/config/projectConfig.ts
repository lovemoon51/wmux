import type {
  WmuxCommandArg,
  WmuxCommandConfig,
  WmuxConfigSourceKind,
  WmuxLayoutConfig,
  WmuxProjectConfig,
  WmuxSurfaceConfig,
  WmuxWorkspaceCommandConfig
} from "../../shared/types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readOptionalString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

function readOptionalBoolean(record: Record<string, unknown>, key: string): boolean | undefined {
  const value = record[key];
  return typeof value === "boolean" ? value : undefined;
}

function readOptionalKeywords(record: Record<string, unknown>): string[] | undefined {
  const value = record.keywords;
  if (!Array.isArray(value)) {
    return undefined;
  }

  const keywords = value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).map((item) => item.trim());
  return keywords.length ? keywords : undefined;
}

function parseCommandArgConfig(value: unknown, errors: string[], context: string): WmuxCommandArg | null {
  if (!isRecord(value)) {
    errors.push(`${context} 必须是参数对象`);
    return null;
  }

  const name = readOptionalString(value, "name");
  if (!name) {
    errors.push(`${context}.name 必须是非空字符串`);
    return null;
  }

  const enumValues = Array.isArray(value.enum)
    ? value.enum.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).map((item) => item.trim())
    : undefined;

  return {
    name,
    description: readOptionalString(value, "description"),
    default: readOptionalString(value, "default"),
    required: readOptionalBoolean(value, "required"),
    enum: enumValues?.length ? enumValues : undefined
  };
}

function parseCommandArgsConfig(value: unknown, errors: string[], context: string): WmuxCommandArg[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    errors.push(`${context} 必须是参数数组`);
    return undefined;
  }

  const args = value
    .map((arg, index) => parseCommandArgConfig(arg, errors, `${context}[${index}]`))
    .filter((arg): arg is WmuxCommandArg => Boolean(arg));

  return args.length ? args : undefined;
}

export function parseSurfaceConfig(value: unknown, errors: string[], context: string): WmuxSurfaceConfig | null {
  if (!isRecord(value)) {
    errors.push(`${context} 必须是 surface 对象`);
    return null;
  }

  if (value.type === "terminal") {
    return {
      type: "terminal",
      name: readOptionalString(value, "name"),
      command: readOptionalString(value, "command"),
      focus: readOptionalBoolean(value, "focus")
    };
  }

  if (value.type === "browser") {
    return {
      type: "browser",
      name: readOptionalString(value, "name"),
      url: readOptionalString(value, "url"),
      focus: readOptionalBoolean(value, "focus")
    };
  }

  if (value.type === "notebook") {
    return {
      type: "notebook",
      name: readOptionalString(value, "name"),
      notebookId: readOptionalString(value, "notebookId"),
      focus: readOptionalBoolean(value, "focus")
    };
  }

  errors.push(`${context} 的 type 必须是 terminal、browser 或 notebook`);
  return null;
}

export function parseLayoutConfig(value: unknown, errors: string[], context: string): WmuxLayoutConfig | null {
  if (!isRecord(value)) {
    errors.push(`${context} 必须是 layout 对象`);
    return null;
  }

  if (isRecord(value.pane)) {
    const surfaces = Array.isArray(value.pane.surfaces) ? value.pane.surfaces : [];
    const parsedSurfaces = surfaces
      .map((surface, index) => parseSurfaceConfig(surface, errors, `${context}.pane.surfaces[${index}]`))
      .filter((surface): surface is WmuxSurfaceConfig => Boolean(surface));

    if (parsedSurfaces.length === 0) {
      errors.push(`${context}.pane 至少需要一个 surface`);
      return null;
    }

    return { pane: { surfaces: parsedSurfaces } };
  }

  if (value.direction === "horizontal" || value.direction === "vertical") {
    if (!Array.isArray(value.children) || value.children.length !== 2) {
      errors.push(`${context}.children 必须包含两个子 layout`);
      return null;
    }

    const firstChild = parseLayoutConfig(value.children[0], errors, `${context}.children[0]`);
    const secondChild = parseLayoutConfig(value.children[1], errors, `${context}.children[1]`);
    if (!firstChild || !secondChild) {
      return null;
    }

    return {
      direction: value.direction,
      split: typeof value.split === "number" ? value.split : undefined,
      children: [firstChild, secondChild]
    };
  }

  errors.push(`${context} 必须是 pane 或 split layout`);
  return null;
}

function parseWorkspaceCommandConfig(
  value: unknown,
  errors: string[],
  context: string
): WmuxWorkspaceCommandConfig | null {
  if (!isRecord(value)) {
    errors.push(`${context} 必须是 workspace 对象`);
    return null;
  }

  const workspace: WmuxWorkspaceCommandConfig = {
    name: readOptionalString(value, "name"),
    cwd: readOptionalString(value, "cwd"),
    color: readOptionalString(value, "color")
  };

  if (value.layout !== undefined) {
    const layout = parseLayoutConfig(value.layout, errors, `${context}.layout`);
    if (layout) {
      workspace.layout = layout;
    }
  }

  return workspace;
}

function parseCommandConfig(
  value: unknown,
  errors: string[],
  index: number,
  source: { kind: WmuxConfigSourceKind; path: string }
): WmuxCommandConfig | null {
  const context = `commands[${index}]`;
  if (!isRecord(value)) {
    errors.push(`${context} 必须是对象`);
    return null;
  }

  const name = readOptionalString(value, "name");
  if (!name) {
    errors.push(`${context}.name 必须是非空字符串`);
    return null;
  }

  const commandText = readOptionalString(value, "command");
  const commandTemplate = readOptionalString(value, "commandTemplate");
  const args = parseCommandArgsConfig(value.args, errors, `${context}.args`);
  const workspace = value.workspace === undefined ? undefined : parseWorkspaceCommandConfig(value.workspace, errors, `${context}.workspace`);
  if (!commandText && !commandTemplate && !workspace) {
    errors.push(`${context} 必须提供 command、commandTemplate 或 workspace`);
    return null;
  }

  return {
    name,
    description: readOptionalString(value, "description"),
    keywords: readOptionalKeywords(value),
    restart:
      value.restart === "ignore" || value.restart === "recreate" || value.restart === "confirm" ? value.restart : undefined,
    command: commandText,
    commandTemplate,
    args,
    confirm: readOptionalBoolean(value, "confirm"),
    workspace: workspace ?? undefined,
    source: source.kind,
    sourcePath: source.path
  };
}

export function parseProjectConfig(
  value: unknown,
  source: { kind: WmuxConfigSourceKind; path: string }
): { config: WmuxProjectConfig; errors: string[] } {
  const errors: string[] = [];
  if (!isRecord(value)) {
    return { config: { commands: [] }, errors: ["wmux.json 根节点必须是对象"] };
  }

  if (!Array.isArray(value.commands)) {
    return { config: { commands: [] }, errors: ["wmux.json 必须包含 commands 数组"] };
  }

  const commands = value.commands
    .map((command, index) => parseCommandConfig(command, errors, index, source))
    .filter((command): command is WmuxCommandConfig => Boolean(command));

  return { config: { commands }, errors };
}

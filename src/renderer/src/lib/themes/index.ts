import type { CustomThemeDefinition } from "@shared/types";

export type ThemeColorScheme = "dark" | "light";

export type TerminalTheme = {
  background: string;
  foreground: string;
  cursor: string;
  cursorAccent: string;
  selectionBackground: string;
  selectionForeground: string;
  black: string;
  red: string;
  green: string;
  yellow: string;
  blue: string;
  magenta: string;
  cyan: string;
  white: string;
  brightBlack: string;
  brightRed: string;
  brightGreen: string;
  brightYellow: string;
  brightBlue: string;
  brightMagenta: string;
  brightCyan: string;
  brightWhite: string;
};

export type ThemeCssVariables = {
  "--bg-app": string;
  "--bg-sidebar": string;
  "--bg-pane": string;
  "--bg-elevated": string;
  "--bg-control": string;
  "--border-subtle": string;
  "--border-strong": string;
  "--text-primary": string;
  "--text-secondary": string;
  "--text-muted": string;
  "--accent": string;
  "--success": string;
  "--warning": string;
  "--danger": string;
  "--attention": string;
};

export type WmuxTheme = {
  id: string;
  name: string;
  source: "built-in" | "custom";
  colorScheme: ThemeColorScheme;
  colors: ThemeCssVariables;
  terminal: TerminalTheme;
};

export type ThemeImportResult =
  | { ok: true; themes: WmuxTheme[]; message: string }
  | { ok: false; themes: []; message: string };

export const defaultThemeId = "default";

const themeVariableNames = [
  "--bg-app",
  "--bg-sidebar",
  "--bg-pane",
  "--bg-elevated",
  "--bg-control",
  "--border-subtle",
  "--border-strong",
  "--text-primary",
  "--text-secondary",
  "--text-muted",
  "--accent",
  "--success",
  "--warning",
  "--danger",
  "--attention"
] as const;

const terminalColorKeys = [
  "background",
  "foreground",
  "cursor",
  "cursorAccent",
  "selectionBackground",
  "selectionForeground",
  "black",
  "red",
  "green",
  "yellow",
  "blue",
  "magenta",
  "cyan",
  "white",
  "brightBlack",
  "brightRed",
  "brightGreen",
  "brightYellow",
  "brightBlue",
  "brightMagenta",
  "brightCyan",
  "brightWhite"
] as const;

const defaultTerminalTheme: TerminalTheme = {
  background: "#101214",
  foreground: "#d7dee7",
  cursor: "#3daee9",
  cursorAccent: "#101214",
  selectionBackground: "#314253",
  selectionForeground: "#eceff3",
  black: "#101214",
  red: "#ef6b73",
  green: "#58c27d",
  yellow: "#e2b84d",
  blue: "#3daee9",
  magenta: "#c792ea",
  cyan: "#53c7d4",
  white: "#eceff3",
  brightBlack: "#707987",
  brightRed: "#ff858c",
  brightGreen: "#72d99a",
  brightYellow: "#f0ca62",
  brightBlue: "#65c5f2",
  brightMagenta: "#d7a6f4",
  brightCyan: "#74dce7",
  brightWhite: "#ffffff"
};

const defaultColors: ThemeCssVariables = {
  "--bg-app": "#0f1115",
  "--bg-sidebar": "#15181d",
  "--bg-pane": "#101214",
  "--bg-elevated": "#1b1f26",
  "--bg-control": "#20252d",
  "--border-subtle": "#2a3038",
  "--border-strong": "#3a424e",
  "--text-primary": "#eceff3",
  "--text-secondary": "#a9b1bd",
  "--text-muted": "#707987",
  "--accent": "#3daee9",
  "--success": "#58c27d",
  "--warning": "#e2b84d",
  "--danger": "#ef6b73",
  "--attention": "#f59e0b"
};

export const builtInThemes: WmuxTheme[] = [
  {
    id: defaultThemeId,
    name: "Default",
    source: "built-in",
    colorScheme: "dark",
    colors: defaultColors,
    terminal: defaultTerminalTheme
  },
  {
    id: "dark",
    name: "Dark",
    source: "built-in",
    colorScheme: "dark",
    colors: {
      "--bg-app": "#090b0e",
      "--bg-sidebar": "#101419",
      "--bg-pane": "#0c0f13",
      "--bg-elevated": "#171c22",
      "--bg-control": "#1d242c",
      "--border-subtle": "#26313a",
      "--border-strong": "#3a4652",
      "--text-primary": "#f2f5f7",
      "--text-secondary": "#b5c0c9",
      "--text-muted": "#75828f",
      "--accent": "#4fb3d9",
      "--success": "#7ac489",
      "--warning": "#d6b65b",
      "--danger": "#ee6f75",
      "--attention": "#df9b3f"
    },
    terminal: {
      ...defaultTerminalTheme,
      background: "#0c0f13",
      foreground: "#d8e1e8",
      cursor: "#4fb3d9",
      selectionBackground: "#263a48",
      blue: "#4fb3d9",
      brightBlue: "#77c6ea"
    }
  },
  {
    id: "light",
    name: "Light",
    source: "built-in",
    colorScheme: "light",
    colors: {
      "--bg-app": "#f5f7fa",
      "--bg-sidebar": "#edf1f5",
      "--bg-pane": "#ffffff",
      "--bg-elevated": "#f0f3f7",
      "--bg-control": "#ffffff",
      "--border-subtle": "#d8dee6",
      "--border-strong": "#bcc7d3",
      "--text-primary": "#1f2933",
      "--text-secondary": "#52606d",
      "--text-muted": "#7b8794",
      "--accent": "#1479b8",
      "--success": "#2f855a",
      "--warning": "#b7791f",
      "--danger": "#c53030",
      "--attention": "#c05621"
    },
    terminal: {
      background: "#fbfcfe",
      foreground: "#1f2933",
      cursor: "#1479b8",
      cursorAccent: "#fbfcfe",
      selectionBackground: "#d6e9f7",
      selectionForeground: "#102a43",
      black: "#1f2933",
      red: "#c53030",
      green: "#2f855a",
      yellow: "#b7791f",
      blue: "#1479b8",
      magenta: "#805ad5",
      cyan: "#0f766e",
      white: "#e2e8f0",
      brightBlack: "#718096",
      brightRed: "#e53e3e",
      brightGreen: "#38a169",
      brightYellow: "#d69e2e",
      brightBlue: "#2b8ac6",
      brightMagenta: "#9f7aea",
      brightCyan: "#14a098",
      brightWhite: "#ffffff"
    }
  },
  {
    id: "solarized",
    name: "Solarized",
    source: "built-in",
    colorScheme: "dark",
    colors: {
      "--bg-app": "#002b36",
      "--bg-sidebar": "#073642",
      "--bg-pane": "#00212b",
      "--bg-elevated": "#0b3a46",
      "--bg-control": "#123f4a",
      "--border-subtle": "#24505a",
      "--border-strong": "#36636e",
      "--text-primary": "#eee8d5",
      "--text-secondary": "#93a1a1",
      "--text-muted": "#657b83",
      "--accent": "#2aa198",
      "--success": "#859900",
      "--warning": "#b58900",
      "--danger": "#dc322f",
      "--attention": "#cb4b16"
    },
    terminal: {
      background: "#002b36",
      foreground: "#839496",
      cursor: "#2aa198",
      cursorAccent: "#002b36",
      selectionBackground: "#073642",
      selectionForeground: "#eee8d5",
      black: "#073642",
      red: "#dc322f",
      green: "#859900",
      yellow: "#b58900",
      blue: "#268bd2",
      magenta: "#d33682",
      cyan: "#2aa198",
      white: "#eee8d5",
      brightBlack: "#657b83",
      brightRed: "#dc322f",
      brightGreen: "#859900",
      brightYellow: "#b58900",
      brightBlue: "#268bd2",
      brightMagenta: "#d33682",
      brightCyan: "#2aa198",
      brightWhite: "#fdf6e3"
    }
  },
  {
    id: "dracula",
    name: "Dracula",
    source: "built-in",
    colorScheme: "dark",
    colors: {
      "--bg-app": "#1f2130",
      "--bg-sidebar": "#282a36",
      "--bg-pane": "#191a23",
      "--bg-elevated": "#303241",
      "--bg-control": "#383a4a",
      "--border-subtle": "#44475a",
      "--border-strong": "#5d6178",
      "--text-primary": "#f8f8f2",
      "--text-secondary": "#c7c9d1",
      "--text-muted": "#8b8ea3",
      "--accent": "#8be9fd",
      "--success": "#50fa7b",
      "--warning": "#f1fa8c",
      "--danger": "#ff5555",
      "--attention": "#ffb86c"
    },
    terminal: {
      background: "#282a36",
      foreground: "#f8f8f2",
      cursor: "#f8f8f2",
      cursorAccent: "#282a36",
      selectionBackground: "#44475a",
      selectionForeground: "#f8f8f2",
      black: "#21222c",
      red: "#ff5555",
      green: "#50fa7b",
      yellow: "#f1fa8c",
      blue: "#bd93f9",
      magenta: "#ff79c6",
      cyan: "#8be9fd",
      white: "#f8f8f2",
      brightBlack: "#6272a4",
      brightRed: "#ff6e6e",
      brightGreen: "#69ff94",
      brightYellow: "#ffffa5",
      brightBlue: "#d6acff",
      brightMagenta: "#ff92df",
      brightCyan: "#a4ffff",
      brightWhite: "#ffffff"
    }
  }
];

export function getThemeById(themes: WmuxTheme[], themeId: string | undefined): WmuxTheme {
  return themes.find((theme) => theme.id === themeId) ?? builtInThemes[0];
}

export function applyThemeToDocument(theme: WmuxTheme, root: HTMLElement = document.documentElement): void {
  Object.entries(theme.colors).forEach(([name, value]) => root.style.setProperty(name, value));
  root.style.setProperty("color-scheme", theme.colorScheme);
}

export function serializeCustomThemes(themes: WmuxTheme[]): CustomThemeDefinition[] {
  return themes
    .filter((theme) => theme.source === "custom")
    .map((theme) => ({
      id: theme.id,
      name: theme.name,
      colorScheme: theme.colorScheme,
      colors: theme.colors,
      terminal: theme.terminal
    }));
}

export function normalizePersistedCustomThemes(themes: CustomThemeDefinition[] | undefined): WmuxTheme[] {
  return (themes ?? []).map((theme, index) => normalizePersistedTheme(theme, index)).filter((theme): theme is WmuxTheme => Boolean(theme));
}

export function mergeCustomThemes(currentThemes: WmuxTheme[], importedThemes: WmuxTheme[]): WmuxTheme[] {
  const nextThemes = [...currentThemes];
  importedThemes.forEach((theme) => {
    const index = nextThemes.findIndex((item) => item.id === theme.id);
    if (index >= 0) {
      nextThemes[index] = theme;
      return;
    }
    nextThemes.push(theme);
  });
  return nextThemes;
}

export function importThemesFromJson(content: string): ThemeImportResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return { ok: false, themes: [], message: "JSON 解析失败" };
  }

  const candidates = readThemeCandidates(parsed);
  const themes = candidates
    .map((candidate, index) => createThemeFromUnknown(candidate, index))
    .filter((theme): theme is WmuxTheme => Boolean(theme));

  if (!themes.length) {
    return { ok: false, themes: [], message: "未找到可导入的主题颜色" };
  }

  return {
    ok: true,
    themes,
    message: themes.length === 1 ? `Imported ${themes[0].name}` : `Imported ${themes.length} themes`
  };
}

function normalizePersistedTheme(theme: CustomThemeDefinition, index: number): WmuxTheme | undefined {
  const terminal = readTerminalTheme(theme);
  if (!terminal) {
    return undefined;
  }
  return buildCustomTheme({
    id: theme.id || `custom:${slugify(theme.name || `theme-${index + 1}`)}`,
    name: theme.name || `Imported ${index + 1}`,
    colorScheme: theme.colorScheme === "light" ? "light" : "dark",
    terminal,
    colors: readCssVariables(theme.colors, terminal, theme.colorScheme === "light" ? "light" : "dark")
  });
}

function readThemeCandidates(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value;
  }
  if (!isRecord(value)) {
    return [];
  }
  if (Array.isArray(value.themes)) {
    return value.themes;
  }
  return [value];
}

function createThemeFromUnknown(value: unknown, index: number): WmuxTheme | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const terminal = readTerminalTheme(value);
  if (!terminal) {
    return undefined;
  }
  const name = readString(value.name) ?? readString(value.Name) ?? `Imported ${index + 1}`;
  const colorScheme = readString(value.colorScheme) === "light" ? "light" : inferColorScheme(terminal.background);
  return buildCustomTheme({
    id: `custom:${slugify(readString(value.id) ?? name)}`,
    name,
    colorScheme,
    terminal,
    colors: readCssVariables(readRecord(value.colors) ?? readRecord(value.cssVars), terminal, colorScheme)
  });
}

function buildCustomTheme(theme: Omit<WmuxTheme, "source">): WmuxTheme {
  return {
    ...theme,
    id: theme.id.startsWith("custom:") ? theme.id : `custom:${slugify(theme.id)}`,
    source: "custom"
  };
}

function readTerminalTheme(value: Record<string, unknown>): TerminalTheme | undefined {
  const terminalSource =
    readRecord(value.terminal) ??
    readRecord(value.terminalTheme) ??
    readRecord(value.xterm) ??
    value;
  const terminal: Partial<TerminalTheme> = {};

  terminalColorKeys.forEach((key) => {
    const color = readColor(terminalSource[key]);
    if (color) {
      terminal[key] = color;
    }
  });

  readItermColors(value, terminal);

  if (!terminal.background || !terminal.foreground) {
    return undefined;
  }

  return {
    ...defaultTerminalTheme,
    ...terminal
  };
}

function readCssVariables(
  source: Record<string, unknown> | undefined,
  terminal: TerminalTheme,
  colorScheme: ThemeColorScheme
): ThemeCssVariables {
  const base = deriveCssVariables(terminal, colorScheme);
  if (!source) {
    return base;
  }

  const next: ThemeCssVariables = { ...base };
  themeVariableNames.forEach((name) => {
    const color = readColor(source[name] ?? source[name.slice(2)]);
    if (color) {
      next[name] = color;
    }
  });
  return next;
}

function deriveCssVariables(terminal: TerminalTheme, colorScheme: ThemeColorScheme): ThemeCssVariables {
  if (colorScheme === "light") {
    return {
      ...defaultColors,
      "--bg-app": terminal.white,
      "--bg-sidebar": terminal.brightWhite,
      "--bg-pane": terminal.background,
      "--bg-elevated": terminal.white,
      "--bg-control": terminal.brightWhite,
      "--border-subtle": terminal.brightBlack,
      "--border-strong": terminal.blue,
      "--text-primary": terminal.foreground,
      "--text-secondary": terminal.black,
      "--text-muted": terminal.brightBlack,
      "--accent": terminal.blue,
      "--success": terminal.green,
      "--warning": terminal.yellow,
      "--danger": terminal.red,
      "--attention": terminal.magenta
    };
  }

  return {
    ...defaultColors,
    "--bg-app": terminal.black,
    "--bg-sidebar": terminal.background,
    "--bg-pane": terminal.background,
    "--bg-elevated": terminal.black,
    "--bg-control": terminal.brightBlack,
    "--border-subtle": terminal.brightBlack,
    "--border-strong": terminal.blue,
    "--text-primary": terminal.foreground,
    "--text-secondary": terminal.white,
    "--text-muted": terminal.brightBlack,
    "--accent": terminal.blue,
    "--success": terminal.green,
    "--warning": terminal.yellow,
    "--danger": terminal.red,
    "--attention": terminal.magenta
  };
}

function readItermColors(source: Record<string, unknown>, terminal: Partial<TerminalTheme>): void {
  const itermMap: Array<[string, keyof TerminalTheme]> = [
    ["Background Color", "background"],
    ["Foreground Color", "foreground"],
    ["Cursor Color", "cursor"],
    ["Cursor Text Color", "cursorAccent"],
    ["Selection Color", "selectionBackground"],
    ["Selected Text Color", "selectionForeground"],
    ["Ansi 0 Color", "black"],
    ["Ansi 1 Color", "red"],
    ["Ansi 2 Color", "green"],
    ["Ansi 3 Color", "yellow"],
    ["Ansi 4 Color", "blue"],
    ["Ansi 5 Color", "magenta"],
    ["Ansi 6 Color", "cyan"],
    ["Ansi 7 Color", "white"],
    ["Ansi 8 Color", "brightBlack"],
    ["Ansi 9 Color", "brightRed"],
    ["Ansi 10 Color", "brightGreen"],
    ["Ansi 11 Color", "brightYellow"],
    ["Ansi 12 Color", "brightBlue"],
    ["Ansi 13 Color", "brightMagenta"],
    ["Ansi 14 Color", "brightCyan"],
    ["Ansi 15 Color", "brightWhite"]
  ];

  itermMap.forEach(([sourceKey, terminalKey]) => {
    const color = readItermColor(source[sourceKey]);
    if (color) {
      terminal[terminalKey] = color;
    }
  });
}

function readItermColor(value: unknown): string | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const red = readNumber(value["Red Component"]);
  const green = readNumber(value["Green Component"]);
  const blue = readNumber(value["Blue Component"]);
  if (red === undefined || green === undefined || blue === undefined) {
    return undefined;
  }
  return toHexColor(red, green, blue);
}

function toHexColor(red: number, green: number, blue: number): string {
  return `#${[red, green, blue]
    .map((component) => Math.max(0, Math.min(255, Math.round(component * 255))).toString(16).padStart(2, "0"))
    .join("")}`;
}

function inferColorScheme(background: string): ThemeColorScheme {
  const hex = background.match(/^#([0-9a-f]{6})$/i)?.[1];
  if (!hex) {
    return "dark";
  }
  const red = parseInt(hex.slice(0, 2), 16);
  const green = parseInt(hex.slice(2, 4), 16);
  const blue = parseInt(hex.slice(4, 6), 16);
  return (red * 299 + green * 587 + blue * 114) / 1000 > 155 ? "light" : "dark";
}

function readColor(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(trimmed) ||
    /^rgba?\([^)]+\)$/i.test(trimmed) ||
    /^hsla?\([^)]+\)$/i.test(trimmed)
    ? trimmed
    : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "theme";
}

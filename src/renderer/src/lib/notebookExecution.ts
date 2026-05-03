import type { ShellProfile } from "@shared/types";

export function buildNotebookExecutionInput(command: string, shell: ShellProfile): string {
  const normalizedCommand = command.endsWith("\n") || command.endsWith("\r") ? command : `${command}\n`;
  if (shell === "cmd") {
    return `${normalizedCommand}exit /b %ERRORLEVEL%\r\n`;
  }
  if (shell === "bash" || shell === "zsh") {
    return `${normalizedCommand}exit $?\n`;
  }
  return `${normalizedCommand}exit $LASTEXITCODE\r\n`;
}

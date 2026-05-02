import { Command } from "lucide-react";
import type { FormEvent, ReactElement } from "react";
import type { WmuxCommandArg, WmuxCommandConfig } from "@shared/types";
import {
  getWorkflowCommandTemplate,
  renderWorkflowCommand,
  validateWorkflowArgs
} from "../lib/workflowTemplate";

export function ArgsPromptDialog({
  command,
  values,
  onCancel,
  onConfirm,
  onValueChange
}: {
  command: WmuxCommandConfig | null;
  values: Record<string, string>;
  onCancel: () => void;
  onConfirm: () => void;
  onValueChange: (name: string, value: string) => void;
}): ReactElement | null {
  if (!command) {
    return null;
  }

  const template = getWorkflowCommandTemplate(command) ?? "";
  const validation = validateWorkflowArgs(command.args, values, template);
  const renderedCommand = validation.ok ? renderWorkflowCommand(template, values) : template;
  const argErrors = (command.args ?? []).map((arg) => validation.errors[arg.name]).filter(Boolean);
  const submitArgs = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (validation.ok) {
      onConfirm();
    }
  };

  return (
    <div className="confirmOverlay" role="presentation" onMouseDown={onCancel}>
      <form
        className="argsPromptDialog"
        role="dialog"
        aria-modal="true"
        aria-label="Workflow arguments"
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={submitArgs}
      >
        <div className="confirmDialogHeader">
          <Command size={18} />
          <h2>{command.name}</h2>
        </div>
        {command.description && <p>{command.description}</p>}
        <div className="argsPromptFields">
          {(command.args ?? []).map((arg) => (
            <WorkflowArgField
              key={arg.name}
              arg={arg}
              error={validation.errors[arg.name]}
              value={values[arg.name] ?? ""}
              onValueChange={onValueChange}
            />
          ))}
          {Object.entries(validation.errors)
            .filter(([name]) => !(command.args ?? []).some((arg) => arg.name === name))
            .map(([name, error]) => (
              <p className="argsPromptError" key={name}>
                {name}: {error}
              </p>
            ))}
        </div>
        <pre className="argsPromptPreview">{renderedCommand}</pre>
        <div className="argsPromptStatus" aria-live="polite">
          {validation.ok ? "Ready" : argErrors[0] ?? "Template error"}
        </div>
        <div className="confirmDialogActions">
          <button className="toolbarButton" type="button" onClick={onCancel}>
            Cancel
          </button>
          <button className="commandButton" type="submit" disabled={!validation.ok}>
            Insert
          </button>
        </div>
      </form>
    </div>
  );
}

function WorkflowArgField({
  arg,
  error,
  value,
  onValueChange
}: {
  arg: WmuxCommandArg;
  error?: string;
  value: string;
  onValueChange: (name: string, value: string) => void;
}): ReactElement {
  const id = `workflow-arg-${arg.name}`;
  return (
    <label className="argsPromptField" htmlFor={id}>
      <span className="argsPromptLabel">
        <span>{arg.name}</span>
        {arg.required && <span className="argsPromptRequired">required</span>}
      </span>
      {arg.enum?.length ? (
        <select id={id} value={value} onChange={(event) => onValueChange(arg.name, event.target.value)}>
          <option value="">Select</option>
          {arg.enum.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      ) : (
        <input
          id={id}
          type="text"
          value={value}
          placeholder={arg.description ?? arg.name}
          onChange={(event) => onValueChange(arg.name, event.target.value)}
        />
      )}
      {arg.description && <span className="argsPromptHint">{arg.description}</span>}
      {error && <span className="argsPromptError">{error}</span>}
    </label>
  );
}

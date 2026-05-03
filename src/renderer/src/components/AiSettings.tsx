import type { AiSettings } from "@shared/types";
import type { ReactElement } from "react";

export type AiSettingsProps = {
  settings: AiSettings;
  draft: AiSettings;
  onDraftChange: (settings: AiSettings) => void;
  onSave: () => void;
};

export function AiSettingsForm({ settings, draft, onDraftChange, onSave }: AiSettingsProps): ReactElement {
  return (
    <div className="aiSettingsGroup" aria-label="AI settings">
      <label className="settingsToggle">
        <input
          type="checkbox"
          checked={draft.enabled}
          onChange={(event) => onDraftChange({ ...draft, enabled: event.target.checked })}
        />
        <span>Enable AI</span>
      </label>
      <label className="settingsField">
        <span>Endpoint</span>
        <input
          aria-label="AI endpoint"
          value={draft.endpoint}
          onChange={(event) => onDraftChange({ ...draft, endpoint: event.target.value })}
        />
      </label>
      <label className="settingsField">
        <span>Model</span>
        <input
          aria-label="AI model"
          value={draft.model}
          onChange={(event) => onDraftChange({ ...draft, model: event.target.value })}
        />
      </label>
      <label className="settingsField">
        <span>API key</span>
        <input
          aria-label="AI API key"
          placeholder={settings.apiKeySet ? "Saved" : "Required by most endpoints"}
          type="password"
          value={draft.apiKey ?? ""}
          onChange={(event) => onDraftChange({ ...draft, apiKey: event.target.value })}
        />
      </label>
      <label className="settingsToggle">
        <input
          type="checkbox"
          checked={draft.redactSecrets}
          onChange={(event) => onDraftChange({ ...draft, redactSecrets: event.target.checked })}
        />
        <span>Redact secrets</span>
      </label>
      <label className="settingsField">
        <span>Max output bytes</span>
        <input
          aria-label="AI max output bytes"
          min={512}
          max={32768}
          step={512}
          type="number"
          value={draft.maxOutputBytes}
          onChange={(event) =>
            onDraftChange({ ...draft, maxOutputBytes: Number(event.target.value) || draft.maxOutputBytes })
          }
        />
      </label>
      <div className="settingsMeta">Key: {settings.apiKeySet ? "encrypted at rest" : "not configured"}</div>
      <button className="utilityButton settingsSaveButton" type="button" onClick={onSave}>
        Save AI
      </button>
    </div>
  );
}

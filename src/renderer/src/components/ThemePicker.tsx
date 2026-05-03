import { Palette, Upload } from "lucide-react";
import { useRef, useState, type CSSProperties, type ReactElement } from "react";
import type { ThemeImportResult, WmuxTheme } from "../lib/themes";

export function ThemePicker({
  themes,
  selectedThemeId,
  onSelectTheme,
  onImportTheme
}: {
  themes: WmuxTheme[];
  selectedThemeId: string;
  onSelectTheme: (themeId: string) => void;
  onImportTheme: (content: string) => ThemeImportResult;
}): ReactElement {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [importMessage, setImportMessage] = useState("");

  const handleImportFile = (file: File | undefined): void => {
    if (!file) {
      return;
    }

    void file.text().then((content) => {
      const result = onImportTheme(content);
      setImportMessage(result.message);
    });
  };

  return (
    <section className="themePicker" aria-label="Theme">
      <div className="settingsSectionHeader">
        <Palette size={13} />
        <span>Theme</span>
      </div>
      <div className="themeGrid" role="listbox" aria-label="Theme choices">
        {themes.map((theme) => (
          <button
            className={`themeOption ${theme.id === selectedThemeId ? "themeOptionActive" : ""}`}
            key={theme.id}
            type="button"
            role="option"
            aria-selected={theme.id === selectedThemeId}
            onClick={() => onSelectTheme(theme.id)}
          >
            <span
              className="themeSwatch"
              style={
                {
                  "--theme-swatch-bg": theme.colors["--bg-pane"],
                  "--theme-swatch-sidebar": theme.colors["--bg-sidebar"],
                  "--theme-swatch-accent": theme.colors["--accent"]
                } as CSSProperties
              }
            >
              <span />
              <span />
              <span />
            </span>
            <span className="themeName">{theme.name}</span>
          </button>
        ))}
      </div>
      <button className="utilityButton themeImportButton" type="button" onClick={() => fileInputRef.current?.click()}>
        <Upload size={13} />
        <span>Import JSON</span>
      </button>
      <input
        ref={fileInputRef}
        className="visuallyHidden"
        type="file"
        accept="application/json,.json"
        aria-label="Import theme JSON"
        onChange={(event) => {
          handleImportFile(event.target.files?.[0]);
          event.currentTarget.value = "";
        }}
      />
      {importMessage && <div className="settingsMeta">{importMessage}</div>}
    </section>
  );
}

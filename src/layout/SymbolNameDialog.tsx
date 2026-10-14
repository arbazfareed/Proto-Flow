import { useState, type FormEvent } from "react";

interface SymbolNameDialogProps {
  defaultName: string;
  error?: string;
  eyebrow?: string;
  fieldLabel?: string;
  title?: string;
  submitLabel?: string;
  onCancel: () => void;
  onSubmit: (name: string) => void;
}

export function SymbolNameDialog({
  defaultName,
  error,
  eyebrow = "COMPONENT LIBRARY",
  fieldLabel = "Symbol name",
  title = "Create symbol",
  submitLabel = "Create symbol",
  onCancel,
  onSubmit,
}: SymbolNameDialogProps) {
  const [name, setName] = useState(defaultName);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalized = name.trim().slice(0, 120);
    if (normalized) onSubmit(normalized);
  };

  return (
    <div className="symbol-name-dialog-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onCancel();
    }}>
      <form
        className="symbol-name-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="symbol-name-dialog-heading"
        onSubmit={submit}
      >
        <div className="symbol-name-dialog-icon" aria-hidden="true">S</div>
        <span className="symbol-name-dialog-eyebrow">{eyebrow}</span>
        <h2 id="symbol-name-dialog-heading">{title}</h2>
        <label htmlFor="symbol-name-input">{fieldLabel}</label>
        <input
          id="symbol-name-input"
          aria-label={fieldLabel}
          autoFocus
          maxLength={120}
          value={name}
          onChange={(event) => setName(event.currentTarget.value)}
        />
        {error && <p className="symbol-name-dialog-error" role="alert">{error}</p>}
        <div className="symbol-name-dialog-actions">
          <button type="button" onClick={onCancel}>Cancel</button>
          <button type="submit" disabled={!name.trim()}>{submitLabel}</button>
        </div>
      </form>
    </div>
  );
}

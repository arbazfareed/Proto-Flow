import { useEffect, useRef } from "react";
import { CircleAlert, X } from "lucide-react";

type UnsavedChangesDialogProps = {
  projectName: string;
  saving: boolean;
  onSave: () => void;
  onDiscard: () => void;
  onCancel: () => void;
};

/** Asked when the desktop window is closed while the project has unsaved changes. */
export function UnsavedChangesDialog({
  projectName,
  saving,
  onSave,
  onDiscard,
  onCancel,
}: UnsavedChangesDialogProps) {
  const saveButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    saveButton.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onCancel]);

  return (
    <div className="overlay">
      <section
        className="dialog-card"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="unsaved-changes-title"
        aria-describedby="unsaved-changes-body"
      >
        <div className="dialog-icon recovery-dialog-icon"><CircleAlert size={19} /></div>
        <button className="icon-button dialog-close" aria-label="Keep working" onClick={onCancel}><X size={17} /></button>
        <span className="eyebrow">UNSAVED CHANGES</span>
        <h2 id="unsaved-changes-title">Save changes before closing?</h2>
        <p id="unsaved-changes-body">
          <strong>{projectName}</strong> has changes that are not saved to a file yet.
          If you close without saving, those changes are lost.
        </p>
        <div className="dialog-actions">
          <button className="button button-quiet" onClick={onCancel} disabled={saving}>Cancel</button>
          <button className="button button-quiet" onClick={onDiscard} disabled={saving}>Don't save</button>
          <button ref={saveButton} className="button button-primary" onClick={onSave} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </section>
    </div>
  );
}

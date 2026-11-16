import { useEffect, useId, useRef, useState } from "react";
import { CircleAlert, X } from "lucide-react";

type DeleteScreenDialogProps = {
  screenName: string;
  linkCount: number;
  otherScreens: readonly { id: string; name: string }[];
  /** Deletes the screen; links go to `redirectTo`, or are removed when it is null. */
  onConfirm: (redirectTo: string | null) => void;
  onCancel: () => void;
};

const REMOVE_LINKS = "";

/** Asked before deleting a screen that other screens link to, so no link breaks silently. */
export function DeleteScreenDialog({
  screenName,
  linkCount,
  otherScreens,
  onConfirm,
  onCancel,
}: DeleteScreenDialogProps) {
  const [redirectTo, setRedirectTo] = useState(otherScreens[0]?.id ?? REMOVE_LINKS);
  const selectRef = useRef<HTMLSelectElement>(null);
  const titleId = useId();
  const bodyId = useId();

  useEffect(() => {
    selectRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onCancel]);

  const links = linkCount === 1 ? "1 link goes" : `${linkCount} links go`;
  return (
    <div className="overlay">
      <section
        className="dialog-card"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
      >
        <div className="dialog-icon recovery-dialog-icon"><CircleAlert size={19} /></div>
        <button className="icon-button dialog-close" aria-label="Keep the screen" onClick={onCancel}><X size={17} /></button>
        <span className="eyebrow">DELETE SCREEN</span>
        <h2 id={titleId}>Delete “{screenName}”?</h2>
        <p id={bodyId}>
          {links} to this screen from other screens. Choose where they should go instead, so
          nothing in your prototype leads nowhere. Undo brings everything back.
        </p>
        <label className="delete-screen-redirect">
          Send those links to
          <select ref={selectRef} value={redirectTo} onChange={(event) => setRedirectTo(event.currentTarget.value)}>
            {otherScreens.map((screen) => <option key={screen.id} value={screen.id}>{screen.name}</option>)}
            <option value={REMOVE_LINKS}>Nowhere: remove the links</option>
          </select>
        </label>
        <div className="dialog-actions">
          <button className="button button-quiet" onClick={onCancel}>Cancel</button>
          <button className="button button-danger" onClick={() => onConfirm(redirectTo === REMOVE_LINKS ? null : redirectTo)}>
            Delete screen
          </button>
        </div>
      </section>
    </div>
  );
}

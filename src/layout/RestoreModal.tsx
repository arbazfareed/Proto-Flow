import { useEffect, useState } from "react";
import { ArrowRight, Clock3, X } from "lucide-react";
import { clearAutosave, readAutosaveAsync, writeAutosave, type AutosaveSnapshot } from "../project/autosave";
import { parseProject } from "../project/schema";
import { getPreviousSession } from "../project/sessionExit";
import { useStore } from "../store";

export function RestoreModal() {
  const [snapshot, setSnapshot] = useState<AutosaveSnapshot | null>(null);
  const restoreProject = useStore((state) => state.restoreProject);

  useEffect(() => {
    let active = true;
    void readAutosaveAsync().then((found) => {
      if (active) setSnapshot(found);
    });
    return () => {
      active = false;
    };
  }, []);

  const discard = () => {
    try {
      clearAutosave();
    } catch (error) {
      console.error("Could not discard Proto Flow autosave data.", error);
    }
    setSnapshot(null);
  };

  const restore = () => {
    if (!snapshot) return;

    let project;
    try {
      project = parseProject(snapshot.project);
    } catch {
      discard();
      return;
    }

    restoreProject(project, snapshot.filePath ?? null);
    // Keep a recovery copy on disk. Deleting it here meant that closing the app
    // within the next autosave interval lost the restored project for good.
    writeAutosave(project, snapshot.filePath ?? null);
    setSnapshot(null);
  };

  if (!snapshot) return null;

  // "Crash" is only said when the last session really ended without closing (B35).
  const crashed = getPreviousSession() === "crashed";

  return (
    <div className="overlay">
      <section className="dialog-card" role="dialog" aria-modal="true" aria-labelledby="recovery-title">
        <div className="dialog-icon recovery-dialog-icon"><Clock3 size={19} /></div>
        <button className="icon-button dialog-close" aria-label="Discard recovery prompt" onClick={discard}><X size={17} /></button>
        <span className="eyebrow">{crashed ? "CRASH RECOVERY" : "UNSAVED WORK"}</span>
        <h2 id="recovery-title">Restore unsaved work?</h2>
        <p>
          {crashed ? "Proto Flow did not close properly last time. It found" : "Proto Flow found"} unsaved changes from {new Date(snapshot.ts).toLocaleString()}. Restore the recovered copy of <strong>{snapshot.project.name}</strong>?
        </p>
        <div className="dialog-actions">
          <button className="button button-quiet" onClick={discard}>Discard</button>
          <button className="button button-primary" onClick={restore}>Restore project <ArrowRight size={15} /></button>
        </div>
      </section>
    </div>
  );
}

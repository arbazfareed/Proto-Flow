import { useEffect, useState } from "react";
import { ArrowRight, Clock3, X } from "lucide-react";
import { clearAutosave, readAutosave, type AutosaveSnapshot } from "../project/autosave";
import { parseProject } from "../project/schema";
import { useStore } from "../store";

export function RestoreModal() {
  const [snapshot, setSnapshot] = useState<AutosaveSnapshot | null>(null);
  const restoreProject = useStore((state) => state.restoreProject);

  useEffect(() => {
    setSnapshot(readAutosave());
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
    discard();
  };

  if (!snapshot) return null;

  return (
    <div className="overlay">
      <section className="dialog-card" role="dialog" aria-modal="true" aria-labelledby="recovery-title">
        <div className="dialog-icon recovery-dialog-icon"><Clock3 size={19} /></div>
        <button className="icon-button dialog-close" aria-label="Discard recovery prompt" onClick={discard}><X size={17} /></button>
        <span className="eyebrow">CRASH RECOVERY</span>
        <h2 id="recovery-title">Pick up where you left off?</h2>
        <p>Proto Flow found unsaved changes from {new Date(snapshot.ts).toLocaleString()}. Restore the recovered copy of <strong>{snapshot.project.name}</strong>?</p>
        <div className="dialog-actions">
          <button className="button button-quiet" onClick={discard}>Discard</button>
          <button className="button button-primary" onClick={restore}>Restore project <ArrowRight size={15} /></button>
        </div>
      </section>
    </div>
  );
}

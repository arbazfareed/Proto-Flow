import { useEffect, useMemo, useState } from "react";
import {
  Clock3,
  Download,
  History,
  RotateCcw,
  Upload,
  X,
} from "lucide-react";
import type { Project } from "../project/schema";
import {
  compareProjects,
  createProjectCheckpoint,
  exportCheckpoint,
  importCheckpoint,
  listProjectCheckpoints,
  reconstructCheckpoint,
  type VersionCheckpoint,
} from "../project/versionHistory";

interface VersionHistoryDialogProps {
  project: Project;
  filePath: string | null;
  isDirty: boolean;
  onClose: () => void;
  onRestore: (project: Project) => void;
  onNotify: (message: string, isError?: boolean) => void;
}

function formatCheckpointTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function VersionHistoryDialog({
  project,
  filePath,
  isDirty,
  onClose,
  onRestore,
  onNotify,
}: VersionHistoryDialogProps) {
  const [checkpoints, setCheckpoints] = useState<VersionCheckpoint[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const refresh = async () => {
    const next = await listProjectCheckpoints(project.id, filePath);
    setCheckpoints(next);
    setSelectedId((current) =>
      current && next.some((checkpoint) => checkpoint.id === current)
        ? current
        : next.at(-1)?.id ?? null,
    );
  };

  useEffect(() => {
    void refresh().catch((loadError: unknown) => {
      setError(loadError instanceof Error ? loadError.message : "Could not load version history.");
    });
  }, [filePath, project.id]);

  const selectedIndex = checkpoints.findIndex((checkpoint) => checkpoint.id === selectedId);
  const selectedProject = useMemo(() => {
    if (selectedIndex < 0) return null;
    try {
      return reconstructCheckpoint(checkpoints, selectedIndex);
    } catch {
      return null;
    }
  }, [checkpoints, selectedIndex]);
  const changes = useMemo(
    () => selectedProject ? compareProjects(selectedProject, project) : [],
    [project, selectedProject],
  );

  const saveCheckpoint = async (checkpointProject: Project, checkpointLabel: string, source: VersionCheckpoint["source"]) => {
    const checkpoint = await createProjectCheckpoint(
      checkpointProject,
      filePath,
      checkpointLabel,
      source,
      true,
    );
    await refresh();
    setSelectedId(checkpoint.id);
    return checkpoint;
  };

  const createNamedCheckpoint = async () => {
    setBusy(true);
    setError("");
    try {
      const checkpoint = await createProjectCheckpoint(project, filePath, label, "manual");
      setLabel("");
      await refresh();
      setSelectedId(checkpoint.id);
      onNotify("Checkpoint created");
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Could not create a checkpoint.");
    } finally {
      setBusy(false);
    }
  };

  const restoreSelected = async () => {
    if (!selectedProject) return;
    const message = isDirty
      ? "You have unsaved changes. Restore this checkpoint? The current project state will be saved as a restore point first."
      : "Restore this checkpoint? The current project state will be saved as a restore point first.";
    if (window.confirm(message)) {
      setBusy(true);
      setError("");
      try {
        await saveCheckpoint(project, "Before restore", "restore");
        onRestore({ ...selectedProject, id: project.id });
        onNotify("Checkpoint restored. Use Undo to return to the previous project state.");
        onClose();
      } catch (restoreError) {
        setError(restoreError instanceof Error ? restoreError.message : "Could not restore this checkpoint.");
      } finally {
        setBusy(false);
      }
    }
  };

  const exportSelected = async () => {
    if (!selectedProject) return;
    setBusy(true);
    setError("");
    try {
      await exportCheckpoint(selectedProject, `${project.name}-${selectedProject.name}`);
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : "Could not export this checkpoint.");
    } finally {
      setBusy(false);
    }
  };

  const importSelected = async () => {
    setBusy(true);
    setError("");
    try {
      const imported = await importCheckpoint();
      if (!imported) return;
      const normalizedProject = { ...imported, id: project.id };
      const checkpoint = await saveCheckpoint(
        normalizedProject,
        `Imported: ${imported.name}`,
        "imported",
      );
      onNotify(`Imported checkpoint "${checkpoint.label}"`);
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : "Could not import this checkpoint.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="version-history-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section className="version-history-dialog" role="dialog" aria-modal="true" aria-labelledby="version-history-title">
        <header className="version-history-header">
          <div>
            <span className="notes-overline">PROJECT SAFETY</span>
            <h2 id="version-history-title"><History size={17} /> Version history</h2>
            <p>Up to 50 local checkpoints. The 10 newest are stored as full snapshots.</p>
          </div>
          <button className="icon-button" aria-label="Close version history" onClick={onClose}><X size={17} /></button>
        </header>
        <div className="version-history-content">
          <aside className="version-history-timeline" aria-label="Project checkpoints">
            <form className="version-history-create" onSubmit={(event) => {
              event.preventDefault();
              void createNamedCheckpoint();
            }}>
              <label className="field-label" htmlFor="checkpoint-label">Named checkpoint</label>
              <div className="version-history-create-row">
                <input
                  id="checkpoint-label"
                  className="text-field"
                  value={label}
                  maxLength={120}
                  placeholder="Before redesign"
                  onChange={(event) => setLabel(event.currentTarget.value)}
                />
                <button className="button button-primary" type="submit" disabled={busy || !label.trim()}>Create</button>
              </div>
            </form>
            <div className="version-history-list">
              {checkpoints.length === 0 && <p className="version-history-empty">No checkpoints yet. Create one or wait for the automatic checkpoint.</p>}
              {[...checkpoints].reverse().map((checkpoint) => (
                <button
                  key={checkpoint.id}
                  type="button"
                  className={`version-history-item${checkpoint.id === selectedId ? " is-selected" : ""}`}
                  aria-pressed={checkpoint.id === selectedId}
                  onClick={() => {
                    setSelectedId(checkpoint.id);
                    setError("");
                  }}
                >
                  <span className="version-history-item-icon"><Clock3 size={13} /></span>
                  <span className="version-history-item-copy">
                    <strong>{checkpoint.label}</strong>
                    <span>{formatCheckpointTime(checkpoint.createdAt)}</span>
                  </span>
                  <span className={`version-history-source source-${checkpoint.source}`}>{checkpoint.source}</span>
                </button>
              ))}
            </div>
            <button className="button button-secondary version-history-import" type="button" disabled={busy} onClick={() => void importSelected()}>
              <Upload size={14} /> Import .pflow checkpoint
            </button>
          </aside>
          <main className="version-history-preview">
            {!selectedProject ? (
              <div className="version-history-empty-preview"><History size={24} /><p>Select a checkpoint to preview and compare it.</p></div>
            ) : (
              <>
                <div className="version-history-preview-heading">
                  <div>
                    <span className="notes-overline">READ-ONLY PREVIEW</span>
                    <h3>{selectedProject.name}</h3>
                    <p>{selectedProject.screens.length} screens · {selectedProject.screens.reduce((total, screen) => total + screen.widgets.length, 0)} widgets</p>
                  </div>
                  <div className="version-history-actions">
                    <button className="button button-secondary" type="button" disabled={busy} onClick={() => void exportSelected()}><Download size={14} /> Export .pflow</button>
                    <button className="button button-primary" type="button" disabled={busy} onClick={() => void restoreSelected()}><RotateCcw size={14} /> Restore</button>
                  </div>
                </div>
                <div className="version-history-screen-list">
                  {selectedProject.screens.map((screen) => (
                    <article className="version-history-screen" key={screen.id}>
                      <div className="version-history-thumbnail" aria-hidden="true">
                        {screen.widgets.map((widget) => (
                          <span
                            key={widget.id}
                            style={{
                              left: `${Math.max(0, Math.min(100, widget.x / Math.max(1, screen.device?.width ?? 1440) * 100))}%`,
                              top: `${Math.max(0, Math.min(100, widget.y / Math.max(1, screen.device?.height ?? 900) * 100))}%`,
                              width: `${Math.max(1, Math.min(100, widget.width / Math.max(1, screen.device?.width ?? 1440) * 100))}%`,
                              height: `${Math.max(1, Math.min(100, widget.height / Math.max(1, screen.device?.height ?? 900) * 100))}%`,
                              backgroundColor: typeof widget.style.fill === "string" ? widget.style.fill : "#9585bf",
                            }}
                          />
                        ))}
                      </div>
                      <div className="version-history-screen-copy">
                        <strong>{screen.name}</strong>
                        <span>{screen.widgets.length} widgets</span>
                      </div>
                    </article>
                  ))}
                </div>
                <div className="version-history-diff">
                  <div className="version-history-diff-heading">
                    <h3>Changes since checkpoint</h3>
                    <span>{changes.length} change{changes.length === 1 ? "" : "s"}</span>
                  </div>
                  {changes.length === 0 ? (
                    <p className="version-history-empty">The current project matches this checkpoint.</p>
                  ) : (
                    <ul>
                      {changes.map((change, index) => (
                        <li key={`${change.screen}-${change.widget}-${index}`} className={`diff-${change.change}`}>
                          <span className="version-history-diff-badge">{change.change}</span>
                          <span><strong>{change.widget}</strong><small>{change.screen} · {change.details.join(", ")}</small></span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </>
            )}
          </main>
        </div>
        {error && <p className="version-history-error" role="alert">{error}</p>}
        <footer className="version-history-footer">
          <span>{checkpoints.length}/{50} checkpoints · Stored locally on this device</span>
          <button className="button button-quiet" type="button" onClick={onClose}>Close</button>
        </footer>
      </section>
    </div>
  );
}

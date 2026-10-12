import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  ArrowDownToLine,
  ArrowRight,
  Bell,
  Check,
  ChevronDown,
  CircleHelp,
  Clock3,
  Command,
  FilePlus2,
  FileText,
  FolderOpen,
  Keyboard,
  Layers2,
  MoreHorizontal,
  Minus,
  PanelLeftClose,
  PanelRightClose,
  Plus,
  Square,
  Redo2,
  Search,
  Settings2,
  Sparkles,
  Undo2,
  X,
} from "lucide-react";
import { clearRecoverySnapshot, readRecoverySnapshot, writeRecoverySnapshot, type RecoverySnapshot } from "./project/recovery";
import { openProjectFile, saveProjectFile } from "./project/files";
import { useProjectStore } from "./project/store";
import "./App.css";

type CommandItem = {
  label: string;
  shortcut?: string;
  icon: ReactNode;
  run: () => void | Promise<void>;
};

function App() {
  const project = useProjectStore((state) => state.project);
  const filePath = useProjectStore((state) => state.filePath);
  const isDirty = useProjectStore((state) => state.isDirty);
  const past = useProjectStore((state) => state.past);
  const future = useProjectStore((state) => state.future);
  const newProject = useProjectStore((state) => state.newProject);
  const loadProject = useProjectStore((state) => state.loadProject);
  const restoreProject = useProjectStore((state) => state.restoreProject);
  const renameProject = useProjectStore((state) => state.renameProject);
  const undo = useProjectStore((state) => state.undo);
  const redo = useProjectStore((state) => state.redo);
  const [notice, setNotice] = useState("");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState("");
  const [recovery, setRecovery] = useState<RecoverySnapshot | null>(null);
  const [updateNotice, setUpdateNotice] = useState(false);
  const [leftPanelOpen, setLeftPanelOpen] = useState(true);
  const [rightPanelOpen, setRightPanelOpen] = useState(true);
  const paletteInput = useRef<HTMLInputElement>(null);

  const notify = useCallback((message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 4000);
  }, []);

  const save = useCallback(async (saveAs = false) => {
    const current = useProjectStore.getState();
    try {
      const path = await saveProjectFile(
        current.project,
        saveAs ? null : current.filePath,
      );
      if (!path) return;
      useProjectStore.getState().markSaved(path);
      try {
        clearRecoverySnapshot();
      } catch (error) {
        console.error("Could not clear the saved recovery snapshot.", error);
      }
      notify("Project saved");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not save project.");
    }
  }, [notify]);

  const confirmDiscard = useCallback(() => {
    const current = useProjectStore.getState();
    return !current.isDirty || window.confirm("You have unsaved changes. Continue without saving them?");
  }, []);

  const openFile = useCallback(async () => {
    if (!confirmDiscard()) return;
    try {
      const result = await openProjectFile();
      if (!result) return;
      loadProject(result.project, result.path);
      try {
        clearRecoverySnapshot();
      } catch (error) {
        console.error("Could not clear the previous recovery snapshot.", error);
      }
      notify("Project opened");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not open project.");
    }
  }, [confirmDiscard, loadProject, notify]);

  const createNewProject = useCallback(() => {
    if (!confirmDiscard()) return;
    newProject();
    notify("New project created");
  }, [confirmDiscard, newProject, notify]);

  const commands = useMemo<CommandItem[]>(
    () => [
      { label: "New project", shortcut: "Ctrl N", icon: <FilePlus2 />, run: createNewProject },
      { label: "Open project", shortcut: "Ctrl O", icon: <FolderOpen />, run: openFile },
      { label: "Save project", shortcut: "Ctrl S", icon: <ArrowDownToLine />, run: () => save() },
      { label: "Save project as…", shortcut: "Ctrl Shift S", icon: <FileText />, run: () => save(true) },
      { label: "Undo", shortcut: "Ctrl Z", icon: <Undo2 />, run: undo },
      { label: "Redo", shortcut: "Ctrl Shift Z", icon: <Redo2 />, run: redo },
      {
        label: "Check for updates",
        icon: <Bell />,
        run: () => setUpdateNotice(true),
      },
    ],
    [createNewProject, openFile, redo, save, undo],
  );

  useEffect(() => {
    try {
      setRecovery(readRecoverySnapshot());
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not check crash recovery data.");
    }
  }, [notify]);

  useEffect(() => {
    const saveRecovery = () => {
      const current = useProjectStore.getState();
      if (!current.isDirty) return;
      try {
        writeRecoverySnapshot(current.project, current.filePath);
      } catch (error) {
        console.error("Could not write Proto Flow recovery data.", error);
      }
    };
    const interval = window.setInterval(() => {
      const current = useProjectStore.getState();
      if (!current.isDirty) return;
      try {
        writeRecoverySnapshot(current.project, current.filePath);
        notify("Recovery checkpoint saved");
      } catch (error) {
        notify(error instanceof Error ? error.message : "Could not save recovery checkpoint.");
      }
    }, 30_000);
    window.addEventListener("pagehide", saveRecovery);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("pagehide", saveRecovery);
    };
  }, [notify]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const modifier = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();
      const target = event.target;
      const editing = target instanceof HTMLElement &&
        (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

      if (modifier && key === "k") {
        event.preventDefault();
        setPaletteQuery("");
        setPaletteOpen((open) => !open);
        return;
      }
      if (event.key === "Escape") {
        setPaletteOpen(false);
        return;
      }
      if (!modifier) return;
      if (key === "s") {
        event.preventDefault();
        void save(event.shiftKey);
      } else if (!editing && key === "z") {
        event.preventDefault();
        event.shiftKey ? redo() : undo();
      } else if (!editing && key === "y") {
        event.preventDefault();
        redo();
      } else if (key === "n") {
        event.preventDefault();
        createNewProject();
      } else if (key === "o") {
        event.preventDefault();
        void openFile();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [createNewProject, openFile, redo, save, undo]);

  useEffect(() => {
    if (paletteOpen) paletteInput.current?.focus();
  }, [paletteOpen]);

  const filteredCommands = commands.filter((command) =>
    command.label.toLowerCase().includes(paletteQuery.toLowerCase()),
  );

  const restore = () => {
    if (!recovery) return;
    restoreProject(recovery.project, recovery.filePath);
    setRecovery(null);
    notify("Recovered project restored");
  };

  const discardRecovery = () => {
    try {
      clearRecoverySnapshot();
      setRecovery(null);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not discard recovery data.");
    }
  };

  const runCommand = (command: CommandItem) => {
    setPaletteOpen(false);
    void command.run();
  };

  const runWindowAction = (action: "minimize" | "maximize" | "close") => {
    if (!isTauri()) return;
    const window = getCurrentWindow();
    const operation =
      action === "minimize"
        ? window.minimize()
        : action === "maximize"
          ? window.toggleMaximize()
          : window.close();
    void operation.catch((error: unknown) => {
      notify(error instanceof Error ? error.message : "Could not control the app window.");
    });
  };

  const displayPath = filePath ? filePath.replaceAll("\\", "/").split("/").at(-1) : "Not saved yet";

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-lockup" data-tauri-drag-region>
          <div className="brand-mark">P<span>F</span></div>
          <span className="brand-name">proto<span>flow</span></span>
          <div className="topbar-divider" />
          <div className="document-heading">
            <span className="document-name">{project.name}</span>
            <span className={`save-state ${isDirty ? "is-dirty" : ""}`}>
              <span className="state-dot" />
              {isDirty ? "Unsaved changes" : "All changes saved"}
            </span>
          </div>
        </div>
        <div className="topbar-actions">
          <button className="icon-button topbar-icon" title="Undo (Ctrl+Z)" aria-label="Undo" disabled={!past.length} onClick={undo}>
            <Undo2 size={17} />
          </button>
          <button className="icon-button topbar-icon" title="Redo (Ctrl+Shift+Z)" aria-label="Redo" disabled={!future.length} onClick={redo}>
            <Redo2 size={17} />
          </button>
          <div className="topbar-divider compact-divider" />
          <button className="button button-quiet command-trigger" onClick={() => setPaletteOpen(true)}>
            <Search size={15} /> <span>Quick actions</span><kbd>Ctrl K</kbd>
          </button>
          <button className="button button-secondary" onClick={() => void save(true)}>
            <ArrowDownToLine size={15} /> Save as
          </button>
          <button className="button button-primary" onClick={() => void save()}>
            <span>Save</span><kbd>Ctrl S</kbd>
          </button>
          <button className="icon-button avatar-button" title="Proto Flow profile">P</button>
          {isTauri() && (
            <div className="window-controls" aria-label="Window controls">
              <button className="window-control" aria-label="Minimize window" onClick={() => runWindowAction("minimize")}><Minus size={14} /></button>
              <button className="window-control" aria-label="Maximize window" onClick={() => runWindowAction("maximize")}><Square size={11} /></button>
              <button className="window-control window-close" aria-label="Close window" onClick={() => runWindowAction("close")}><X size={14} /></button>
            </div>
          )}
        </div>
      </header>

      <div className="workspace">
        {leftPanelOpen && (
          <aside className="sidebar left-sidebar">
            <div className="sidebar-heading">
              <span>WORKSPACE</span>
              <button className="icon-button small-icon" aria-label="Close workspace panel" onClick={() => setLeftPanelOpen(false)}>
                <PanelLeftClose size={15} />
              </button>
            </div>
            <div className="workspace-card">
              <div className="workspace-card-icon"><Layers2 size={16} /></div>
              <div className="workspace-card-copy"><strong>My workspace</strong><span>Local projects</span></div>
              <button className="icon-button small-icon" title="Workspace options"><MoreHorizontal size={16} /></button>
            </div>
            <div className="sidebar-section">
              <div className="section-label"><span>PROJECT</span><button className="icon-button small-icon" aria-label="New project" onClick={createNewProject}><Plus size={15} /></button></div>
              <button className="nav-item active"><FileText size={16} /><span>{project.name}</span><span className="nav-unsaved">{isDirty ? "•" : ""}</span></button>
              <button className="nav-item" onClick={() => void openFile()}><FolderOpen size={16} /><span>Open project…</span><kbd>⌘O</kbd></button>
            </div>
            <div className="sidebar-section pages-section">
              <div className="section-label"><span>PAGES</span><button className="icon-button small-icon" aria-label="Add page" title="Pages are coming with canvas editing"><Plus size={15} /></button></div>
              <button className="page-item selected"><span className="page-thumb"><span /></span><span>{project.screens[0]?.name ?? "Screen 1"}</span><span className="page-count">1</span></button>
            </div>
            <div className="sidebar-footer">
              <button className="nav-item" onClick={() => setPaletteOpen(true)}><Keyboard size={16} /><span>Keyboard shortcuts</span></button>
              <button className="nav-item" onClick={() => setUpdateNotice(true)}><CircleHelp size={16} /><span>Help & updates</span></button>
              <div className="sidebar-version"><span className="version-pulse" /> Phase 1 · Local workspace</div>
            </div>
          </aside>
        )}

        <main className="canvas-area">
          <div className="canvas-toolbar">
            <div className="breadcrumb">
              {!leftPanelOpen && <button className="icon-button small-icon" aria-label="Show workspace panel" onClick={() => setLeftPanelOpen(true)}><PanelLeftClose size={15} /></button>}
              <span className="breadcrumb-muted">Workspace</span><ArrowRight size={13} /><span>{project.name}</span>
            </div>
            <div className="canvas-toolbar-actions">
              <span className="canvas-mode"><span className="mode-dot" /> Canvas</span>
              {!rightPanelOpen && <button className="icon-button small-icon" aria-label="Show inspector panel" onClick={() => setRightPanelOpen(true)}><PanelRightClose size={15} /></button>}
              <button className="icon-button small-icon" title="More canvas actions"><MoreHorizontal size={17} /></button>
            </div>
          </div>
          <div className="canvas-stage">
            <div className="canvas-grid" />
            <div className="canvas-empty-state">
              <div className="empty-icon-wrap"><Layers2 size={22} /></div>
              <span className="eyebrow">YOUR CANVAS STARTS HERE</span>
              <h1>A little room to think.</h1>
              <p>Your project is ready. The visual canvas arrives in Phase 2 — for now, name your project and save it locally.</p>
              <div className="canvas-empty-actions">
                <button className="button button-primary" onClick={() => void save(true)}><ArrowDownToLine size={15} /> Save your project</button>
                <button className="button button-secondary" onClick={() => void openFile()}><FolderOpen size={15} /> Open a project</button>
              </div>
              <div className="empty-shortcut"><Command size={13} /> Press <kbd>Ctrl K</kbd> to see all actions</div>
            </div>
            <div className="canvas-zoom">100% <ChevronDown size={13} /></div>
          </div>
          <div className="canvas-statusbar">
            <span><span className="status-indicator" /> Local project</span>
            <span>{project.screens.length} screen</span>
            <span className="status-spacer" />
            <span>Autosave every 30 sec</span>
          </div>
        </main>

        {rightPanelOpen && (
          <aside className="sidebar inspector">
            <div className="inspector-top">
              <div><span className="inspector-overline">PROPERTIES</span><h2>Project details</h2></div>
              <button className="icon-button small-icon" aria-label="Close inspector" onClick={() => setRightPanelOpen(false)}><PanelRightClose size={15} /></button>
            </div>
            <div className="inspector-body">
              <label className="field-label" htmlFor="project-name">Project name</label>
              <input id="project-name" className="text-field" value={project.name} maxLength={120} onChange={(event) => renameProject(event.currentTarget.value)} />
              <p className="field-hint">A name helps keep your ideas organized.</p>

              <div className="inspector-rule" />
              <div className="detail-row"><span>File</span><span className={`file-value ${filePath ? "" : "muted-value"}`} title={filePath ?? "Not saved yet"}>{displayPath}</span></div>
              <div className="detail-row"><span>Format</span><span className="format-chip">.pflow <span>v1</span></span></div>
              <div className="detail-row"><span>Screens</span><span>{project.screens.length}</span></div>
              <div className="detail-row"><span>Widgets</span><span>{project.screens.reduce((total, screen) => total + screen.widgets.length, 0)}</span></div>

              <div className="inspector-rule" />
              <div className="section-label update-label"><span>UPDATES</span><Sparkles size={14} /></div>
              <div className="update-card">
                <div className="update-card-icon"><Bell size={15} /></div>
                <div><strong>Stay up to date</strong><p>Update checks become available when a signed release feed is configured.</p></div>
              </div>
              <button className="button button-quiet update-check" onClick={() => setUpdateNotice(true)}>Check for updates <ArrowRight size={14} /></button>

              <div className="inspector-rule" />
              <div className="recovery-note"><Clock3 size={15} /><span>Recovery checkpoints are stored on this device every 30 seconds while you have unsaved changes.</span></div>
            </div>
            <div className="inspector-footer"><Settings2 size={14} /><span>Project schema</span><span className="schema-version">{project.schemaVersion}</span></div>
          </aside>
        )}
      </div>

      {notice && <div className="toast" role="status"><Check size={15} /><span>{notice}</span></div>}

      {paletteOpen && (
        <div className="overlay palette-overlay" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setPaletteOpen(false);
        }}>
          <section className="command-palette" aria-label="Command palette">
            <div className="palette-search"><Search size={17} /><input ref={paletteInput} value={paletteQuery} onChange={(event) => setPaletteQuery(event.currentTarget.value)} placeholder="What would you like to do?" /><kbd>ESC</kbd></div>
            <div className="palette-list">
              <span className="palette-label">ACTIONS</span>
              {filteredCommands.length ? filteredCommands.map((command) => (
                <button className="palette-item" key={command.label} onClick={() => runCommand(command)}>
                  <span className="palette-item-icon">{command.icon}</span><span>{command.label}</span>{command.shortcut && <kbd>{command.shortcut}</kbd>}
                </button>
              )) : <div className="palette-empty">No matching actions</div>}
            </div>
            <div className="palette-footer"><span><Keyboard size={13} /> Navigate with your keyboard</span><span>PROTO FLOW <b>·</b> PHASE 1</span></div>
          </section>
        </div>
      )}

      {recovery && (
        <div className="overlay">
          <section className="dialog-card" role="dialog" aria-modal="true" aria-labelledby="recovery-title">
            <div className="dialog-icon recovery-dialog-icon"><Clock3 size={19} /></div>
            <button className="icon-button dialog-close" aria-label="Discard recovery prompt" onClick={discardRecovery}><X size={17} /></button>
            <span className="eyebrow">CRASH RECOVERY</span>
            <h2 id="recovery-title">Pick up where you left off?</h2>
            <p>Proto Flow found unsaved changes from {new Date(recovery.recoveredAt).toLocaleString()}. Restore the recovered copy of <strong>{recovery.project.name}</strong>?</p>
            <div className="dialog-actions"><button className="button button-quiet" onClick={discardRecovery}>Discard</button><button className="button button-primary" onClick={restore}>Restore project <ArrowRight size={15} /></button></div>
          </section>
        </div>
      )}

      {updateNotice && (
        <div className="overlay">
          <section className="dialog-card update-dialog" role="dialog" aria-modal="true" aria-labelledby="update-title">
            <button className="icon-button dialog-close" aria-label="Close update information" onClick={() => setUpdateNotice(false)}><X size={17} /></button>
            <div className="dialog-icon"><Sparkles size={19} /></div>
            <span className="eyebrow">PROTO FLOW UPDATES</span>
            <h2 id="update-title">Updates aren't connected yet.</h2>
            <p>Automatic update checks need a signed release feed and its public verification key. No update check was made. Configure these when setting up your release channel.</p>
            <div className="dialog-actions"><button className="button button-primary" onClick={() => setUpdateNotice(false)}>Got it</button></div>
          </section>
        </div>
      )}
    </div>
  );
}

export default App;

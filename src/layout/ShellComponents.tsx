import {
  ArrowDownToLine,
  ArrowRight,
  Bell,
  ChevronDown,
  CircleHelp,
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
  Redo2,
  Sparkles,
  Square,
  Undo2,
  X,
} from "lucide-react";
import { isTauri } from "@tauri-apps/api/core";
import { useStore } from "../store";

interface TopBarProps {
  onNew: () => void;
  onOpen: () => void;
  onSave: () => void;
  onSaveAs: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onOpenPalette: () => void;
  onWindowAction: (action: "minimize" | "maximize" | "close") => void;
}

export function TopBar({
  onNew,
  onOpen,
  onSave,
  onSaveAs,
  onUndo,
  onRedo,
  onOpenPalette,
  onWindowAction,
}: TopBarProps) {
  const projectName = useStore((state) => state.project.name);
  const isDirty = useStore((state) => state.isDirty);
  const canUndo = useStore((state) => state.past.length > 0);
  const canRedo = useStore((state) => state.future.length > 0);

  return (
    <header className="topbar" data-tauri-drag-region>
      <div className="brand-lockup" data-tauri-drag-region>
        <div className="brand-mark">P<span>F</span></div>
        <span className="brand-name">proto<span>flow</span></span>
        <div className="topbar-divider" />
        <div className="document-heading">
          <span className="document-name">{projectName}</span>
          <span className={`save-state ${isDirty ? "is-dirty" : ""}`}>
            <span className="state-dot" />
            {isDirty ? "Unsaved changes" : "All changes saved"}
          </span>
        </div>
      </div>
      <div className="topbar-actions">
        <button className="icon-button topbar-icon" title="New project (Ctrl+N)" aria-label="New project" onClick={onNew}>
          <FilePlus2 size={16} />
        </button>
        <button className="icon-button topbar-icon" title="Open project (Ctrl+O)" aria-label="Open project" onClick={onOpen}>
          <FolderOpen size={16} />
        </button>
        <button className="icon-button topbar-icon" title="Undo (Ctrl+Z)" aria-label="Undo" disabled={!canUndo} onClick={onUndo}>
          <Undo2 size={16} />
        </button>
        <button className="icon-button topbar-icon" title="Redo (Ctrl+Shift+Z)" aria-label="Redo" disabled={!canRedo} onClick={onRedo}>
          <Redo2 size={16} />
        </button>
        <div className="topbar-divider compact-divider" />
        <button className="button button-quiet command-trigger" onClick={onOpenPalette}>
          <span>Quick actions</span><kbd>Ctrl K</kbd>
        </button>
        <button className="button button-secondary" onClick={onSaveAs}>
          <ArrowDownToLine size={14} /> Save as
        </button>
        <button className="button button-primary" onClick={onSave}>
          Save <kbd>Ctrl S</kbd>
        </button>
        <span className="wallet-placeholder" aria-label="Wallet balance available in Phase 3">Wallet · Phase 3</span>
        {isTauri() && (
          <div className="window-controls" aria-label="Window controls">
            <button className="window-control" aria-label="Minimize window" onClick={() => onWindowAction("minimize")}><Minus size={14} /></button>
            <button className="window-control" aria-label="Maximize window" onClick={() => onWindowAction("maximize")}><Square size={11} /></button>
            <button className="window-control window-close" aria-label="Close window" onClick={() => onWindowAction("close")}><X size={14} /></button>
          </div>
        )}
      </div>
    </header>
  );
}

interface LeftSidebarProps {
  onNew: () => void;
  onOpen: () => void;
  onToggle: () => void;
  onOpenPalette: () => void;
  onUpdates: () => void;
}

export function LeftSidebar({ onNew, onOpen, onToggle, onOpenPalette, onUpdates }: LeftSidebarProps) {
  const project = useStore((state) => state.project);
  const isDirty = useStore((state) => state.isDirty);
  const leftPanelOpen = useStore((state) => state.leftPanelOpen);

  if (!leftPanelOpen) return null;

  return (
    <aside className="sidebar left-sidebar">
      <div className="sidebar-heading">
        <span>WORKSPACE</span>
        <button className="icon-button small-icon" aria-label="Close workspace panel" onClick={onToggle}>
          <PanelLeftClose size={15} />
        </button>
      </div>
      <div className="workspace-card">
        <div className="workspace-card-icon"><Layers2 size={16} /></div>
        <div className="workspace-card-copy"><strong>My workspace</strong><span>Local projects</span></div>
        <button className="icon-button small-icon" title="Workspace options" aria-label="Workspace options"><MoreHorizontal size={16} /></button>
      </div>
      <div className="sidebar-section">
        <div className="section-label"><span>PROJECT</span><button className="icon-button small-icon" aria-label="New project" onClick={onNew}><Plus size={15} /></button></div>
        <button className="nav-item active"><FileText size={16} /><span>{project.name}</span><span className="nav-unsaved">{isDirty ? "•" : ""}</span></button>
        <button className="nav-item" onClick={onOpen}><FolderOpen size={16} /><span>Open project…</span><kbd>Ctrl O</kbd></button>
      </div>
      <div className="sidebar-section pages-section">
        <div className="section-label"><span>SCREENS</span><button className="icon-button small-icon" aria-label="Add screen" title="Screen editing is coming with canvas editing"><Plus size={15} /></button></div>
        {project.screens.length ? project.screens.map((screen) => (
          <button className="page-item selected" key={screen.id}>
            <span className="page-thumb"><span /></span><span>{screen.name}</span><span className="page-count">{screen.widgets.length}</span>
          </button>
        )) : <p className="sidebar-empty">Screens will appear here.</p>}
      </div>
      <div className="sidebar-section layers-section">
        <div className="section-label"><span>LAYERS</span></div>
        <div className="sidebar-empty-state">
          <Layers2 size={16} />
          <span>Widget layers will appear here in Phase 2.</span>
        </div>
      </div>
      <div className="sidebar-footer">
        <button className="nav-item" onClick={onOpenPalette}><Keyboard size={16} /><span>Keyboard shortcuts</span></button>
        <button className="nav-item" onClick={onUpdates}><CircleHelp size={16} /><span>Help & updates</span></button>
        <div className="sidebar-version"><span className="version-pulse" /> Phase 1 · Local workspace</div>
      </div>
    </aside>
  );
}

interface CanvasAreaProps {
  onToggleLeft: () => void;
  onToggleRight: () => void;
  onSaveAs: () => void;
  onOpen: () => void;
  onOpenPalette: () => void;
}

export function CanvasArea({
  onToggleLeft,
  onToggleRight,
  onSaveAs,
  onOpen,
  onOpenPalette,
}: CanvasAreaProps) {
  const project = useStore((state) => state.project);
  const leftPanelOpen = useStore((state) => state.leftPanelOpen);
  const rightPanelOpen = useStore((state) => state.rightPanelOpen);
  const gridVisible = useStore((state) => state.gridVisible);

  return (
    <main className="canvas-area">
      <div className="canvas-toolbar">
        <div className="breadcrumb">
          {!leftPanelOpen && <button className="icon-button small-icon" aria-label="Show workspace panel" onClick={onToggleLeft}><PanelLeftClose size={15} /></button>}
          <span className="breadcrumb-muted">Workspace</span><ArrowRight size={13} /><span>{project.name}</span>
        </div>
        <div className="canvas-toolbar-actions">
          <span className="canvas-mode"><span className="mode-dot" /> Canvas</span>
          {!rightPanelOpen && <button className="icon-button small-icon" aria-label="Show inspector panel" onClick={onToggleRight}><PanelRightClose size={15} /></button>}
          <button className="icon-button small-icon" title="More canvas actions" aria-label="More canvas actions"><MoreHorizontal size={17} /></button>
        </div>
      </div>
      <div className="canvas-stage">
        {gridVisible && <div className="canvas-grid" />}
        <div className="canvas-empty-state">
          <div className="empty-icon-wrap"><Layers2 size={22} /></div>
          <span className="eyebrow">YOUR CANVAS STARTS HERE</span>
          <h1>A little room to think.</h1>
          <p>Your project is ready. The visual canvas arrives in Phase 2 — for now, name your project and save it locally.</p>
          <div className="canvas-empty-actions">
            <button className="button button-primary" onClick={onSaveAs}><ArrowDownToLine size={15} /> Save your project</button>
            <button className="button button-secondary" onClick={onOpen}><FolderOpen size={15} /> Open a project</button>
          </div>
          <div className="empty-shortcut"><span>Press</span> <button className="shortcut-link" onClick={onOpenPalette}>Ctrl K</button> <span>to see all actions</span></div>
        </div>
        <div className="canvas-zoom">100% <ChevronDown size={13} /></div>
      </div>
    </main>
  );
}

interface RightInspectorProps {
  onToggle: () => void;
  onUpdates: () => void;
  onRename: (name: string) => void;
}

export function RightInspector({ onToggle, onUpdates, onRename }: RightInspectorProps) {
  const project = useStore((state) => state.project);
  const filePath = useStore((state) => state.filePath);
  const rightPanelOpen = useStore((state) => state.rightPanelOpen);
  const displayPath = filePath ? filePath.replaceAll("\\", "/").split("/").at(-1) : "Not saved yet";

  if (!rightPanelOpen) return null;

  return (
    <aside className="sidebar inspector">
      <div className="inspector-top">
        <div><span className="inspector-overline">INSPECTOR</span><h2>Select a shape</h2></div>
        <button className="icon-button small-icon" aria-label="Close inspector" onClick={onToggle}><PanelRightClose size={15} /></button>
      </div>
      <div className="inspector-body">
        <div className="inspector-placeholder"><span className="inspector-placeholder-icon"><Layers2 size={17} /></span><span>Select a shape on the canvas to inspect its properties.</span></div>
        <div className="inspector-rule" />
        <div className="section-label inspector-project-label"><span>PROJECT DETAILS</span></div>
        <label className="field-label" htmlFor="project-name">Project name</label>
        <input id="project-name" className="text-field" value={project.name} maxLength={120} onChange={(event) => onRename(event.currentTarget.value)} />
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
        <button className="button button-quiet update-check" onClick={onUpdates}>Check for updates <ArrowRight size={14} /></button>
        <div className="inspector-rule" />
        <div className="recovery-note"><span>Recovery checkpoints are stored on this device every 30 seconds while you have unsaved changes.</span></div>
      </div>
      <div className="inspector-footer"><span>Project schema</span><span className="schema-version">{project.schemaVersion}</span></div>
    </aside>
  );
}

export function StatusBar() {
  const zoom = useStore((state) => state.zoom);
  const selectedCount = useStore((state) => state.selectedIds.length);

  return (
    <footer className="app-statusbar">
      <span><span className="status-indicator" /> Local project</span>
      <span>{Math.round(zoom * 100)}%</span>
      <span>{selectedCount} selected</span>
      <span className="status-spacer" />
      <span>ProtoFlow 0.1.0</span>
    </footer>
  );
}

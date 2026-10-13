import { lazy, Suspense, useState } from "react";
import {
  ArrowDownToLine,
  ArrowRight,
  Bell,
  CircleHelp,
  FilePlus2,
  FileText,
  FolderOpen,
  Keyboard,
  Lock,
  Layers2,
  MoreHorizontal,
  Minus,
  PanelLeftClose,
  PanelRightClose,
  Plus,
  Redo2,
  Sparkles,
  Square,
  Unlock,
  Undo2,
  X,
} from "lucide-react";
import { isTauri } from "@tauri-apps/api/core";
import { useStore } from "../store";
import {
  PRIMITIVE_TOOLS,
  WIDGET_TOOLS,
  getShapeToolDefinition,
  type ShapeTool,
} from "../canvas/shapeTools";

const CanvasStage = lazy(() =>
  import("../canvas/CanvasStage").then((module) => ({
    default: module.CanvasStage,
  })),
);

interface TopBarProps {
  onNew: () => void;
  onOpen: () => void;
  onSave: () => void;
  onSaveAs: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onOpenPalette: () => void;
  onStartDragging: () => void;
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
  onStartDragging,
  onWindowAction,
}: TopBarProps) {
  const projectName = useStore((state) => state.project.name);
  const isDirty = useStore((state) => state.isDirty);
  const canUndo = useStore((state) => state.past.length > 0);
  const canRedo = useStore((state) => state.future.length > 0);

  return (
    <header
      className="topbar"
      data-tauri-drag-region
      onMouseDown={(event) => {
        if (
          event.button === 0 &&
          !(event.target instanceof HTMLElement &&
            event.target.closest("button, input, a, [role='button']"))
        ) {
          onStartDragging();
        }
      }}
    >
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
  const selectedIds = useStore((state) => state.selectedIds);
  const activeScreen = project.screens.find((screen) => screen.id === project.startScreenId);

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
        <button className="icon-button small-icon" title="Workspace options are coming later" aria-label="Workspace options" disabled><MoreHorizontal size={16} /></button>
      </div>
      <div className="sidebar-section">
        <div className="section-label"><span>PROJECT</span><button className="icon-button small-icon" aria-label="New project" onClick={onNew}><Plus size={15} /></button></div>
        <div className="nav-item active" aria-current="page"><FileText size={16} /><span>{project.name}</span><span className="nav-unsaved">{isDirty ? "•" : ""}</span></div>
        <button className="nav-item" onClick={onOpen}><FolderOpen size={16} /><span>Open project…</span><kbd>Ctrl O</kbd></button>
      </div>
      <div className="sidebar-section pages-section">
        <div className="section-label"><span>SCREENS</span><button className="icon-button small-icon" aria-label="Add screen" title="Screen editing is coming with canvas editing" disabled><Plus size={15} /></button></div>
        {project.screens.length ? project.screens.map((screen) => (
          <div className="page-item selected" key={screen.id} aria-current={screen.id === project.startScreenId ? "page" : undefined}>
            <span className="page-thumb"><span /></span><span>{screen.name}</span><span className="page-count">{screen.widgets.length}</span>
          </div>
        )) : <p className="sidebar-empty">Screens will appear here.</p>}
      </div>
      <div className="sidebar-section layers-section">
        <div className="section-label"><span>LAYERS</span></div>
        {activeScreen?.widgets.length ? (
          <div className="layer-list" aria-label="Widget layers">
            {[...activeScreen.widgets].sort((a, b) => b.zIndex - a.zIndex).map((widget) => {
              const definition = getShapeToolDefinition(widget.type);
              const Icon = definition?.icon ?? Layers2;
              const labelValue =
                widget.props.label ?? widget.props.text ?? widget.props.fileName;
              const label =
                typeof labelValue === "string" && labelValue.trim()
                  ? labelValue.trim()
                  : definition?.label ?? widget.type;
              const selected = selectedIds.includes(widget.id);
              return (
                <div
                  className={`layer-row${selected ? " is-selected" : ""}${widget.locked ? " is-locked" : ""}`}
                  key={widget.id}
                >
                  <button
                    className="layer-select"
                    aria-label={`Select ${definition?.label ?? widget.type}: ${label}`}
                    aria-pressed={selected}
                    onClick={(event) => {
                      const current = useStore.getState().selectedIds;
                      useStore.getState().select(
                        event.shiftKey
                          ? current.includes(widget.id)
                            ? current.filter((id) => id !== widget.id)
                            : [...current, widget.id]
                          : [widget.id],
                      );
                    }}
                  >
                    <Icon size={14} aria-hidden="true" />
                    <span className="layer-copy">
                      <span className="layer-name">{label}</span>
                      <span className="layer-type">{definition?.label ?? widget.type}</span>
                    </span>
                  </button>
                  <button
                    className="layer-lock"
                    aria-label={`${widget.locked ? "Unlock" : "Lock"} ${definition?.label ?? widget.type}: ${label}`}
                    aria-pressed={widget.locked}
                    title={widget.locked ? "Unlock layer" : "Lock layer"}
                    onClick={() => {
                      const current = useStore.getState();
                      current.setProject({
                        ...current.project,
                        updatedAt: new Date().toISOString(),
                        screens: current.project.screens.map((screen) =>
                          screen.id !== current.project.startScreenId
                            ? screen
                            : {
                                ...screen,
                                widgets: screen.widgets.map((item) =>
                                  item.id === widget.id
                                    ? { ...item, locked: !item.locked }
                                    : item,
                                ),
                              },
                        ),
                      });
                    }}
                  >
                    {widget.locked ? <Lock size={13} /> : <Unlock size={13} />}
                  </button>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="sidebar-empty-state">
            <Layers2 size={16} />
            <span>Widgets will appear here as you add them.</span>
          </div>
        )}
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
  onNotify: (message: string, isError?: boolean) => void;
}

export function CanvasArea({
  onToggleLeft,
  onToggleRight,
  onSaveAs,
  onOpen,
  onOpenPalette,
  onNotify,
}: CanvasAreaProps) {
  const project = useStore((state) => state.project);
  const leftPanelOpen = useStore((state) => state.leftPanelOpen);
  const rightPanelOpen = useStore((state) => state.rightPanelOpen);
  const gridSize = useStore((state) => state.gridSize);
  const gridStyle = useStore((state) => state.gridStyle);
  const gridVisible = useStore((state) => state.gridVisible);
  const snapEnabled = useStore((state) => state.snapEnabled);
  const setGridSize = useStore((state) => state.setGridSize);
  const setGridStyle = useStore((state) => state.setGridStyle);
  const toggleGrid = useStore((state) => state.toggleGrid);
  const toggleSnap = useStore((state) => state.toggleSnap);
  const [viewMenuOpen, setViewMenuOpen] = useState(false);
  const [activeTool, setActiveTool] = useState<ShapeTool | null>(null);

  return (
    <main className="canvas-area">
      <div className="canvas-toolbar">
        <div className="breadcrumb">
          {!leftPanelOpen && <button className="icon-button small-icon" aria-label="Show workspace panel" onClick={onToggleLeft}><PanelLeftClose size={15} /></button>}
          <span className="breadcrumb-muted">Workspace</span><ArrowRight size={13} /><span>{project.name}</span>
        </div>
        <div className="canvas-toolbar-actions">
          <div className="shape-tools" role="toolbar" aria-label="Canvas tools">
            {([["Shapes", PRIMITIVE_TOOLS], ["Widgets", WIDGET_TOOLS]] as const).map(
              ([groupName, tools]) => (
                <div className="shape-tool-group" key={groupName} role="group" aria-label={groupName}>
                  <span className="shape-tool-group-label">{groupName}</span>
                  <div className="shape-tool-buttons">
                    {tools.map((tool) => {
                      const definition = getShapeToolDefinition(tool);
                      if (!definition) return null;
                      const ToolIcon = definition.icon;
                      return (
                        <button
                          key={tool}
                          className={`icon-button small-icon shape-tool-button${activeTool === tool ? " is-active" : ""}`}
                          type="button"
                          aria-label={`Draw ${definition.label}`}
                          aria-pressed={activeTool === tool}
                          title={`${definition.label}${definition.shortcut ? ` (${definition.shortcut})` : ""}`}
                          onClick={() =>
                            setActiveTool((current) => (current === tool ? null : tool))
                          }
                        >
                          <ToolIcon size={14} strokeWidth={1.8} />
                        </button>
                      );
                    })}
                  </div>
                </div>
              ),
            )}
          </div>
          <span className="canvas-mode"><span className="mode-dot" /> Canvas</span>
          {!rightPanelOpen && <button className="icon-button small-icon" aria-label="Show inspector panel" onClick={onToggleRight}><PanelRightClose size={15} /></button>}
          <div className="canvas-view-menu-anchor">
            <button
              className={`icon-button small-icon${viewMenuOpen ? " is-active" : ""}`}
              title="Canvas view options"
              aria-label="Canvas view options"
              aria-haspopup="dialog"
              aria-expanded={viewMenuOpen}
              onClick={() => setViewMenuOpen((open) => !open)}
            >
              <MoreHorizontal size={17} />
            </button>
            {viewMenuOpen && (
              <div
                className="canvas-view-popover"
                role="dialog"
                aria-label="Canvas view options"
                onKeyDown={(event) => {
                  if (event.key === "Escape") setViewMenuOpen(false);
                }}
              >
                <div className="view-popover-heading">VIEW</div>
                <button
                  className="view-popover-toggle"
                  aria-pressed={gridVisible}
                  onClick={toggleGrid}
                >
                  <span>Show grid</span><kbd>Ctrl '</kbd>
                  <span className={`view-toggle-indicator${gridVisible ? " is-on" : ""}`} />
                </button>
                <button
                  className="view-popover-toggle"
                  aria-pressed={snapEnabled}
                  onClick={toggleSnap}
                >
                  <span>Snap &amp; smart guides</span><kbd>Ctrl Shift '</kbd>
                  <span className={`view-toggle-indicator${snapEnabled ? " is-on" : ""}`} />
                </button>
                <div className="view-popover-divider" />
                <div className="view-popover-label">Grid spacing</div>
                <div className="view-option-group" role="group" aria-label="Grid spacing">
                  {([5, 10, 20] as const).map((size) => (
                    <button
                      key={size}
                      className={`view-option${gridSize === size ? " is-selected" : ""}`}
                      aria-pressed={gridSize === size}
                      onClick={() => setGridSize(size)}
                    >
                      {size}px
                    </button>
                  ))}
                </div>
                <div className="view-popover-divider" />
                <div className="view-popover-label">Grid style</div>
                <div className="view-option-group" role="group" aria-label="Grid style">
                  {(["dots", "lines"] as const).map((style) => (
                    <button
                      key={style}
                      className={`view-option${gridStyle === style ? " is-selected" : ""}`}
                      aria-pressed={gridStyle === style}
                      onClick={() => setGridStyle(style)}
                    >
                      {style === "dots" ? "Dots" : "Lines"}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
      <div className="canvas-stage">
        <Suspense fallback={<div className="canvas-stage-surface" />}>
          <CanvasStage
            onSaveAs={onSaveAs}
            onOpen={onOpen}
            onOpenPalette={onOpenPalette}
            onNotify={onNotify}
            activeTool={activeTool}
            onToolChange={setActiveTool}
          />
        </Suspense>
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
  const selectedIds = useStore((state) => state.selectedIds);
  const filePath = useStore((state) => state.filePath);
  const rightPanelOpen = useStore((state) => state.rightPanelOpen);
  const displayPath = filePath ? filePath.replaceAll("\\", "/").split("/").at(-1) : "Not saved yet";
  const selectedWidgets =
    project.screens.find((screen) => screen.id === project.startScreenId)?.widgets.filter(
      (widget) => selectedIds.includes(widget.id),
    ) ?? [];
  const selectedWidget = selectedWidgets.length === 1 ? selectedWidgets[0] : undefined;
  const selectedDefinition = selectedWidget
    ? getShapeToolDefinition(selectedWidget.type)
    : undefined;
  const SelectedIcon = selectedDefinition?.icon ?? Layers2;
  const selectedLabelValue =
    selectedWidget?.props.label ?? selectedWidget?.props.text ?? selectedWidget?.props.fileName;
  const selectedLabel =
    typeof selectedLabelValue === "string" && selectedLabelValue.trim()
      ? selectedLabelValue.trim()
      : selectedDefinition?.label ?? selectedWidget?.type;

  if (!rightPanelOpen) return null;

  return (
    <aside className="sidebar inspector">
      <div className="inspector-top">
        <div><span className="inspector-overline">INSPECTOR</span><h2>{selectedWidget ? selectedLabel : selectedWidgets.length > 1 ? `${selectedWidgets.length} items selected` : "Select an element"}</h2></div>
        <button className="icon-button small-icon" aria-label="Close inspector" onClick={onToggle}><PanelRightClose size={15} /></button>
      </div>
      <div className="inspector-body">
        {selectedWidget ? (
          <div className="inspector-selection" aria-label="Selected element identity">
            <span className="inspector-placeholder-icon"><SelectedIcon size={17} /></span>
            <span className="inspector-selection-copy">
              <strong>{selectedDefinition?.label ?? selectedWidget.type}</strong>
              <code>{selectedWidget.type}</code>
            </span>
            {selectedWidget.locked && <Lock size={14} aria-label="Locked" />}
          </div>
        ) : selectedWidgets.length > 1 ? (
          <div className="inspector-selection" aria-label={`${selectedWidgets.length} selected elements`}>
            <span className="inspector-placeholder-icon"><Layers2 size={17} /></span>
            <span>{selectedWidgets.length} elements selected</span>
          </div>
        ) : (
          <div className="inspector-placeholder"><span className="inspector-placeholder-icon"><Layers2 size={17} /></span><span>Select an element on the canvas or in Layers to inspect it.</span></div>
        )}
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
          <div><strong>Stay up to date</strong><p>Proto Flow checks for signed releases when the app starts.</p></div>
        </div>
        <button className="button button-quiet update-check" onClick={onUpdates}>Check for updates <ArrowRight size={14} /></button>
        <div className="inspector-rule" />
        <div className="recovery-note"><span>Unsaved projects are autosaved on this device every 30 seconds.</span></div>
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

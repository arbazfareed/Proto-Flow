import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowDownToLine,
  ArrowRight,
  Braces,
  Bell,
  CircleAlert,
  ChevronDown,
  ChevronUp,
  CircleHelp,
  Code2,
  CloudUpload,
  Coins,
  FilePlus2,
  FileText,
  FolderOpen,
  Keyboard,
  Lock,
  Layers2,
  MonitorPlay,
  MoreHorizontal,
  Minus,
  PanelLeftClose,
  PanelRightClose,
  Pipette,
  Plus,
  Redo2,
  RotateCw,
  RefreshCw,
  Sparkles,
  Square,
  StickyNote,
  Undo2,
  RotateCcw,
  Wifi,
  WifiOff,
  Zap,
  UsersRound,
  X,
} from "lucide-react";
import { isTauri } from "@tauri-apps/api/core";
import { useStore } from "../store";
import type { Project, Widget, WidgetStyle } from "../project/schema";
import {
  getActivePanelState,
  getPanelStates,
  collectWidgetsDeep,
  mapWidgetsDeep,
  withPanelStates,
  updatePanelState,
  type DynamicPanelState,
} from "../project/dynamicPanels";
import {
  getRepeaterDataset,
  getRepeaterTemplate,
  parseRepeaterCsv,
  parseRepeaterDataset,
  repeaterDataBytes,
  repeaterDatasetToCsv,
  updateRepeater,
} from "../project/repeaters";
import {
  DEFAULT_DEVICE_PRESET,
  toScreenDevice,
} from "../devices/catalog";
import type { DeviceCategory } from "../devices/types";
import {
  rotateDevice,
  rotateWidgetForDevice,
  widgetOverflowsDevice,
} from "../devices/frame";
import type { ScreenDevice } from "../devices/types";
import { ScreenLayerSidebar } from "./ScreenLayerSidebar";
import { createWidgetCopies } from "../project/widgetClipboard";
import { SymbolLibrary } from "./SymbolLibrary";
import { WidgetIcon } from "./widgetIcons";
import { BreakpointToolbar, ResponsivePanel } from "./ResponsiveControls";
import {
  evaluateGeometryExpression,
  getGeometryUpdates,
  normalizeRotation,
  type GeometryField,
} from "../canvas/geometryInspector";
import {
  SAFE_BLEND_MODES,
  getDefaultTextProperties,
  getStyleUpdates,
  getTextPropertyUpdates,
  getWidgetPropertyUpdates,
  isTextStyleWidget,
  normalizeListItems,
  parseStyleColor,
} from "../canvas/styleInspector";
import { measureTextBounds } from "../canvas/textMeasurement";
import {
  getShapeToolDefinition,
  type ShapeTool,
} from "../canvas/shapeTools";
import { ElementLibrary } from "./ElementLibrary";
import { CANVAS_ICON_NAMES } from "../canvas/iconLibrary";
import { useWalletStore } from "../wallet/store";
import { WalletHistoryDialog } from "./WalletHistoryDialog";
import { VariablesPanel } from "./VariablesPanel";
import { InteractionBuilder } from "./InteractionBuilder";
import { WidgetNotesManager, WidgetNotesPanel } from "./WidgetNotes";

const CanvasStage = lazy(() =>
  import("../canvas/CanvasStage").then((module) => ({
    default: module.CanvasStage,
  })),
);
const FlowDiagram = lazy(() =>
  import("../flow/FlowDiagram").then((module) => ({
    default: module.FlowDiagram,
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
  onOpenPreview: () => void;
  onPublishCloudPreview: () => void;
  onOpenCollaboration: () => void;
  onExportReactCode: () => void;
  onExportHtml: () => void;
  onOpenWallet: () => void;
  onNotify: (message: string, isError?: boolean) => void;
  onStartDragging: () => void;
  onWindowAction: (action: "minimize" | "maximize" | "close") => void;
}

function formatWalletSyncAge(timestamp: number): string {
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours} hr${hours === 1 ? "" : "s"} ago`;
}

function formatRefillCountdown(nextClaimAt: string | null, now: number): string {
  if (!nextClaimAt) return "Daily refill available";
  const millisecondsLeft = Date.parse(nextClaimAt) - now;
  if (millisecondsLeft <= 0) return "Daily refill available";
  const minutes = Math.ceil(millisecondsLeft / 60_000);
  if (minutes < 60) return `Next refill in ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes === 0
    ? `Next refill in ${hours} hr`
    : `Next refill in ${hours} hr ${remainingMinutes} min`;
}

export function TopBar({
  onNew,
  onOpen,
  onSave,
  onSaveAs,
  onUndo,
  onRedo,
  onOpenPalette,
  onOpenPreview,
  onPublishCloudPreview,
  onOpenCollaboration,
  onExportReactCode,
  onExportHtml,
  onOpenWallet,
  onNotify,
  onStartDragging,
  onWindowAction,
}: TopBarProps) {
  const projectName = useStore((state) => state.project.name);
  const isDirty = useStore((state) => state.isDirty);
  const canUndo = useStore((state) => state.past.length > 0);
  const canRedo = useStore((state) => state.future.length > 0);
  const walletBalance = useWalletStore((state) => state.balance);
  const walletStatus = useWalletStore((state) => state.status);
  const networkStatus = useWalletStore((state) => state.networkStatus);
  const lifetimeGranted = useWalletStore((state) => state.lifetimeGranted);
  const lifetimeSpent = useWalletStore((state) => state.lifetimeSpent);
  const recentLedger = useWalletStore((state) => state.recentLedger);
  const lastSyncedAt = useWalletStore((state) => state.lastSyncedAt);
  const claimable = useWalletStore((state) => state.claimable);
  const nextClaimAt = useWalletStore((state) => state.nextClaimAt);
  const walletError = useWalletStore((state) => state.error);
  const walletEmail = useWalletStore((state) => state.email);
  const walletJwt = useWalletStore((state) => state.jwt);
  const syncWallet = useWalletStore((state) => state.sync);
  const claimDaily = useWalletStore((state) => state.claimDaily);
  const [walletMenuOpen, setWalletMenuOpen] = useState(false);
  const [walletHistoryOpen, setWalletHistoryOpen] = useState(false);
  const [claimingDaily, setClaimingDaily] = useState(false);
  const [walletClock, setWalletClock] = useState(Date.now());
  const walletMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!walletMenuOpen) return;
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (event.target instanceof Node && !walletMenuRef.current?.contains(event.target)) {
        setWalletMenuOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setWalletMenuOpen(false);
    };
    document.addEventListener("mousedown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [walletMenuOpen]);

  useEffect(() => {
    if (!walletMenuOpen) return;
    setWalletClock(Date.now());
    const interval = window.setInterval(() => setWalletClock(Date.now()), 60_000);
    return () => window.clearInterval(interval);
  }, [walletMenuOpen]);

  const claimDailyCredits = async () => {
    setClaimingDaily(true);
    const previousBalance = useWalletStore.getState().balance;
    try {
      const claimed = await claimDaily();
      if (claimed) {
        const granted = useWalletStore.getState().balance - previousBalance;
        onNotify(`Daily refill: +${granted} credits`);
      }
    } finally {
      setClaimingDaily(false);
    }
  };

  return (
    <header
      className="topbar"
      data-tauri-drag-region
      onMouseDown={(event) => {
        if (
          event.button === 0 &&
          !(event.target instanceof HTMLElement &&
            event.target.closest("button, input, a, [role='button'], [role='dialog']"))
        ) {
          onStartDragging();
        }
      }}
    >
      <div className="brand-lockup" data-tauri-drag-region>
        <div className="brand-mark" aria-hidden="true"><span>PF</span></div>
        <span className="brand-name">proto<span>flow</span></span>
        <div className="topbar-divider" />
        <div className="document-heading">
          <span className="document-name">{projectName}</span>
          <span className={`save-state ${isDirty ? "is-dirty" : ""}`}>
            <span className="state-dot" />
            <span className="save-state-label">
              {isDirty ? "Unsaved changes" : "All changes saved"}
            </span>
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
        <button className="button button-secondary" title="Save as" aria-label="Save as" onClick={onSaveAs}>
          <ArrowDownToLine size={14} /> Save as
        </button>
        <button className="button button-primary" title="Save project" aria-label="Save project" onClick={onSave}>
          Save <kbd>Ctrl S</kbd>
        </button>
        <button className="button button-secondary" aria-label="Open preview" title="Open live preview" onClick={onOpenPreview}>
          <MonitorPlay size={14} /> Preview
        </button>
        <button className="button button-secondary" aria-label="Publish to cloud" title="Publish a shareable cloud preview" onClick={onPublishCloudPreview}>
          <CloudUpload size={14} /> Publish
        </button>
        <button className="button button-secondary" aria-label="Open collaboration" title="Start or join a real-time collaboration session" onClick={onOpenCollaboration}>
          <UsersRound size={14} /> Collaborate
        </button>
        <button className="button button-secondary" aria-label="Export React code" title="Export a React and Tailwind project" onClick={onExportReactCode}>
          <Code2 size={14} /> Export code
        </button>
        <button className="button button-secondary" aria-label="Export HTML bundle" title="Export a free offline HTML bundle" onClick={onExportHtml}>
          <ArrowDownToLine size={14} /> Export HTML
        </button>
        <div className="wallet-menu-anchor" ref={walletMenuRef}>
          <button
            className={`wallet-balance-pill wallet-balance-${walletBalance < 5 ? "low" : walletBalance < 20 ? "medium" : "healthy"}`}
            onClick={() => setWalletMenuOpen((open) => !open)}
            aria-label={`${walletBalance} credits; open wallet details`}
            aria-expanded={walletMenuOpen}
            aria-controls="wallet-balance-menu"
          >
            <Zap size={13} />
            <span>{walletBalance} Credits</span>
            <ChevronDown size={12} />
          </button>
          {walletMenuOpen && (
            <section
              className="wallet-balance-menu"
              id="wallet-balance-menu"
              role="dialog"
              aria-label="Wallet balance and usage"
              onMouseDown={(event) => event.stopPropagation()}
            >
              <header className="wallet-menu-heading">
                <div>
                  <span className="eyebrow">FREE WALLET</span>
                  <strong><Coins size={15} /> {walletBalance} credits</strong>
                </div>
                <button
                  className="icon-button small-icon"
                  title="Refresh balance"
                  aria-label="Refresh wallet balance"
                  onClick={() => void syncWallet()}
                  disabled={walletStatus === "loading"}
                >
                  <RefreshCw size={14} />
                </button>
              </header>
              <div className="wallet-menu-totals">
                <span>Lifetime granted <strong>{lifetimeGranted}</strong></span>
                <span>Lifetime spent <strong>{lifetimeSpent}</strong></span>
              </div>
              {(walletStatus === "offline" || networkStatus === "offline") && (
                <p className="wallet-menu-status"><WifiOff size={13} /> Offline — last synced {lastSyncedAt ? formatWalletSyncAge(lastSyncedAt) : "unknown"}</p>
              )}
              {walletStatus === "online" && networkStatus !== "offline" && lastSyncedAt && (
                <p className="wallet-menu-status">Last synced {formatWalletSyncAge(lastSyncedAt)}</p>
              )}
              {walletStatus === "loading" && <p className="wallet-menu-status">Syncing wallet…</p>}
              {walletError && <p className="wallet-menu-error" role="status"><CircleAlert size={13} /> {walletError}</p>}
              <div className="wallet-menu-history">
                <div className="wallet-menu-section-title">Recent activity</div>
                {recentLedger.length === 0 ? (
                  <p className="wallet-menu-empty">No wallet activity yet.</p>
                ) : recentLedger.slice(0, 20).map((entry) => (
                  <div className="wallet-ledger-entry" key={entry.id}>
                    <span>{entry.reason.replaceAll("_", " ")}</span>
                    <strong className={entry.delta > 0 ? "is-credit" : "is-debit"}>
                      {entry.delta > 0 ? "+" : ""}{entry.delta}
                    </strong>
                    <time dateTime={entry.createdAt}>{new Date(entry.createdAt).toLocaleDateString()}</time>
                  </div>
                ))}
              </div>
              <button
                className="wallet-menu-link"
                onClick={() => {
                  setWalletMenuOpen(false);
                  setWalletHistoryOpen(true);
                }}
                disabled={!walletJwt || walletStatus !== "online" || networkStatus !== "online"}
                title={!walletJwt ? "Connect to view full usage history" : undefined}
              >
                View full history
              </button>
              {claimable && walletStatus === "online" && networkStatus === "online" ? (
                <button
                  className="button button-primary wallet-claim-button"
                  onClick={() => void claimDailyCredits()}
                  disabled={claimingDaily}
                >
                  {claimingDaily ? "Claiming…" : "Claim Daily +20"}
                </button>
              ) : (
                <p className="wallet-menu-refill-countdown">
                  {walletBalance >= 100
                    ? "Wallet full · 100-credit cap"
                    : walletStatus === "offline" || networkStatus === "offline"
                      ? "Reconnect to claim your daily refill"
                      : formatRefillCountdown(nextClaimAt, walletClock)}
                  {nextClaimAt && walletBalance < 100 && (
                    <time dateTime={nextClaimAt} title={new Date(nextClaimAt).toLocaleString()}>
                      {` · ${new Date(nextClaimAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`}
                    </time>
                  )}
                </p>
              )}
              {(!claimable || networkStatus !== "online") &&
                walletStatus === "online" &&
                walletBalance < 100 && (
                <button className="button button-primary wallet-claim-button" disabled>
                  Claim Daily +20
                </button>
                )}
              <button
                className="wallet-menu-link"
                onClick={() => {
                  setWalletMenuOpen(false);
                  onOpenWallet();
                }}
              >
                {walletEmail ? `Signed in as ${walletEmail}` : "Sign in to sync across devices"}
              </button>
              <button
                className="wallet-menu-link"
                onClick={() => {
                  setWalletMenuOpen(false);
                  onOpenWallet();
                }}
              >
                Wallet settings
              </button>
            </section>
          )}
        </div>
        {walletHistoryOpen && walletJwt && (
          <WalletHistoryDialog token={walletJwt} onClose={() => setWalletHistoryOpen(false)} />
        )}
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
  activeTool: ShapeTool | null;
  onSelectTool: (tool: ShapeTool) => void;
  onAddScreen: (category: DeviceCategory) => void;
}

export function LeftSidebar({
  onNew,
  onOpen,
  onToggle,
  onOpenPalette,
  onUpdates,
  activeTool,
  onSelectTool,
  onAddScreen,
}: LeftSidebarProps) {
  const project = useStore((state) => state.project);
  const isDirty = useStore((state) => state.isDirty);
  const leftPanelOpen = useStore((state) => state.leftPanelOpen);
  const [sidebarTab, setSidebarTab] = useState<"elements" | "variables">("elements");

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
      <div className="sidebar-tabs" role="tablist" aria-label="Sidebar tools">
        <button
          className={`sidebar-tab${sidebarTab === "elements" ? " is-active" : ""}`}
          type="button"
          role="tab"
          aria-selected={sidebarTab === "elements"}
          onClick={() => setSidebarTab("elements")}
        >
          Elements
        </button>
        <button
          className={`sidebar-tab${sidebarTab === "variables" ? " is-active" : ""}`}
          type="button"
          role="tab"
          aria-selected={sidebarTab === "variables"}
          onClick={() => setSidebarTab("variables")}
        >
          <Braces size={13} /> Variables
        </button>
      </div>
      {sidebarTab === "elements" ? (
        <>
          <ElementLibrary
            activeTool={activeTool}
            mode="sidebar"
            onSelectTool={onSelectTool}
            onAddScreen={onAddScreen}
          />
          <SymbolLibrary />
        </>
      ) : <VariablesPanel />}
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
  activeTool: ShapeTool | null;
  setActiveTool: (update: ShapeTool | null | ((current: ShapeTool | null) => ShapeTool | null)) => void;
}

export function CanvasArea({
  onToggleLeft,
  onToggleRight,
  onSaveAs,
  onOpen,
  onOpenPalette,
  onNotify,
  activeTool,
  setActiveTool,
}: CanvasAreaProps) {
  const project = useStore((state) => state.project);
  const leftPanelOpen = useStore((state) => state.leftPanelOpen);
  const rightPanelOpen = useStore((state) => state.rightPanelOpen);
  const gridSize = useStore((state) => state.gridSize);
  const gridStyle = useStore((state) => state.gridStyle);
  const gridVisible = useStore((state) => state.gridVisible);
  const snapEnabled = useStore((state) => state.snapEnabled);
  const showDeviceFrame = useStore((state) => state.showDeviceFrame);
  const showSafeArea = useStore((state) => state.showSafeArea);
  const statusBarTheme = useStore((state) => state.statusBarTheme);
  const statusBarTimeMode = useStore((state) => state.statusBarTimeMode);
  const showBattery = useStore((state) => state.showBattery);
  const showSignal = useStore((state) => state.showSignal);
  const activeScreenId = useStore((state) => state.getActiveScreenId());
  const activeScreen = project.screens.find((screen) => screen.id === activeScreenId);
  const activeOrientation =
    activeScreen?.device?.orientation ??
    ((activeScreen?.device?.width ?? DEFAULT_DEVICE_PRESET.viewport.width) >=
    (activeScreen?.device?.height ?? DEFAULT_DEVICE_PRESET.viewport.height)
      ? "landscape"
      : "portrait");
  const setGridSize = useStore((state) => state.setGridSize);
  const setGridStyle = useStore((state) => state.setGridStyle);
  const toggleGrid = useStore((state) => state.toggleGrid);
  const toggleSnap = useStore((state) => state.toggleSnap);
  const toggleDeviceFrame = useStore((state) => state.toggleDeviceFrame);
  const toggleSafeArea = useStore((state) => state.toggleSafeArea);
  const setStatusBarTheme = useStore((state) => state.setStatusBarTheme);
  const setStatusBarTimeMode = useStore((state) => state.setStatusBarTimeMode);
  const toggleBattery = useStore((state) => state.toggleBattery);
  const toggleSignal = useStore((state) => state.toggleSignal);
  const notesOverlay = useStore((state) => state.notesOverlay);
  const toggleNotesOverlay = useStore((state) => state.toggleNotesOverlay);
  const [viewMenuOpen, setViewMenuOpen] = useState(false);
  const [notesManagerOpen, setNotesManagerOpen] = useState(false);
  const [viewMode, setViewMode] = useState<"design" | "flow">("design");
  const [orientationRequest, setOrientationRequest] = useState<{
    screenId: string;
    device: ScreenDevice;
    overflowingCount: number;
  } | null>(null);

  const commitOrientation = (rotateWidgets: boolean) => {
    if (!orientationRequest) return;
    const current = useStore.getState();
    const screen = current.project.screens.find(
      (item) => item.id === orientationRequest.screenId,
    );
    if (!screen) {
      setOrientationRequest(null);
      return;
    }
    const oldDevice = screen.device ?? toScreenDevice(DEFAULT_DEVICE_PRESET);
    current.setProject({
      ...current.project,
      updatedAt: new Date().toISOString(),
      screens: current.project.screens.map((item) =>
        item.id !== screen.id
          ? item
          : {
              ...item,
              device: orientationRequest.device,
              widgets: rotateWidgets
                ? item.widgets.map((widget) =>
                    rotateWidgetForDevice(
                      widget,
                      oldDevice,
                      orientationRequest.device.orientation ?? "landscape",
                    ),
                  )
                : item.widgets,
            },
      ),
    });
    if (orientationRequest.overflowingCount > 0 && !rotateWidgets) {
      onNotify(
        `Device rotated; ${orientationRequest.overflowingCount} widget${orientationRequest.overflowingCount === 1 ? "" : "s"} may extend beyond the viewport.`,
      );
    }
    setOrientationRequest(null);
  };

  const requestOrientationChange = () => {
    if (!activeScreen) return;
    const currentDevice = activeScreen.device ?? toScreenDevice(DEFAULT_DEVICE_PRESET);
    const nextDevice = rotateDevice(currentDevice);
    const overflowingCount = activeScreen.widgets.filter((widget) =>
      widgetOverflowsDevice(widget, nextDevice),
    ).length;
    if (overflowingCount > 0) {
      setOrientationRequest({
        screenId: activeScreen.id,
        device: nextDevice,
        overflowingCount,
      });
      return;
    }
    const current = useStore.getState();
    current.setProject({
      ...current.project,
      updatedAt: new Date().toISOString(),
      screens: current.project.screens.map((screen) =>
        screen.id === activeScreen.id
          ? { ...screen, device: nextDevice }
          : screen,
      ),
    });
  };

  return (
    <main className="canvas-area">
      <div className="canvas-toolbar">
        <div className="breadcrumb">
          {!leftPanelOpen && <button className="icon-button small-icon" aria-label="Show workspace panel" onClick={onToggleLeft}><PanelLeftClose size={15} /></button>}
          <span className="breadcrumb-muted">Workspace</span><ArrowRight size={13} /><span>{project.name}</span>
        </div>
        <BreakpointToolbar />
        <div className="canvas-toolbar-actions">
          {activeTool && (
            <span
              className="active-element-tool"
              title="Drag on the canvas to place this element"
              aria-label={`Active tool: ${getShapeToolDefinition(activeTool)?.label ?? activeTool}`}
            >
              <WidgetIcon type={activeTool} size={16} />
              <span>{getShapeToolDefinition(activeTool)?.label ?? activeTool}</span>
              <button
                type="button"
                aria-label={`Cancel ${getShapeToolDefinition(activeTool)?.label ?? activeTool} tool`}
                onClick={() => setActiveTool(null)}
              >
                <X size={12} />
              </button>
            </span>
          )}
          <div className="workspace-view-toggle" role="group" aria-label="Workspace view">
            <button
              className={`workspace-view-button${viewMode === "design" ? " is-active" : ""}`}
              aria-pressed={viewMode === "design"}
              onClick={() => setViewMode("design")}
            >
              Design
            </button>
            <button
              className={`workspace-view-button${viewMode === "flow" ? " is-active" : ""}`}
              aria-pressed={viewMode === "flow"}
              onClick={() => setViewMode("flow")}
            >
              Flow
            </button>
          </div>
          <button
            className="icon-button small-icon"
            title="Open widget notes manager"
            aria-label="Open widget notes manager"
            onClick={() => setNotesManagerOpen(true)}
          >
            <StickyNote size={15} />
          </button>
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
                  aria-pressed={notesOverlay}
                  onClick={toggleNotesOverlay}
                >
                  <span>Notes overlay</span>
                  <span className={`view-toggle-indicator${notesOverlay ? " is-on" : ""}`} />
                </button>
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
                <button
                  className="view-popover-toggle"
                  aria-pressed={showDeviceFrame}
                  onClick={toggleDeviceFrame}
                >
                  <span>Show device frame</span>
                  <span className={`view-toggle-indicator${showDeviceFrame ? " is-on" : ""}`} />
                </button>
                <button
                  className="view-popover-toggle"
                  aria-pressed={showSafeArea}
                  onClick={toggleSafeArea}
                >
                  <span>Show safe area</span>
                  <span className={`view-toggle-indicator${showSafeArea ? " is-on" : ""}`} />
                </button>
                <button
                  className="view-popover-toggle"
                  onClick={requestOrientationChange}
                  aria-label="Rotate device orientation"
                >
                  <span>
                    {activeOrientation === "landscape" ? "Switch to portrait" : "Switch to landscape"}
                  </span>
                  <RotateCw size={13} />
                </button>
                {orientationRequest && (
                  <div className="orientation-warning" role="group" aria-label="Orientation overflow choices">
                    <p>
                      {orientationRequest.overflowingCount} widget
                      {orientationRequest.overflowingCount === 1 ? "" : "s"} may overflow the new viewport.
                    </p>
                    <button className="view-option" onClick={() => commitOrientation(false)}>
                      Keep widgets as-is
                    </button>
                    <button className="view-option" onClick={() => commitOrientation(true)}>
                      Rotate widgets too
                    </button>
                    <button className="orientation-cancel" onClick={() => setOrientationRequest(null)}>
                      Cancel
                    </button>
                  </div>
                )}
                <div className="view-popover-divider" />
                <div className="view-popover-label">Status bar</div>
                <div className="view-option-group" role="group" aria-label="Status bar theme">
                  {(["light", "dark"] as const).map((theme) => (
                    <button
                      key={theme}
                      className={`view-option${statusBarTheme === theme ? " is-selected" : ""}`}
                      aria-pressed={statusBarTheme === theme}
                      onClick={() => setStatusBarTheme(theme)}
                    >
                      {theme === "light" ? "Light" : "Dark"}
                    </button>
                  ))}
                </div>
                <div className="view-option-group status-bar-time-options" role="group" aria-label="Status bar time">
                  {(["static", "real"] as const).map((mode) => (
                    <button
                      key={mode}
                      className={`view-option${statusBarTimeMode === mode ? " is-selected" : ""}`}
                      aria-pressed={statusBarTimeMode === mode}
                      onClick={() => setStatusBarTimeMode(mode)}
                    >
                      {mode === "static" ? "Static 9:41" : "Local time"}
                    </button>
                  ))}
                </div>
                <button
                  className="view-popover-toggle"
                  aria-pressed={showBattery}
                  onClick={toggleBattery}
                >
                  <span>Show battery</span>
                  <span className={`view-toggle-indicator${showBattery ? " is-on" : ""}`} />
                </button>
                <button
                  className="view-popover-toggle"
                  aria-pressed={showSignal}
                  onClick={toggleSignal}
                >
                  <span>Show signal</span>
                  <span className={`view-toggle-indicator${showSignal ? " is-on" : ""}`} />
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
        {viewMode === "flow" ? (
          <Suspense fallback={<div className="canvas-stage-surface" />}>
            <FlowDiagram
              onNotify={onNotify}
              onOpenScreen={(screenId, widgetId) => {
                const state = useStore.getState();
                state.setActiveScreen(screenId);
                if (widgetId) state.select([widgetId]);
                setViewMode("design");
              }}
            />
          </Suspense>
        ) : (
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
        )}
      </div>
      {notesManagerOpen && <WidgetNotesManager onClose={() => setNotesManagerOpen(false)} />}
    </main>
  );
}

interface RightInspectorProps {
  onToggle: () => void;
  onUpdates: () => void;
  onRename: (name: string) => void;
}

type GeometryUnit = "px" | "%";
type UnitField = "x" | "y" | "width" | "height";

interface GeometryEditSession {
  snapshot: Project;
  screenId: string;
  widgets: Widget[];
  timer: number | null;
}

interface StyleEditSession {
  snapshot: Project;
  screenId: string;
  widgetIds: string[];
  timer: number | null;
}

type StyleColorField = "fill" | "stroke";
type StyleColorValue = { color: string; opacity: number } | null;

function StyleSection({ widgets }: { widgets: Widget[] }) {
  const editSessionRef = useRef<StyleEditSession | null>(null);
  const [colorDraft, setColorDraft] = useState<Record<StyleColorField, string>>({
    fill: "",
    stroke: "",
  });
  const [colorError, setColorError] = useState<StyleColorField | null>(null);
  const [recentColors, setRecentColors] = useState<string[]>([]);
  const [advancedRadius, setAdvancedRadius] = useState(false);

  const editableWidgets = widgets.filter((widget) => !widget.locked);
  const valuesFor = <K extends keyof WidgetStyle>(key: K): WidgetStyle[K][] =>
    editableWidgets.map((widget) => widget.style[key]);
  const mixed = <T,>(values: T[]): boolean =>
    values.some((value) => JSON.stringify(value) !== JSON.stringify(values[0]));
  const commonStyleValue = <K extends keyof WidgetStyle>(
    key: K,
    fallback: WidgetStyle[K],
  ): WidgetStyle[K] | undefined => {
    const values = valuesFor(key);
    return values.length > 0 && !mixed(values) ? values[0] : fallback;
  };

  const selectionKey = widgets.map((widget) => widget.id).join("\u0000");

  const finishEditSession = useCallback(() => {
    const session = editSessionRef.current;
    if (!session) return;
    if (session.timer !== null) window.clearTimeout(session.timer);
    editSessionRef.current = null;
    const current = useStore.getState();
    const currentWidgets =
      current.project.screens.find((screen) => screen.id === session.screenId)?.widgets ?? [];
    const beforeWidgets =
      session.snapshot.screens.find((screen) => screen.id === session.screenId)?.widgets ?? [];
    const changed = session.widgetIds.some((id) => {
      const before = beforeWidgets.find((widget) => widget.id === id);
      const after = currentWidgets.find((widget) => widget.id === id);
      return Boolean(
        before &&
          after &&
          (JSON.stringify(before.style) !== JSON.stringify(after.style) ||
            JSON.stringify(before.props) !== JSON.stringify(after.props)),
      );
    });
    if (changed) current.pushHistory(session.snapshot);
  }, []);

  const beginStyleEdit = useCallback(() => {
    if (editableWidgets.length === 0 || editSessionRef.current) return;
    editSessionRef.current = {
      snapshot: useStore.getState().project,
      screenId: useStore.getState().getActiveScreenId(),
      widgetIds: editableWidgets.map((widget) => widget.id),
      timer: null,
    };
  }, [editableWidgets]);

  useEffect(() => {
    finishEditSession();
    setColorDraft({ fill: "", stroke: "" });
    setColorError(null);
  }, [finishEditSession, selectionKey]);

  const applyStyle = useCallback(
    (patch: Partial<WidgetStyle>) => {
      if (editableWidgets.length === 0) return;
      beginStyleEdit();
      const session = editSessionRef.current;
      if (!session) return;
      const current = useStore.getState();
      const screenId = current.getActiveScreenId();
      const screen = current.project.screens.find((item) => item.id === screenId);
      const targetWidgets =
        screen ? collectWidgetsDeep(screen.widgets).filter((widget) => session.widgetIds.includes(widget.id)) : [];
      const updates = new Map(
        getStyleUpdates(targetWidgets, patch).map((update) => [update.id, update.style]),
      );
      const project: Project = {
        ...current.project,
        updatedAt: new Date().toISOString(),
        screens: current.project.screens.map((item) =>
          item.id !== screenId
            ? item
            : {
                ...item,
                widgets: mapWidgetsDeep(item.widgets, (widget) =>
                  updates.has(widget.id)
                    ? { ...widget, style: updates.get(widget.id)! }
                    : widget,
                ),
              },
        ),
      };
      useStore.setState({ project, isDirty: true });
      if (session.timer !== null) window.clearTimeout(session.timer);
      session.timer = window.setTimeout(finishEditSession, 500);
    },
    [editableWidgets, beginStyleEdit, finishEditSession],
  );

  const applyText = useCallback(
    (patch: Record<string, unknown>) => {
      if (editableWidgets.length === 0) return;
      beginStyleEdit();
      const session = editSessionRef.current;
      if (!session) return;
      const current = useStore.getState();
      const screenId = session.screenId;
      const screen = current.project.screens.find((item) => item.id === screenId);
      const targetWidgets =
        screen ? collectWidgetsDeep(screen.widgets).filter((widget) => session.widgetIds.includes(widget.id)) : [];
      const updates = new Map(
        getTextPropertyUpdates(targetWidgets, patch).map((update) => [update.id, update.props]),
      );
      const project: Project = {
        ...current.project,
        updatedAt: new Date().toISOString(),
        screens: current.project.screens.map((item) =>
          item.id !== screenId
            ? item
            : {
                ...item,
                widgets: mapWidgetsDeep(item.widgets, (widget) => {
                  const props = updates.get(widget.id);
                  if (!props) return widget;
                  const measured = props.autoSize === true
                    ? measureTextBounds(
                        typeof props.text === "string" ? props.text : "",
                        typeof props.fontFamily === "string" ? props.fontFamily : "Arial",
                        typeof props.fontSize === "number" ? props.fontSize : 24,
                        typeof props.fontWeight === "string" ? props.fontWeight : "normal",
                        typeof props.lineHeight === "number" ? props.lineHeight : 1.2,
                      )
                    : null;
                  return {
                    ...widget,
                    props,
                    ...(measured ? { width: measured.width, height: measured.height } : {}),
                  };
                }),
              },
        ),
      };
      useStore.setState({ project, isDirty: true });
      if (session.timer !== null) window.clearTimeout(session.timer);
      session.timer = window.setTimeout(finishEditSession, 500);
    },
    [editableWidgets, beginStyleEdit, finishEditSession],
  );

  const applyProps = useCallback(
    (patch: Record<string, unknown>) => {
      if (editableWidgets.length === 0) return;
      beginStyleEdit();
      const session = editSessionRef.current;
      if (!session) return;
      const current = useStore.getState();
      const screen = current.project.screens.find((item) => item.id === session.screenId);
      const targetWidgets =
        screen ? collectWidgetsDeep(screen.widgets).filter((widget) => session.widgetIds.includes(widget.id)) : [];
      const updates = new Map(
        getWidgetPropertyUpdates(targetWidgets, patch).map((update) => [update.id, update.props]),
      );
      const project: Project = {
        ...current.project,
        updatedAt: new Date().toISOString(),
        screens: current.project.screens.map((item) =>
          item.id !== session.screenId
            ? item
            : {
                ...item,
                widgets: mapWidgetsDeep(item.widgets, (widget) => {
                  const props = updates.get(widget.id);
                  return props ? { ...widget, props } : widget;
                }),
              },
        ),
      };
      useStore.setState({ project, isDirty: true });
      if (session.timer !== null) window.clearTimeout(session.timer);
      session.timer = window.setTimeout(finishEditSession, 500);
    },
    [editableWidgets, beginStyleEdit, finishEditSession],
  );

  useEffect(() => () => finishEditSession(), [finishEditSession]);

  const colorValue = (field: StyleColorField): StyleColorValue => {
    const key = field === "fill" ? "fillOpacity" : "strokeOpacity";
    const colors = editableWidgets.map((widget) => widget.style[field] ?? null);
    const opacities = editableWidgets.map((widget) => widget.style[key] ?? 1);
    if (colors.length === 0 || mixed(colors) || mixed(opacities)) return null;
    const color = colors[0];
    return color === null ? null : { color, opacity: opacities[0] };
  };

  const commitColor = (field: StyleColorField, raw: string) => {
    if (raw.trim().toLowerCase() === "none") {
      applyStyle({ [field]: null, [field === "fill" ? "fillOpacity" : "strokeOpacity"]: 1 });
      setColorDraft((current) => ({ ...current, [field]: "" }));
      setColorError(null);
      return;
    }
    const parsed = parseStyleColor(raw);
    if (!parsed) {
      setColorError(field);
      return;
    }
    const opacityKey = field === "fill" ? "fillOpacity" : "strokeOpacity";
    applyStyle({ [field]: parsed.hex, [opacityKey]: parsed.opacity });
    setColorError(null);
    setRecentColors((current) => [
      parsed.hex,
      ...current.filter((color) => color !== parsed.hex),
    ].slice(0, 8));
  };

  const pickColor = async (field: StyleColorField) => {
    const eyeDropperWindow = window as Window & {
      EyeDropper?: new () => { open: () => Promise<{ sRGBHex: string }> };
    };
    if (!eyeDropperWindow.EyeDropper) return;
    try {
      const result = await new eyeDropperWindow.EyeDropper().open();
      commitColor(field, result.sRGBHex);
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        console.error("Could not sample a canvas color.", error);
      }
    }
  };

  const resetSection = (section: "fill" | "stroke" | "radius" | "shadow" | "blend" | "text") => {
    if (section === "text") {
      const textWidgets = editableWidgets.filter(isTextStyleWidget);
      const defaults = textWidgets[0] ? getDefaultTextProperties(textWidgets[0]) : {};
      applyText(defaults);
      return;
    }
    const patch: Partial<WidgetStyle> =
      section === "fill"
        ? { fill: null, fillOpacity: 1 }
        : section === "stroke"
          ? { stroke: null, strokeOpacity: 1, strokeWidth: 0, dash: [], lineCap: "round", lineJoin: "round" }
          : section === "radius"
            ? { cornerRadius: 0 }
            : section === "shadow"
              ? { shadow: undefined }
              : { blendMode: "source-over" };
    if (section === "fill" || section === "stroke") {
      const defaultStyle = getShapeToolDefinition(editableWidgets[0]?.type ?? "")?.style;
      const defaultColor = defaultStyle?.[section] ?? null;
      const defaultOpacity = section === "fill" ? "fillOpacity" : "strokeOpacity";
      patch[section] = defaultColor;
      patch[defaultOpacity] = 1;
      if (section === "stroke") {
        patch.strokeWidth = defaultStyle?.strokeWidth ?? 0;
        patch.dash = defaultStyle?.dash ?? [];
        patch.lineCap = defaultStyle?.lineCap ?? "round";
        patch.lineJoin = defaultStyle?.lineJoin ?? "round";
      }
    } else if (section === "radius") {
      patch.cornerRadius =
        getShapeToolDefinition(editableWidgets[0]?.type ?? "")?.style.cornerRadius ?? 0;
    }
    applyStyle(patch);
  };

  const radiusValue = commonStyleValue("cornerRadius", 0);
  const radiusMixed = mixed(valuesFor("cornerRadius"));
  const commonShadow = commonStyleValue("shadow", undefined);
  const shadowMixed = mixed(valuesFor("shadow"));
  const hasText = editableWidgets.some(isTextStyleWidget);
  const richTextWidgets = editableWidgets.filter((widget) => widget.type === "text");
  const richTextMode = richTextWidgets.length > 0 &&
    richTextWidgets.every((widget) => widget.props.richText === true);
  const textProperty = (key: string, fallback: unknown): unknown[] =>
    editableWidgets
      .filter(isTextStyleWidget)
      .map((widget) => widget.props[key] ?? getDefaultTextProperties(widget)[key] ?? fallback);
  const textValue = (key: string, fallback: unknown): unknown => {
    const values = textProperty(key, fallback);
    return values.length > 0 && !mixed(values) ? values[0] : values.length > 1 ? "Mixed" : fallback;
  };
  const textMixed = (key: string) => textValue(key, null) === "Mixed";
  const colorInput = (field: StyleColorField, label: string) => {
    const value = colorValue(field);
    const opacityKey = field === "fill" ? "fillOpacity" : "strokeOpacity";
    const opacity = commonStyleValue(opacityKey, 1) ?? 1;
    return (
      <div className="style-color-field" key={field}>
        <label className="field-label" htmlFor={`style-${field}`}>{label}</label>
        <div className="style-color-row">
          <input
            id={`style-${field}-picker`}
            aria-label={`${label} color picker`}
            className="style-color-picker"
            type="color"
            value={value?.color ?? "#000000"}
            disabled={editableWidgets.length === 0}
            onPointerDown={beginStyleEdit}
            onPointerUp={finishEditSession}
            onPointerCancel={finishEditSession}
            onChange={(event) => commitColor(field, event.currentTarget.value)}
          />
          <input
            id={`style-${field}`}
            aria-label={`${label} hex, RGBA, or HSL`}
            className="text-field style-color-text"
            value={colorDraft[field] || value?.color || ""}
            placeholder={mixed(editableWidgets.map((widget) => widget.style[field] ?? null)) ? "Mixed" : "None"}
            aria-invalid={colorError === field}
            disabled={editableWidgets.length === 0}
            onChange={(event) => {
              const raw = event.currentTarget.value;
              setColorDraft((current) => ({ ...current, [field]: raw }));
              if (parseStyleColor(raw)) commitColor(field, raw);
            }}
            onBlur={(event) => {
              const raw = event.currentTarget.value;
              if (raw) commitColor(field, raw);
              setColorDraft((current) => ({ ...current, [field]: "" }));
              finishEditSession();
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
              if (event.key === "Escape") {
                setColorDraft((current) => ({ ...current, [field]: "" }));
                setColorError(null);
                event.currentTarget.blur();
              }
            }}
          />
          <button type="button" className="icon-button small-icon" aria-label={`Sample ${label} color`} title="Pick a color from the screen" disabled={!("EyeDropper" in window)} onClick={() => void pickColor(field)}><Pipette size={13} /></button>
          <button type="button" className="icon-button small-icon" aria-label={`Reset ${label}`} title={`Reset ${label}`} onClick={() => resetSection(field)}><RotateCcw size={12} /></button>
        </div>
        {colorError === field && <p className="field-hint style-error">Enter a valid hex, RGB(A), or HSL(A) color.</p>}
        <div className="style-opacity-row">
          <input
            type="range"
            min="0"
            max="100"
            aria-label={`${label} opacity`}
            value={Math.round((value?.opacity ?? opacity) * 100)}
            disabled={editableWidgets.length === 0 || !value}
            onChange={(event) => applyStyle({ [opacityKey]: Number(event.currentTarget.value) / 100 })}
            onPointerUp={finishEditSession}
          />
          <span>{value ? `${Math.round((value.opacity ?? opacity) * 100)}%` : mixed(editableWidgets.map((widget) => widget.style[opacityKey] ?? 1)) ? "Mixed" : "—"}</span>
          <button type="button" className="style-none-button" disabled={editableWidgets.length === 0} onClick={() => commitColor(field, "none")}>None</button>
        </div>
        {recentColors.length > 0 && (
          <div className="style-swatches" aria-label={`Recent ${label} colors`}>
            {recentColors.map((color) => <button key={color} type="button" aria-label={`${label} ${color}`} title={color} style={{ backgroundColor: color }} onClick={() => commitColor(field, color)} />)}
          </div>
        )}
      </div>
    );
  };

  if (widgets.length === 0) return null;
  const strokeWidth = commonStyleValue("strokeWidth", 0) ?? 0;
  const strokeWidthMixed = mixed(valuesFor("strokeWidth"));
  const lineCapMixed = mixed(valuesFor("lineCap"));
  const lineJoinMixed = mixed(valuesFor("lineJoin"));
  const dash = commonStyleValue("dash", []) ?? [];
  const dashMixed = mixed(valuesFor("dash"));
  const shadow = commonShadow ?? {};
  const radiusArray: number[] = Array.isArray(radiusValue)
    ? radiusValue.map((value) => Number(value ?? 0))
    : [Number(radiusValue ?? 0), Number(radiusValue ?? 0), Number(radiusValue ?? 0), Number(radiusValue ?? 0)];
  const maxRadius = Math.floor(
    Math.min(...editableWidgets.map((widget) => Math.min(widget.width, widget.height))) / 2,
  );
  const selectedBlendMode = commonStyleValue("blendMode", "source-over");
  const displayedBlendMode =
    selectedBlendMode && SAFE_BLEND_MODES.includes(selectedBlendMode)
      ? selectedBlendMode
      : "source-over";
  const iconWidgets = editableWidgets.filter(
    (widget) => widget.type === "icon" || widget.type === "custom-icon",
  );
  const iconNames = iconWidgets.map((widget) =>
    typeof widget.props.iconName === "string" ? widget.props.iconName : "Star",
  );
  const iconName = iconNames.length > 0 && !mixed(iconNames) ? iconNames[0] : "";

  return (
    <section className="style-section" aria-label="Style">
      <div className="section-label style-heading"><span>STYLE</span></div>
      <div className="style-color-grid">
        {colorInput("fill", "Fill")}
        {colorInput("stroke", "Stroke")}
      </div>
      <div className="style-control-grid">
        {iconWidgets.length > 0 && (
          <label className="style-control">
            <span>Icon</span>
            <select
              aria-label="Canvas icon"
              value={iconName}
              disabled={iconWidgets.length !== editableWidgets.length}
              onChange={(event) => applyProps({ iconName: event.currentTarget.value })}
              onBlur={finishEditSession}
            >
              {iconName === "" && <option value="" disabled>Mixed</option>}
              {CANVAS_ICON_NAMES.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
          </label>
        )}
        <label className="style-control">
          <span>Stroke width <button type="button" className="icon-button small-icon" aria-label="Reset stroke" onClick={() => resetSection("stroke")}><RotateCcw size={11} /></button></span>
          <input type="number" min="0" max="50" step="1" aria-label="Stroke width" value={strokeWidthMixed ? "" : strokeWidth} placeholder={strokeWidthMixed ? "Mixed" : undefined} disabled={!editableWidgets.length} onChange={(event) => applyStyle({ strokeWidth: Math.min(50, Math.max(0, Number(event.currentTarget.value))) })} onBlur={finishEditSession} />
        </label>
        <label className="style-control">
          <span>Dash</span>
          <select aria-label="Stroke dash preset" value={dashMixed ? "" : dash.length === 0 ? "solid" : dash.length === 2 && dash[0] === 2 && dash[1] === 4 ? "dotted" : dash.length === 2 && dash[0] === 8 && dash[1] === 5 ? "dashed" : "custom"} onChange={(event) => applyStyle({ dash: event.currentTarget.value === "solid" ? [] : event.currentTarget.value === "dashed" ? [8, 5] : event.currentTarget.value === "dotted" ? [2, 4] : [6, 3] })}>
            <option value="" disabled>Mixed</option><option value="solid">Solid</option><option value="dashed">Dashed</option><option value="dotted">Dotted</option><option value="custom">Custom</option>
          </select>
        </label>
        {dash.length > 0 && !([2, 4].every((value, index) => dash[index] === value) || [8, 5].every((value, index) => dash[index] === value)) && <label className="style-control"><span>Custom dash</span><input type="text" aria-label="Custom dash array" value={dash.join(", ")} onChange={(event) => { const values = event.currentTarget.value.split(",").map((part) => part.trim()).filter(Boolean).map(Number); if (values.length > 0 && values.every((value) => Number.isFinite(value) && value >= 0)) applyStyle({ dash: values }); }} onBlur={finishEditSession} /></label>}
        <label className="style-control"><span>Line cap</span><select aria-label="Line cap" value={lineCapMixed ? "" : commonStyleValue("lineCap", "round") ?? "round"} onChange={(event) => applyStyle({ lineCap: event.currentTarget.value as WidgetStyle["lineCap"] })}><option value="" disabled>Mixed</option><option value="butt">Butt</option><option value="round">Round</option><option value="square">Square</option></select></label>
        <label className="style-control"><span>Line join</span><select aria-label="Line join" value={lineJoinMixed ? "" : commonStyleValue("lineJoin", "round") ?? "round"} onChange={(event) => applyStyle({ lineJoin: event.currentTarget.value as WidgetStyle["lineJoin"] })}><option value="" disabled>Mixed</option><option value="miter">Miter</option><option value="round">Round</option><option value="bevel">Bevel</option></select></label>
        <label className="style-control">
          <span>Corner radius <button type="button" className="icon-button small-icon" aria-label="Reset corner radius" onClick={() => resetSection("radius")}><RotateCcw size={11} /></button></span>
          <input type="number" min="0" max={maxRadius} aria-label="Corner radius" value={!radiusMixed && typeof radiusValue === "number" ? radiusValue : ""} placeholder={Array.isArray(radiusValue) ? "Per-corner" : radiusMixed ? "Mixed" : undefined} disabled={!editableWidgets.length || Array.isArray(radiusValue)} onChange={(event) => { applyStyle({ cornerRadius: Math.min(maxRadius, Math.max(0, Number(event.currentTarget.value))) }); }} onBlur={finishEditSession} />
        </label>
        <button type="button" className="style-advanced-toggle" aria-expanded={advancedRadius} onClick={() => setAdvancedRadius((current) => !current)}>{advancedRadius ? "Hide per-corner radius" : "Advanced corners"}</button>
        {advancedRadius && [0, 1, 2, 3].map((corner) => <label className="style-control" key={corner}><span>{["Top left", "Top right", "Bottom right", "Bottom left"][corner]}</span><input type="number" min="0" max={maxRadius} aria-label={`${["Top left", "Top right", "Bottom right", "Bottom left"][corner]} radius`} value={radiusArray[corner]} disabled={!editableWidgets.length} onChange={(event) => { const next = [...radiusArray]; next[corner] = Math.min(maxRadius, Math.max(0, Number(event.currentTarget.value))); applyStyle({ cornerRadius: next }); }} onBlur={finishEditSession} /></label>)}
        <label className="style-control style-blend"><span>Blend mode <button type="button" className="icon-button small-icon" aria-label="Reset blend mode" onClick={() => resetSection("blend")}><RotateCcw size={11} /></button></span><select aria-label="Blend mode" value={mixed(valuesFor("blendMode")) ? "" : displayedBlendMode} onChange={(event) => applyStyle({ blendMode: event.currentTarget.value as WidgetStyle["blendMode"] })}><option value="" disabled>Mixed</option>{SAFE_BLEND_MODES.map((mode) => <option key={mode} value={mode}>{mode === "source-over" ? "Normal" : mode.replaceAll("-", " ")}</option>)}</select></label>
      </div>
      <details className="style-shadow">
        <summary>Drop shadow</summary>
        <button type="button" className="icon-button small-icon style-details-reset" aria-label="Reset drop shadow" onClick={() => resetSection("shadow")}><RotateCcw size={11} /></button>
        <label className="style-shadow-enable"><input type="checkbox" checked={Boolean(commonShadow)} onChange={(event) => applyStyle({ shadow: event.currentTarget.checked ? { color: "#000000", blur: 8, offsetX: 0, offsetY: 4, opacity: 0.35 } : undefined })} /> {shadowMixed ? "Mixed" : "Enabled"}</label>
        {Boolean(commonShadow) && <div className="style-control-grid">
          <label className="style-control"><span>Shadow color</span><input type="color" aria-label="Shadow color" value={shadow.color ?? "#000000"} onChange={(event) => applyStyle({ shadow: { ...shadow, color: event.currentTarget.value } })} /></label>
          <label className="style-control"><span>Blur</span><input type="number" min="0" aria-label="Shadow blur" value={shadow.blur ?? 8} onChange={(event) => applyStyle({ shadow: { ...shadow, blur: Math.max(0, Number(event.currentTarget.value)) } })} onBlur={finishEditSession} /></label>
          <label className="style-control"><span>Offset X</span><input type="number" aria-label="Shadow offset X" value={shadow.offsetX ?? 0} onChange={(event) => applyStyle({ shadow: { ...shadow, offsetX: Number(event.currentTarget.value) } })} onBlur={finishEditSession} /></label>
          <label className="style-control"><span>Offset Y</span><input type="number" aria-label="Shadow offset Y" value={shadow.offsetY ?? 4} onChange={(event) => applyStyle({ shadow: { ...shadow, offsetY: Number(event.currentTarget.value) } })} onBlur={finishEditSession} /></label>
          <label className="style-control"><span>Opacity</span><input type="range" min="0" max="100" aria-label="Shadow opacity" value={Math.round((shadow.opacity ?? 0.35) * 100)} onChange={(event) => applyStyle({ shadow: { ...shadow, opacity: Number(event.currentTarget.value) / 100 } })} onPointerUp={finishEditSession} /></label>
        </div>}
      </details>
      {hasText && <details className="style-text" open>
        <summary>Text</summary>
        <button type="button" className="icon-button small-icon style-details-reset" aria-label="Reset text style" onClick={() => resetSection("text")}><RotateCcw size={11} /></button>
        {richTextWidgets.length > 0 && <label className="style-control rich-text-mode-toggle">
          <span>Rich text</span>
          <input
            type="checkbox"
            aria-label="Rich text mode"
            checked={richTextMode}
            disabled={richTextWidgets.length !== editableWidgets.length}
            onChange={(event) => applyProps({ richText: event.currentTarget.checked })}
          />
        </label>}
        <div className="style-control-grid">
          <label className="style-control"><span>Font family</span><select aria-label="Font family" value={String(textValue("fontFamily", "Arial"))} onChange={(event) => applyText({ fontFamily: event.currentTarget.value })}>{textMixed("fontFamily") && <option value="Mixed" disabled>Mixed</option>}{["Arial", "Inter", "Georgia", "Times New Roman", "Verdana", "Trebuchet MS", "Courier New", "system-ui"].map((family) => <option key={family}>{family}</option>)}</select></label>
          <label className="style-control"><span>Weight</span><select aria-label="Font weight" value={String(textValue("fontWeight", "normal"))} onChange={(event) => applyText({ fontWeight: event.currentTarget.value })}>{textMixed("fontWeight") && <option value="Mixed" disabled>Mixed</option>}<option value="normal">Regular</option><option value="bold">Bold</option></select></label>
          <label className="style-control"><span>Style</span><select aria-label="Font style" value={String(textValue("fontStyle", "normal"))} onChange={(event) => applyText({ fontStyle: event.currentTarget.value })}>{textMixed("fontStyle") && <option value="Mixed" disabled>Mixed</option>}<option value="normal">Normal</option><option value="italic">Italic</option></select></label>
          <label className="style-control"><span>Underline {textMixed("underline") ? "(Mixed)" : ""}</span><input type="checkbox" aria-label="Underline text" checked={textValue("underline", false) === true} onChange={(event) => applyText({ underline: event.currentTarget.checked })} /></label>
          <label className="style-control"><span>Line height</span><input type="number" min="0.5" max="5" step="0.1" aria-label="Text line height" value={textMixed("lineHeight") ? "" : String(textValue("lineHeight", 1.2))} placeholder={textMixed("lineHeight") ? "Mixed" : undefined} onChange={(event) => applyText({ lineHeight: Math.min(5, Math.max(0.5, Number(event.currentTarget.value))) })} onBlur={finishEditSession} /></label>
          <label className="style-control"><span>Letter spacing</span><input type="number" min="-20" max="100" step="0.5" aria-label="Letter spacing" value={textMixed("letterSpacing") ? "" : String(textValue("letterSpacing", 0))} placeholder={textMixed("letterSpacing") ? "Mixed" : undefined} onChange={(event) => applyText({ letterSpacing: Math.min(100, Math.max(-20, Number(event.currentTarget.value))) })} onBlur={finishEditSession} /></label>
          <label className="style-control"><span>Align</span><select aria-label="Text alignment" value={String(textValue("align", "left"))} onChange={(event) => applyText({ align: event.currentTarget.value })}>{textMixed("align") && <option value="Mixed" disabled>Mixed</option>}<option value="left">Left</option><option value="center">Center</option><option value="right">Right</option><option value="justify">Justify</option></select></label>
          <label className="style-control"><span>Vertical align</span><select aria-label="Vertical text alignment" value={String(textValue("verticalAlign", "top"))} onChange={(event) => applyText({ verticalAlign: event.currentTarget.value })}>{textMixed("verticalAlign") && <option value="Mixed" disabled>Mixed</option>}<option value="top">Top</option><option value="middle">Middle</option><option value="bottom">Bottom</option></select></label>
        </div>
      </details>}
      {editableWidgets.length === 0 && <p className="field-hint">Unlock the selected element to edit its style.</p>}
    </section>
  );
}

function GeometrySection({ widgets }: { widgets: Widget[] }) {
  const selectedIds = useStore((state) => state.selectedIds);
  const zoom = useStore((state) => state.zoom);
  const pan = useStore((state) => state.pan);
  const geometryPreview = useStore((state) => state.geometryPreview);
  const editSessionRef = useRef<GeometryEditSession | null>(null);
  const scrubRef = useRef<{
    field: GeometryField;
    startX: number;
    startValue: number;
  } | null>(null);
  const [viewport, setViewport] = useState({ width: 1, height: 1 });
  const [units, setUnits] = useState<Record<UnitField, GeometryUnit>>({
    x: "px",
    y: "px",
    width: "px",
    height: "px",
  });
  const [activeField, setActiveField] = useState<GeometryField | null>(null);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    const canvas = document.querySelector(".canvas-stage");
    if (!(canvas instanceof HTMLElement)) return;
    const observer = new ResizeObserver(() => {
      setViewport({
        width: Math.max(1, canvas.clientWidth),
        height: Math.max(1, canvas.clientHeight),
      });
    });
    observer.observe(canvas);
    setViewport({
      width: Math.max(1, canvas.clientWidth),
      height: Math.max(1, canvas.clientHeight),
    });
    return () => observer.disconnect();
  }, []);

  const editableWidgets = widgets
    .map((widget) => ({
      ...widget,
      ...(geometryPreview?.[widget.id] ?? {}),
    }))
    .filter((widget) => !widget.locked);
  const worldWidth = viewport.width / zoom;
  const worldHeight = viewport.height / zoom;
  const originX = -pan.x / zoom;
  const originY = -pan.y / zoom;

  const toDisplayValue = (widget: Widget, field: GeometryField): number => {
    if (field === "rotation") return normalizeRotation(widget.rotation);
    if (field === "opacity") return widget.opacity * 100;
    if (field === "x" && units.x === "%") {
      return ((widget.x - originX) / worldWidth) * 100;
    }
    if (field === "y" && units.y === "%") {
      return ((widget.y - originY) / worldHeight) * 100;
    }
    if (field === "width" && units.width === "%") {
      return (widget.width / worldWidth) * 100;
    }
    if (field === "height" && units.height === "%") {
      return (widget.height / worldHeight) * 100;
    }
    return widget[field];
  };

  const fieldValue = (field: GeometryField): number | null => {
    if (editableWidgets.length === 0) return null;
    const values = editableWidgets.map((widget) => toDisplayValue(widget, field));
    if (values.some((value) => Math.abs(value - values[0]) > 0.001)) return null;
    return values[0];
  };

  const commitEditSession = useCallback(() => {
    const session = editSessionRef.current;
    if (!session) return;
    if (session.timer !== null) window.clearTimeout(session.timer);
    editSessionRef.current = null;

    const current = useStore.getState();
    const currentWidgets =
      current.project.screens.find((screen) => screen.id === session.screenId)?.widgets ?? [];
    const snapshotWidgets =
      session.snapshot.screens.find((screen) => screen.id === session.screenId)?.widgets ?? [];
    const changed = session.widgets.some((widget) => {
      const before = snapshotWidgets.find((item) => item.id === widget.id);
      const after = currentWidgets.find((item) => item.id === widget.id);
      return Boolean(
        before &&
          after &&
          (before.x !== after.x ||
            before.y !== after.y ||
            before.width !== after.width ||
            before.height !== after.height ||
            before.rotation !== after.rotation ||
            before.opacity !== after.opacity),
      );
    });
    if (changed) current.pushHistory(session.snapshot);
  }, []);

  const beginEdit = useCallback(
    (field: GeometryField) => {
      const session = editSessionRef.current;
      if (session) {
        if (activeField === field) return;
        commitEditSession();
      }
      const current = useStore.getState();
      const selected = current.project.screens
        .find((screen) => screen.id === current.getActiveScreenId())
        ?.widgets.filter(
          (widget) => selectedIds.includes(widget.id) && !widget.locked,
        ) ?? [];
      if (selected.length === 0) return;
      editSessionRef.current = {
        snapshot: current.project,
        screenId: current.getActiveScreenId(),
        widgets: selected,
        timer: null,
      };
    },
    [activeField, commitEditSession, selectedIds],
  );

  const applyValue = useCallback(
    (field: GeometryField, displayValue: number) => {
      if (!Number.isFinite(displayValue)) return;
      beginEdit(field);
      const session = editSessionRef.current;
      if (!session) return;

      let value = displayValue;
      if (field === "x" && units.x === "%") {
        value = originX + (displayValue / 100) * worldWidth;
      } else if (field === "y" && units.y === "%") {
        value = originY + (displayValue / 100) * worldHeight;
      } else if (field === "width" && units.width === "%") {
        value = (displayValue / 100) * worldWidth;
      } else if (field === "height" && units.height === "%") {
        value = (displayValue / 100) * worldHeight;
      } else if (field === "rotation") {
        value = normalizeRotation(displayValue);
      } else if (field === "opacity") {
        value = displayValue / 100;
      }

      if (field === "width" || field === "height") value = Math.max(4, value);
      if (field === "opacity") value = Math.min(1, Math.max(0, value));

      const updates = getGeometryUpdates(session.widgets, field, value);
      const updateById = new Map(updates.map((update) => [update.id, update]));
      const current = useStore.getState();
      const project: Project = {
        ...current.project,
        updatedAt: new Date().toISOString(),
        screens: current.project.screens.map((screen) =>
          screen.id !== current.getActiveScreenId()
            ? screen
            : {
                ...screen,
                widgets: mapWidgetsDeep(screen.widgets, (widget) => {
                  const update = updateById.get(widget.id);
                  return update
                    ? {
                        ...widget,
                        ...update,
                        ...(isTextStyleWidget(widget) && (field === "width" || field === "height")
                          ? { props: { ...widget.props, autoSize: false } }
                          : {}),
                      }
                    : widget;
                }),
              },
        ),
      };
      useStore.setState({ project, isDirty: true });

      const currentSession = editSessionRef.current;
      if (currentSession) {
        if (currentSession.timer !== null) window.clearTimeout(currentSession.timer);
        currentSession.timer = window.setTimeout(commitEditSession, 500);
      }
    },
    [
      beginEdit,
      commitEditSession,
      originX,
      originY,
      units.height,
      units.width,
      units.x,
      units.y,
      worldHeight,
      worldWidth,
    ],
  );

  const handleInputChange = (field: GeometryField, rawValue: string) => {
    setDraft(rawValue);
    const value = evaluateGeometryExpression(rawValue);
    if (value === null) return;
    applyValue(field, value);
  };

  const startScrub = (field: GeometryField, event: React.PointerEvent<HTMLLabelElement>) => {
    if (event.button !== 0 || editableWidgets.length === 0) return;
    event.preventDefault();
    const value = fieldValue(field) ?? toDisplayValue(editableWidgets[0], field);
    event.currentTarget.setPointerCapture(event.pointerId);
    scrubRef.current = {
      field,
      startX: event.clientX,
      startValue: value,
    };
    setActiveField(field);
    setDraft(String(Number(value.toFixed(2))));
    beginEdit(field);
  };

  const moveScrub = (event: React.PointerEvent<HTMLLabelElement>) => {
    const scrub = scrubRef.current;
    if (!scrub) return;
    const sensitivity = event.shiftKey ? 10 : 1;
    const value = scrub.startValue + (event.clientX - scrub.startX) * sensitivity;
    setDraft(String(Number(value.toFixed(2))));
    applyValue(scrub.field, value);
  };

  const finishScrub = () => {
    if (!scrubRef.current) return;
    scrubRef.current = null;
    commitEditSession();
    setActiveField(null);
  };

  const cancelEdit = () => {
    const session = editSessionRef.current;
    if (session) {
      if (session.timer !== null) window.clearTimeout(session.timer);
      editSessionRef.current = null;
      useStore.setState({ project: session.snapshot, isDirty: true });
    }
    setActiveField(null);
    setDraft("");
  };

  const finishField = () => {
    commitEditSession();
    setActiveField(null);
    setDraft("");
  };

  const unitFor = (field: GeometryField): GeometryUnit | null =>
    field === "x" || field === "y" || field === "width" || field === "height"
      ? units[field]
      : null;

  const cycleUnit = (field: UnitField) => {
    setUnits((current) => ({
      ...current,
      [field]: current[field] === "px" ? "%" : "px",
    }));
  };

  const stepField = (field: GeometryField, direction: -1 | 1) => {
    const currentValue =
      evaluateGeometryExpression(activeField === field ? draft : "") ??
      fieldValue(field) ??
      (editableWidgets[0] ? toDisplayValue(editableWidgets[0], field) : 0);
    const nextValue = currentValue + direction;
    setActiveField(field);
    setDraft(String(nextValue));
    applyValue(field, nextValue);
  };

  const renderField = (field: GeometryField, label: string) => {
    const commonValue = fieldValue(field);
    const isActive = activeField === field;
    const displayValue = isActive
      ? draft
      : commonValue === null
        ? ""
        : String(Number(commonValue.toFixed(2)));
    const mixed = commonValue === null && editableWidgets.length > 1;
    const invalidExpression =
      isActive && Boolean(draft.trim()) && evaluateGeometryExpression(draft) === null;
    const unit = unitFor(field);
    return (
      <div className="geometry-field" key={field}>
        <label
          className="geometry-field-label"
          htmlFor={`geometry-${field}`}
          title={`Drag to adjust ${label}; hold Shift for larger steps`}
          onPointerDown={(event) => startScrub(field, event)}
          onPointerMove={moveScrub}
          onPointerUp={finishScrub}
          onPointerCancel={finishScrub}
          onLostPointerCapture={finishScrub}
        >
          {label}
        </label>
        <div className="geometry-input-wrap">
          <input
            id={`geometry-${field}`}
            className={`geometry-input${invalidExpression ? " geometry-input-invalid" : ""}`}
            type="text"
            inputMode="decimal"
            value={displayValue}
            placeholder={mixed ? "Mixed" : "—"}
            aria-label={label}
            aria-invalid={invalidExpression}
            disabled={editableWidgets.length === 0}
            onFocus={() => {
              setActiveField(field);
              setDraft(commonValue === null ? "" : String(Number(commonValue.toFixed(2))));
            }}
            onChange={(event) => handleInputChange(field, event.currentTarget.value)}
            onBlur={finishField}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                cancelEdit();
                event.currentTarget.blur();
                return;
              }
              if (event.key === "Enter") {
                event.preventDefault();
                finishField();
                event.currentTarget.blur();
                return;
              }
              if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
              event.preventDefault();
              const currentValue =
                evaluateGeometryExpression(displayValue) ??
                commonValue ??
                toDisplayValue(editableWidgets[0], field);
              const step = event.shiftKey ? 10 : 1;
              const nextValue =
                currentValue + (event.key === "ArrowUp" ? step : -step);
              setDraft(String(nextValue));
              applyValue(field, nextValue);
            }}
          />
          <span className="geometry-steppers">
            <button
              type="button"
              aria-label={`Increase ${label}`}
              disabled={editableWidgets.length === 0}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => stepField(field, 1)}
            >
              <ChevronUp size={9} />
            </button>
            <button
              type="button"
              aria-label={`Decrease ${label}`}
              disabled={editableWidgets.length === 0}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => stepField(field, -1)}
            >
              <ChevronDown size={9} />
            </button>
          </span>
          {unit && (
            <button
              className="geometry-unit"
              type="button"
              aria-label={`Cycle ${label} unit, currently ${unit}`}
              title={`${unit === "px" ? "Switch to percent of visible canvas" : "Switch to pixels"}`}
              disabled={editableWidgets.length === 0}
              onClick={() => cycleUnit(field as UnitField)}
            >
              {unit}
            </button>
          )}
        </div>
        {invalidExpression && (
          <p className="field-hint geometry-expression-error">
            Enter a valid arithmetic expression; the previous value is unchanged.
          </p>
        )}
      </div>
    );
  };

  if (widgets.length === 0) return null;

  const opacityValue = fieldValue("opacity") ?? (editableWidgets[0]?.opacity ?? 1) * 100;
  const opacityExpressionInvalid =
    activeField === "opacity" &&
    Boolean(draft.trim()) &&
    evaluateGeometryExpression(draft) === null;
  return (
    <section className="geometry-section" aria-label="Geometry">
      <div className="section-label geometry-heading"><span>GEOMETRY</span></div>
      <div className="geometry-grid">
        {renderField("x", "X")}
        {renderField("y", "Y")}
        {renderField("width", "Width")}
        {renderField("height", "Height")}
        {renderField("rotation", "Rotation")}
        <div className="geometry-field opacity-field">
          <label
            className="geometry-field-label"
            htmlFor="geometry-opacity"
            title="Drag to adjust opacity; hold Shift for larger steps"
            onPointerDown={(event) => startScrub("opacity", event)}
            onPointerMove={moveScrub}
            onPointerUp={finishScrub}
            onPointerCancel={finishScrub}
            onLostPointerCapture={finishScrub}
          >
            Opacity
          </label>
          <div className="geometry-opacity-control">
            <input
              className="geometry-opacity-slider"
              type="range"
              min="0"
              max="100"
              step="1"
              value={Math.min(100, Math.max(0, opacityValue))}
              aria-label="Opacity slider"
              disabled={editableWidgets.length === 0}
              onPointerDown={() => beginEdit("opacity")}
              onPointerUp={finishScrub}
              onChange={(event) => applyValue("opacity", Number(event.currentTarget.value))}
            />
            <input
              id="geometry-opacity"
              className={`geometry-input opacity-number${opacityExpressionInvalid ? " geometry-input-invalid" : ""}`}
              type="text"
              inputMode="decimal"
              value={
                activeField === "opacity"
                  ? draft
                  : fieldValue("opacity") === null
                    ? ""
                    : String(Number(opacityValue.toFixed(2)))
              }
              placeholder={fieldValue("opacity") === null ? "Mixed" : "100"}
              aria-label="Opacity percent"
              aria-invalid={opacityExpressionInvalid}
              disabled={editableWidgets.length === 0}
              onFocus={() => {
                setActiveField("opacity");
                setDraft(String(Number(opacityValue.toFixed(2))));
              }}
              onChange={(event) => handleInputChange("opacity", event.currentTarget.value)}
              onBlur={finishField}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  finishField();
                  event.currentTarget.blur();
                } else if (event.key === "Escape") {
                  event.preventDefault();
                  cancelEdit();
                  event.currentTarget.blur();
                } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
                  event.preventDefault();
                  const currentValue = evaluateGeometryExpression(draft) ?? opacityValue;
                  const step = event.shiftKey ? 10 : 1;
                  const nextValue =
                    currentValue + (event.key === "ArrowUp" ? step : -step);
                  setDraft(String(nextValue));
                  applyValue("opacity", nextValue);
                }
              }}
            />
            <span className="geometry-percent">%</span>
          </div>
          {opacityExpressionInvalid && (
            <p className="field-hint geometry-expression-error">
              Enter a valid arithmetic expression; the previous value is unchanged.
            </p>
          )}
        </div>
      </div>
      {editableWidgets.length === 0 && (
        <p className="field-hint">Unlock the selected element to edit its geometry.</p>
      )}
    </section>
  );
}

function TextSizeControl({ widgets }: { widgets: Widget[] }) {
  const eligibleWidgets = widgets.filter(
    (widget) => !widget.locked && isTextStyleWidget(widget),
  );
  const sessionRef = useRef<{
    snapshot: Project;
    screenId: string;
    widgetIds: string[];
    timer: number | null;
  } | null>(null);
  const [draft, setDraft] = useState("");
  const selectionKey = eligibleWidgets.map((widget) => widget.id).join("\u0000");
  const readFontSize = (widget: Widget): number =>
    typeof widget.props.fontSize === "number"
      ? widget.props.fontSize
      : Number(getDefaultTextProperties(widget).fontSize ?? 14);
  const values = eligibleWidgets.map(readFontSize);
  const mixedSize = values.some((value) => value !== values[0]);
  const currentSize = values.length > 0 && !mixedSize ? values[0] : null;

  const finishEdit = useCallback(() => {
    const session = sessionRef.current;
    if (!session) return;
    if (session.timer !== null) window.clearTimeout(session.timer);
    sessionRef.current = null;
    const current = useStore.getState();
    const beforeWidgets =
      session.snapshot.screens.find((screen) => screen.id === session.screenId)?.widgets ?? [];
    const afterWidgets =
      current.project.screens.find((screen) => screen.id === session.screenId)?.widgets ?? [];
    const changed = session.widgetIds.some((id) => {
      const before = beforeWidgets.find((widget) => widget.id === id);
      const after = afterWidgets.find((widget) => widget.id === id);
      return Boolean(
        before &&
        after &&
        (before.props.fontSize !== after.props.fontSize ||
          before.width !== after.width ||
          before.height !== after.height),
      );
    });
    if (changed) current.pushHistory(session.snapshot);
  }, []);

  useEffect(() => {
    finishEdit();
    setDraft("");
  }, [finishEdit, selectionKey]);

  useEffect(() => () => finishEdit(), [finishEdit]);

  const applySize = (rawValue: string) => {
    if (!rawValue.trim()) {
      setDraft(rawValue);
      return;
    }
    const parsedValue = Number(rawValue);
    if (!Number.isFinite(parsedValue)) {
      setDraft(rawValue);
      return;
    }
    const fontSize = Math.min(500, Math.max(1, parsedValue));
    setDraft(String(fontSize));
    if (eligibleWidgets.length === 0) return;
    let session = sessionRef.current;
    if (!session) {
      const current = useStore.getState();
      session = {
        snapshot: current.project,
        screenId: current.getActiveScreenId(),
        widgetIds: eligibleWidgets.map((widget) => widget.id),
        timer: null,
      };
      sessionRef.current = session;
    }
    const current = useStore.getState();
    const project: Project = {
      ...current.project,
      updatedAt: new Date().toISOString(),
      screens: current.project.screens.map((screen) =>
        screen.id !== session!.screenId
          ? screen
          : {
              ...screen,
              widgets: mapWidgetsDeep(screen.widgets, (widget) => {
                if (!session!.widgetIds.includes(widget.id)) return widget;
                const props: Record<string, unknown> = {
                  ...widget.props,
                  fontSize,
                };
                if (props.autoSize !== true) return { ...widget, props };
                const text = widget.type === "list"
                  ? normalizeListItems(props.items).join("\n")
                  : typeof props.text === "string" ? props.text : "";
                const measured = measureTextBounds(
                  text,
                  typeof props.fontFamily === "string" ? props.fontFamily : "Arial",
                  fontSize,
                  typeof props.fontWeight === "string" ? props.fontWeight : "normal",
                  typeof props.lineHeight === "number" ? props.lineHeight : 1.2,
                );
                return { ...widget, props, width: measured.width, height: measured.height };
              }),
            },
      ),
    };
    useStore.setState({ project, isDirty: true });
    if (session.timer !== null) window.clearTimeout(session.timer);
    session.timer = window.setTimeout(finishEdit, 500);
  };

  const stepSize = (direction: -1 | 1) => {
    const base = draft && Number.isFinite(Number(draft))
      ? Number(draft)
      : currentSize ?? values[0] ?? 14;
    applySize(String(Math.min(500, Math.max(1, base + direction))));
  };

  if (!widgets.some(isTextStyleWidget)) return null;

  return (
    <section className="inspector-font-size" aria-label="Text size">
      <span className="inspector-font-size-label">TEXT SIZE</span>
      <div className="inspector-font-size-stepper">
        <button
          type="button"
          aria-label="Decrease font size"
          title="Decrease font size"
          disabled={!eligibleWidgets.length}
          onClick={() => stepSize(-1)}
        >
          <Minus size={13} />
        </button>
        <input
          type="number"
          min="1"
          max="500"
          step="1"
          aria-label="Font size"
          value={draft || (currentSize === null ? "" : String(currentSize))}
          placeholder={mixedSize ? "Mixed" : "14"}
          disabled={!eligibleWidgets.length}
          onChange={(event) => applySize(event.currentTarget.value)}
          onBlur={finishEdit}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              finishEdit();
              event.currentTarget.blur();
            }
          }}
        />
        <span>px</span>
        <button
          type="button"
          aria-label="Increase font size"
          title="Increase font size"
          disabled={!eligibleWidgets.length}
          onClick={() => stepSize(1)}
        >
          <Plus size={13} />
        </button>
      </div>
    </section>
  );
}

function copyPanelWidgets(widgets: Widget[], parentIds = new Map<string, string>()): Widget[] {
  const copies = createWidgetCopies(widgets, [], { x: 0, y: 0 });
  return copies.map((copy, index) => {
    const source = widgets[index];
    return {
      ...copy,
      zIndex: source.zIndex,
      groupId: source.groupId
        ? parentIds.get(source.groupId) ?? copy.groupId
        : undefined,
    };
  });
}

function DynamicPanelSection({ screen, widget }: { screen: Project["screens"][number]; widget: Widget }) {
  const editingScope = useStore((state) => state.activePanelEdit);
  const states = getPanelStates(widget);
  const activeState = getActivePanelState(widget);
  const isEditing = editingScope?.panelId === widget.id && editingScope.stateId === activeState?.id;

  const update = (transform: (panel: Widget, current: DynamicPanelState[]) => Widget) => {
    const current = useStore.getState();
    current.setProject({
      ...current.project,
      updatedAt: new Date().toISOString(),
      screens: current.project.screens.map((item) =>
        item.id === screen.id
          ? {
              ...item,
              widgets: updatePanelState(item.widgets, widget.id, transform),
            }
          : item,
      ),
    });
  };

  const selectState = (stateId: string) => {
    update((panel, current) => withPanelStates(panel, current, stateId));
    useStore.getState().setActivePanelEdit({ panelId: widget.id, stateId });
  };

  const addState = () => {
    const state: DynamicPanelState = {
      id: crypto.randomUUID(),
      name: `State ${states.length + 1}`,
      widgets: [],
    };
    update((panel, current) => withPanelStates(panel, [...current, state], state.id));
    useStore.getState().setActivePanelEdit({ panelId: widget.id, stateId: state.id });
  };

  const renameState = (stateId: string, name: string) => {
    const normalized = name.trim().slice(0, 120);
    if (!normalized) return;
    update((panel, current) => withPanelStates(
      panel,
      current.map((state) => state.id === stateId ? { ...state, name: normalized } : state),
    ));
  };

  const duplicateState = () => {
    if (!activeState) return;
    const duplicate: DynamicPanelState = {
      id: crypto.randomUUID(),
      name: `${activeState.name} copy`,
      widgets: copyPanelWidgets(activeState.widgets, new Map([[widget.id, widget.id]])),
    };
    update((panel, current) => withPanelStates(panel, [...current, duplicate], duplicate.id));
    useStore.getState().setActivePanelEdit({ panelId: widget.id, stateId: duplicate.id });
  };

  const deleteState = (stateId: string) => {
    if (states.length <= 1) return;
    const remaining = states.filter((state) => state.id !== stateId);
    update((panel) => withPanelStates(panel, remaining));
    const nextActive = remaining.find((state) => state.id === widget.props.activeStateId) ?? remaining[0];
    useStore.getState().setActivePanelEdit({ panelId: widget.id, stateId: nextActive.id });
  };

  const moveState = (stateId: string, offset: number) => {
    const index = states.findIndex((state) => state.id === stateId);
    const targetIndex = index + offset;
    if (index < 0 || targetIndex < 0 || targetIndex >= states.length) return;
    const reordered = [...states];
    const [moved] = reordered.splice(index, 1);
    reordered.splice(targetIndex, 0, moved);
    update((panel) => withPanelStates(panel, reordered, panel.props.activeStateId));
  };

  return (
    <section className="inspector-section dynamic-panel-section" aria-label="Dynamic panel states">
      <div className="section-label"><span>STATES</span></div>
      {states.map((state, index) => (
        <div className={`dynamic-panel-state${state.id === activeState?.id ? " is-active" : ""}`} key={state.id}>
          <button
            className="button button-quiet"
            aria-label={`Show ${state.name}`}
            aria-pressed={state.id === activeState?.id}
            onClick={() => selectState(state.id)}
          >
            {state.name} <span>{state.widgets.length}</span>
          </button>
          <input
            className="text-field"
            aria-label={`Rename ${state.name}`}
            defaultValue={state.name}
            onBlur={(event) => renameState(state.id, event.currentTarget.value)}
          />
          <button className="icon-button small-icon" aria-label={`Move ${state.name} up`} disabled={index === 0} onClick={() => moveState(state.id, -1)}>↑</button>
          <button className="icon-button small-icon" aria-label={`Move ${state.name} down`} disabled={index === states.length - 1} onClick={() => moveState(state.id, 1)}>↓</button>
          <button className="icon-button small-icon" aria-label={`Duplicate ${state.name}`} onClick={duplicateState}>＋</button>
          <button className="icon-button small-icon" aria-label={`Delete ${state.name}`} disabled={states.length <= 1} onClick={() => deleteState(state.id)}>×</button>
        </div>
      ))}
      <div className="dynamic-panel-state-actions">
        <button className="button button-quiet" onClick={addState}>Add state</button>
        <button
          className="button button-quiet"
          aria-pressed={isEditing}
          onClick={() => activeState && useStore.getState().setActivePanelEdit(
            isEditing ? null : { panelId: widget.id, stateId: activeState.id },
          )}
          disabled={!activeState}
        >
          {isEditing ? "Stop editing state" : "Edit active state"}
        </button>
      </div>
      <p className="field-hint">Select a state, then add or arrange its widgets on the canvas.</p>
    </section>
  );
}

function RepeaterSection({ screen, widget }: { screen: Project["screens"][number]; widget: Widget }) {
  const [error, setError] = useState<string | null>(null);
  const [newField, setNewField] = useState("");
  const dataset = getRepeaterDataset(widget);
  const template = getRepeaterTemplate(widget);
  const editing = useStore((state) => state.activeRepeaterEdit === widget.id);
  const fields = [...new Set(dataset.flatMap((record) => Object.keys(record)))];

  const update = (props: Record<string, unknown>) => {
    const current = useStore.getState();
    current.setProject({
      ...current.project,
      updatedAt: new Date().toISOString(),
      screens: current.project.screens.map((item) =>
        item.id === screen.id
          ? {
              ...item,
              widgets: updateRepeater(item.widgets, widget.id, (repeater) => ({
                ...repeater,
                props: { ...repeater.props, ...props },
              })),
            }
          : item,
      ),
    });
    setError(null);
  };

  const applyDataset = (value: unknown) => {
    const next = parseRepeaterDataset(value);
    update({ dataset: next });
  };

  const downloadCsv = () => {
    const url = URL.createObjectURL(new Blob([repeaterDatasetToCsv(dataset)], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${widget.name ?? "repeater"}-data.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section className="inspector-section repeater-section" aria-label="Repeater data">
      <div className="section-label"><span>REPEATER</span></div>
      <label className="field-label" htmlFor="repeater-layout">Row layout</label>
      <select
        id="repeater-layout"
        className="text-field"
        value={widget.props.layout === "horizontal" || widget.props.layout === "grid" ? widget.props.layout : "vertical"}
        onChange={(event) => update({ layout: event.currentTarget.value })}
      >
        <option value="vertical">Vertical</option>
        <option value="horizontal">Horizontal</option>
        <option value="grid">Grid</option>
      </select>
      <label className="field-label" htmlFor="repeater-gap">Row gap</label>
      <input
        id="repeater-gap"
        className="text-field"
        type="number"
        min={0}
        value={typeof widget.props.gap === "number" ? widget.props.gap : 8}
        onChange={(event) => update({ gap: Math.max(0, Number(event.currentTarget.value) || 0) })}
      />
      <div className="dynamic-panel-state-actions">
        <button
          className="button button-quiet"
          aria-pressed={editing}
          onClick={() => useStore.getState().setActiveRepeaterEdit(editing ? null : widget.id)}
        >
          {editing ? "Stop editing template" : "Edit row template"}
        </button>
      </div>
      <p className="field-hint">{template.length} template widgets. Bind a text widget with {"{{item.field}}"}.</p>
      <div className="section-label"><span>DATASET ({dataset.length}/1,000)</span></div>
      <div className="dynamic-panel-state-actions">
        <input
          className="text-field"
          aria-label="New dataset field"
          placeholder="Field name"
          value={newField}
          onChange={(event) => setNewField(event.currentTarget.value)}
        />
        <button
          className="button button-quiet"
          disabled={!newField.trim() || fields.includes(newField.trim())}
          onClick={() => {
            const field = newField.trim();
            update({
              dataset: dataset.length > 0
                ? dataset.map((record) => ({ ...record, [field]: "" }))
                : [{ [field]: "" }],
            });
            setNewField("");
          }}
        >Add field</button>
        <button
          className="button button-quiet"
          disabled={dataset.length >= 1_000}
          onClick={() => applyDataset([...dataset, Object.fromEntries(fields.map((field) => [field, ""]))])}
        >Add record</button>
        <button className="button button-quiet" onClick={downloadCsv}>Export CSV</button>
        <label className="button button-quiet">
          Import CSV/JSON
          <input
            type="file"
            accept=".csv,.json,text/csv,application/json"
            hidden
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              if (!file) return;
              void file.text().then((contents) => {
                try {
                  applyDataset(file.name.toLowerCase().endsWith(".json")
                    ? JSON.parse(contents) as unknown
                    : parseRepeaterCsv(contents));
                } catch (cause) {
                  setError(cause instanceof Error ? cause.message : "Could not import repeater data.");
                }
              }).catch((cause: unknown) => {
                setError(cause instanceof Error ? cause.message : "Could not read the selected file.");
              });
              event.currentTarget.value = "";
            }}
          />
        </label>
      </div>
      {fields.length > 0 && (
        <div className="repeater-data-table-wrap">
          <table className="repeater-data-table">
            <thead><tr>{fields.map((field) => <th key={field}>{field}</th>)}<th>Row</th></tr></thead>
            <tbody>
              {dataset.map((record, rowIndex) => (
                <tr key={rowIndex}>
                  {fields.map((field) => (
                    <td key={field}>
                      <input
                        className="text-field"
                        aria-label={`Row ${rowIndex + 1} ${field}`}
                        value={record[field] === null ? "" : String(record[field] ?? "")}
                        onChange={(event) => update({
                          dataset: dataset.map((row, index) => index === rowIndex
                            ? { ...row, [field]: event.currentTarget.value }
                            : row),
                        })}
                      />
                    </td>
                  ))}
                  <td><button className="icon-button small-icon" aria-label={`Delete row ${rowIndex + 1}`} onClick={() => update({ dataset: dataset.filter((_, index) => index !== rowIndex) })}>×</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {repeaterDataBytes(dataset) > 100 * 1024 && (
        <p className="field-hint" role="status">Dataset exceeds 100 KB and may increase project file size.</p>
      )}
      {error && <p className="field-hint" role="alert">{error}</p>}
    </section>
  );
}

function RepeaterBindingSection({ screen, widget }: { screen: Project["screens"][number]; widget: Widget }) {
  const repeater = widget.groupId
    ? collectWidgetsDeep(screen.widgets).find((candidate) =>
        candidate.id === widget.groupId && candidate.type === "repeater",
      )
    : undefined;
  if (!repeater) return null;
  const fields = [...new Set(getRepeaterDataset(repeater).flatMap((record) => Object.keys(record)))];
  const property = widget.type === "image"
    ? "src"
    : typeof widget.props.text === "string"
      ? "text"
      : "label";
  const current = widget.props[property];
  const bindingMatch = typeof current === "string"
    ? current.match(/^\{\{\s*item\.([\w$.-]+)\s*\}\}$/)
    : null;
  const visibleWhen = typeof widget.props.visibleWhen === "object" &&
    widget.props.visibleWhen !== null && !Array.isArray(widget.props.visibleWhen)
    ? widget.props.visibleWhen as Record<string, unknown>
    : undefined;

  const updateTemplateProps = (props: Record<string, unknown>) => {
    const currentStore = useStore.getState();
    currentStore.setProject({
      ...currentStore.project,
      updatedAt: new Date().toISOString(),
      screens: currentStore.project.screens.map((item) => item.id === screen.id
        ? {
            ...item,
            widgets: updateRepeater(item.widgets, repeater.id, (container) => ({
              ...container,
              props: {
                ...container.props,
                rowTemplate: {
                  widgets: getRepeaterTemplate(container).map((candidate) =>
                    candidate.id === widget.id
                      ? { ...candidate, props: { ...candidate.props, ...props } }
                      : candidate,
                  ),
                },
              },
            })),
          }
        : item),
    });
  };

  const bindField = (field: string) => {
    const currentStore = useStore.getState();
    currentStore.setProject({
      ...currentStore.project,
      updatedAt: new Date().toISOString(),
      screens: currentStore.project.screens.map((item) => item.id === screen.id
        ? {
            ...item,
            widgets: updateRepeater(item.widgets, repeater.id, (container) => {
              const binding = typeof container.props.itemBinding === "object" &&
                container.props.itemBinding !== null && !Array.isArray(container.props.itemBinding)
                ? container.props.itemBinding as Record<string, unknown>
                : {};
              const nextBindings = Object.fromEntries(Object.entries(binding)
                .filter(([, id]) => id !== widget.id));
              if (field) nextBindings[field] = widget.id;
              const template = getRepeaterTemplate(container).map((candidate) =>
                candidate.id === widget.id
                  ? { ...candidate, props: { ...candidate.props, [property]: field ? `{{item.${field}}}` : "" } }
                  : candidate,
              );
              return {
                ...container,
                props: {
                  ...container.props,
                  itemBinding: nextBindings,
                  rowTemplate: { widgets: template },
                },
              };
            }),
          }
        : item),
    });
  };

  return (
    <section className="inspector-section" aria-label="Repeater item binding">
      <div className="section-label"><span>REPEATER BINDING</span></div>
      <label className="field-label" htmlFor="repeater-binding">Dataset field</label>
      <select
        id="repeater-binding"
        className="text-field"
        value={bindingMatch?.[1] ?? ""}
        onChange={(event) => bindField(event.currentTarget.value)}
      >
        <option value="">No field binding</option>
        {fields.map((field) => <option key={field} value={field}>{field}</option>)}
      </select>
      <label className="field-label repeater-visibility-toggle">
        <input
          type="checkbox"
          checked={Boolean(visibleWhen)}
          onChange={(event) => updateTemplateProps({
            visibleWhen: event.currentTarget.checked
              ? { field: fields[0] ?? "", operator: "equals", value: "" }
              : undefined,
          })}
        />
        Conditional visibility per row
      </label>
      {visibleWhen && (
        <>
          <label className="field-label" htmlFor="repeater-visibility-field">Show when field</label>
          <select
            id="repeater-visibility-field"
            className="text-field"
            value={typeof visibleWhen.field === "string" ? visibleWhen.field : ""}
            onChange={(event) => updateTemplateProps({
              visibleWhen: { ...visibleWhen, field: event.currentTarget.value },
            })}
          >
            <option value="">Choose field</option>
            {fields.map((field) => <option key={field} value={field}>{field}</option>)}
          </select>
          <select
            aria-label="Visibility comparison"
            className="text-field"
            value={typeof visibleWhen.operator === "string" ? visibleWhen.operator : "equals"}
            onChange={(event) => updateTemplateProps({
              visibleWhen: { ...visibleWhen, operator: event.currentTarget.value },
            })}
          >
            <option value="equals">Equals</option>
            <option value="notEquals">Does not equal</option>
            <option value="contains">Contains</option>
            <option value="greaterThan">Greater than</option>
            <option value="lessThan">Less than</option>
          </select>
          <input
            className="text-field"
            aria-label="Visibility value"
            value={String(visibleWhen.value ?? "")}
            onChange={(event) => {
              const field = typeof visibleWhen.field === "string" ? visibleWhen.field : "";
              const sample = getRepeaterDataset(repeater)[0]?.[field];
              const raw = event.currentTarget.value;
              const value = typeof sample === "number"
                ? Number(raw)
                : typeof sample === "boolean"
                  ? raw === "true"
                  : raw;
              updateTemplateProps({ visibleWhen: { ...visibleWhen, value } });
            }}
          />
        </>
      )}
    </section>
  );
}

export function RightInspector({ onToggle, onUpdates, onRename }: RightInspectorProps) {
  const inspectorTab = useStore((state) => state.inspectorTab);
  const setInspectorTab = useStore((state) => state.setInspectorTab);
  const project = useStore((state) => state.project);
  const activeScreenId = useStore((state) => state.getActiveScreenId());
  const selectedIds = useStore((state) => state.selectedIds);
  const activeRepeaterEdit = useStore((state) => state.activeRepeaterEdit);
  const filePath = useStore((state) => state.filePath);
  const rightPanelOpen = useStore((state) => state.rightPanelOpen);
  const displayPath = filePath ? filePath.replaceAll("\\", "/").split("/").at(-1) : "Not saved yet";
  const selectedScreen = project.screens.find((screen) => screen.id === activeScreenId);
  const selectedWidgets =
    selectedScreen ? collectWidgetsDeep(selectedScreen.widgets).filter(
      (widget) => selectedIds.includes(widget.id),
    ) : [];
  const selectedWidget = selectedWidgets.length === 1 ? selectedWidgets[0] : undefined;
  useEffect(() => {
    if (selectedWidget?.type !== "dynamic-panel") return;
    const state = getActivePanelState(selectedWidget);
    if (state) {
      useStore.getState().setActivePanelEdit({
        panelId: selectedWidget.id,
        stateId: state.id,
      });
    }
  }, [selectedWidget?.id]);
  useEffect(() => {
    if (selectedWidget?.type === "repeater") {
      useStore.getState().setActivePanelEdit(null);
      useStore.getState().setActiveRepeaterEdit(selectedWidget.id);
    } else if (
      selectedWidget &&
      selectedWidget.groupId !== activeRepeaterEdit
    ) {
      useStore.getState().setActiveRepeaterEdit(null);
    }
  }, [selectedWidget?.groupId, selectedWidget?.id, selectedWidget?.type]);
  const selectedDefinition = selectedWidget
    ? getShapeToolDefinition(selectedWidget.type)
    : undefined;
  const selectedLabelValue =
    selectedWidget?.props.label ?? selectedWidget?.props.text ?? selectedWidget?.props.fileName;
  const selectedLabel =
    typeof selectedLabelValue === "string" && selectedLabelValue.trim()
      ? selectedLabelValue.trim()
      : selectedDefinition?.label ?? selectedWidget?.type;

  if (!rightPanelOpen) return null;

  return (
    <aside className="sidebar inspector right-dock">
      <div className="right-dock-header">
        <span className="right-dock-title">LAYERS &amp; INSPECTOR</span>
        <button className="icon-button small-icon" aria-label="Close right sidebar" onClick={onToggle}><PanelRightClose size={15} /></button>
      </div>
      <TextSizeControl widgets={selectedWidgets} />
      <section className="right-inspector-panel" aria-label="Inspector">
      <div className="inspector-top">
        <div><span className="inspector-overline">INSPECTOR</span><h2>{selectedWidget ? selectedLabel : selectedWidgets.length > 1 ? `${selectedWidgets.length} items selected` : "Select an element"}</h2></div>
      </div>
      <div className="inspector-body">
        {selectedWidget ? (
          <div className="inspector-selection" aria-label="Selected element identity">
            <span className="inspector-placeholder-icon">
              <WidgetIcon type={selectedWidget.type} size={17} />
            </span>
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
        <div className="inspector-tabs" role="tablist" aria-label="Inspector panels">
          <button
            id="inspector-design-tab"
            role="tab"
            aria-selected={inspectorTab === "design"}
            aria-controls="inspector-design-panel"
            className={inspectorTab === "design" ? "inspector-tab is-active" : "inspector-tab"}
            onClick={() => setInspectorTab("design")}
          >
            Design
          </button>
          <button
            id="inspector-responsive-tab"
            role="tab"
            aria-selected={inspectorTab === "responsive"}
            aria-controls="inspector-responsive-panel"
            className={inspectorTab === "responsive" ? "inspector-tab is-active" : "inspector-tab"}
            onClick={() => setInspectorTab("responsive")}
            disabled={!selectedWidget}
          >
            Responsive
          </button>
          <button
            id="inspector-interactions-tab"
            role="tab"
            aria-selected={inspectorTab === "interactions"}
            aria-controls="inspector-interactions-panel"
            className={inspectorTab === "interactions" ? "inspector-tab is-active" : "inspector-tab"}
            onClick={() => setInspectorTab("interactions")}
            disabled={!selectedWidget}
          >
            Interactions
          </button>
          <button
            id="inspector-notes-tab"
            role="tab"
            aria-selected={inspectorTab === "notes"}
            aria-controls="inspector-notes-panel"
            className={inspectorTab === "notes" ? "inspector-tab is-active" : "inspector-tab"}
            onClick={() => setInspectorTab("notes")}
            disabled={!selectedWidget}
          >
            Notes
          </button>
        </div>
        {inspectorTab === "design" ? (
          <div id="inspector-design-panel" role="tabpanel" aria-labelledby="inspector-design-tab">
            <GeometrySection widgets={selectedWidgets} />
            <StyleSection widgets={selectedWidgets} />
            {selectedWidget?.type === "dynamic-panel" && selectedScreen && (
              <DynamicPanelSection screen={selectedScreen} widget={selectedWidget} />
            )}
            {selectedWidget?.type === "repeater" && selectedScreen && (
              <RepeaterSection screen={selectedScreen} widget={selectedWidget} />
            )}
            {selectedWidget && selectedScreen && (
              <RepeaterBindingSection screen={selectedScreen} widget={selectedWidget} />
            )}
          </div>
        ) : inspectorTab === "responsive" && selectedWidget && selectedScreen ? (
          <div id="inspector-responsive-panel" role="tabpanel" aria-labelledby="inspector-responsive-tab">
            <ResponsivePanel screen={selectedScreen} widget={selectedWidget} />
          </div>
        ) : inspectorTab === "interactions" && selectedWidget && selectedScreen ? (
          <div id="inspector-interactions-panel" role="tabpanel" aria-labelledby="inspector-interactions-tab">
            <InteractionBuilder project={project} screen={selectedScreen} widget={selectedWidget} />
          </div>
        ) : inspectorTab === "notes" && selectedWidget ? (
          <div id="inspector-notes-panel" role="tabpanel" aria-labelledby="inspector-notes-tab">
            <WidgetNotesPanel widget={selectedWidget} />
          </div>
        ) : null}
        <div className="inspector-rule" />
        <div className="section-label inspector-project-label"><span>PROJECT DETAILS</span></div>
        <label className="field-label" htmlFor="project-name">Project name</label>
        <input id="project-name" className="text-field" value={project.name} maxLength={120} onChange={(event) => onRename(event.currentTarget.value)} />
        <p className="field-hint">A name helps keep your ideas organized.</p>
        <div className="inspector-rule" />
        <div className="detail-row"><span>File</span><span className={`file-value ${filePath ? "" : "muted-value"}`} title={filePath ?? "Not saved yet"}>{displayPath}</span></div>
        <div className="detail-row"><span>Format</span><span className="format-chip">.pflow <span>v1</span></span></div>
        <div className="detail-row"><span>Screens</span><span>{project.screens.length}</span></div>
        <div className="detail-row"><span>Widgets</span><span>{project.screens.reduce((total, screen) => total + collectWidgetsDeep(screen.widgets).length, 0)}</span></div>
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
      </section>
      <div className="layers-dock-body" aria-label="Screens and layers">
        <ScreenLayerSidebar />
      </div>
    </aside>
  );
}

export function StatusBar() {
  const zoom = useStore((state) => state.zoom);
  const selectedCount = useStore((state) => state.selectedIds.length);
  const networkStatus = useWalletStore((state) => state.networkStatus);

  return (
    <footer className="app-statusbar">
      <span><span className="status-indicator" /> Local project</span>
      <span>{Math.round(zoom * 100)}%</span>
      <span>{selectedCount} selected</span>
      <span className="status-spacer" />
      <span className={`network-status network-status-${networkStatus}`} role="status">
        {networkStatus === "online" ? <Wifi size={12} /> : <WifiOff size={12} />}
        {networkStatus === "online"
          ? "Cloud connected"
          : networkStatus === "offline"
            ? "Sync paused — reconnect to use cloud features"
            : "Checking cloud"}
      </span>
      <span>ProtoFlow 0.1.0</span>
    </footer>
  );
}

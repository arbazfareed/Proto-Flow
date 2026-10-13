import type { Project, Widget } from "../project/schema";

export type CanvasGeometryPreview = Record<
  string,
  Partial<Pick<Widget, "x" | "y" | "width" | "height" | "rotation" | "opacity">>
>;

export interface DocumentSlice {
  project: Project;
  filePath: string | null;
  isDirty: boolean;
  lastSavedAt: number | null;
  setProject: (project: Project) => void;
  newProject: (name?: string) => void;
  renameProject: (name: string) => void;
  loadProject: (project: Project, filePath: string) => void;
  restoreProject: (project: Project, filePath: string | null) => void;
  markClean: () => void;
  markSaved: (filePath: string) => void;
}

export interface CanvasSlice {
  activeScreenId: string | null;
  activeBreakpointId: string | null;
  zoom: number;
  pan: { x: number; y: number };
  gridSize: 5 | 10 | 20;
  gridStyle: "dots" | "lines";
  gridVisible: boolean;
  snapEnabled: boolean;
  selectedIds: string[];
  geometryPreview: CanvasGeometryPreview | null;
  setZoom: (zoom: number) => void;
  setPan: (x: number, y: number) => void;
  setGridSize: (size: 5 | 10 | 20) => void;
  setGridStyle: (style: "dots" | "lines") => void;
  toggleGrid: () => void;
  toggleSnap: () => void;
  select: (ids: string[]) => void;
  clearSelection: () => void;
  setActiveScreen: (screenId: string) => void;
  setActiveBreakpoint: (breakpointId: string | null) => void;
  getActiveScreenId: () => string;
  setGeometryPreview: (preview: CanvasGeometryPreview) => void;
  clearGeometryPreview: () => void;
}

export interface HistorySlice {
  past: Project[];
  future: Project[];
  pushHistory: (snapshot: Project) => void;
  clearHistory: () => void;
  undo: () => Project | undefined;
  redo: () => Project | undefined;
  canUndo: () => boolean;
  canRedo: () => boolean;
}

export interface UISlice {
  paletteOpen: boolean;
  leftPanelOpen: boolean;
  rightPanelOpen: boolean;
  showDeviceFrame: boolean;
  showSafeArea: boolean;
  statusBarTheme: "light" | "dark";
  statusBarTimeMode: "static" | "real";
  showBattery: boolean;
  showSignal: boolean;
  setPaletteOpen: (open: boolean) => void;
  togglePalette: () => void;
  toggleLeftPanel: () => void;
  toggleRightPanel: () => void;
  toggleDeviceFrame: () => void;
  toggleSafeArea: () => void;
  setStatusBarTheme: (theme: "light" | "dark") => void;
  setStatusBarTimeMode: (mode: "static" | "real") => void;
  toggleBattery: () => void;
  toggleSignal: () => void;
}

export type StoreState = DocumentSlice & CanvasSlice & HistorySlice & UISlice;

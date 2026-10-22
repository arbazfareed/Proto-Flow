import type { StateCreator } from "zustand";
import type { CanvasSlice, StoreState } from "./types";

export const createCanvasSlice: StateCreator<StoreState, [], [], CanvasSlice> = (set, get) => ({
  activeScreenId: null,
  activeBreakpointId: null,
  zoom: 1,
  pan: { x: 0, y: 0 },
  gridSize: 10,
  gridStyle: "dots",
  gridVisible: true,
  snapEnabled: true,
  selectedIds: [],
  activePanelEdit: null,
  activeRepeaterEdit: null,
  hoveredWidgetId: null,
  hoveredCanvasWidgetId: null,
  hoveredLayerWidgetId: null,
  geometryPreview: null,
  setZoom: (zoom) =>
    set((state) => ({
      zoom: Number.isNaN(zoom) ? state.zoom : Math.min(4, Math.max(0.1, zoom)),
    })),
  setPan: (x, y) => set({ pan: { x, y } }),
  setGridSize: (gridSize) => set({ gridSize }),
  setGridStyle: (gridStyle) => set({ gridStyle }),
  toggleGrid: () => set((state) => ({ gridVisible: !state.gridVisible })),
  toggleSnap: () => set((state) => ({ snapEnabled: !state.snapEnabled })),
  select: (selectedIds) =>
    set({ selectedIds: [...new Set(selectedIds)], geometryPreview: null }),
  setActivePanelEdit: (activePanelEdit) => set({ activePanelEdit }),
  setActiveRepeaterEdit: (activeRepeaterEdit) => set({ activeRepeaterEdit }),
  clearSelection: () => set({ selectedIds: [], geometryPreview: null }),
  setCanvasHoveredWidget: (hoveredCanvasWidgetId) =>
    set((state) => ({
      hoveredCanvasWidgetId,
      hoveredWidgetId: state.hoveredLayerWidgetId ?? hoveredCanvasWidgetId,
    })),
  setLayerHoveredWidget: (hoveredLayerWidgetId) =>
    set((state) => ({
      hoveredLayerWidgetId,
      hoveredWidgetId: hoveredLayerWidgetId ?? state.hoveredCanvasWidgetId,
    })),
  setActiveScreen: (screenId) => {
    if (!get().project.screens.some((screen) => screen.id === screenId)) return;
    set({
      activeScreenId: screenId,
      activeBreakpointId: null,
      selectedIds: [],
      activePanelEdit: null,
      activeRepeaterEdit: null,
      hoveredWidgetId: null,
      hoveredCanvasWidgetId: null,
      hoveredLayerWidgetId: null,
      geometryPreview: null,
    });
  },
  setActiveBreakpoint: (activeBreakpointId) => set({ activeBreakpointId }),
  getActiveScreenId: () => {
    const state = get();
    const activeScreenId = state.activeScreenId;
    return activeScreenId &&
      state.project.screens.some((screen) => screen.id === activeScreenId)
      ? activeScreenId
      : state.project.startScreenId;
  },
  setGeometryPreview: (geometryPreview) => set({ geometryPreview }),
  clearGeometryPreview: () => set({ geometryPreview: null }),
});

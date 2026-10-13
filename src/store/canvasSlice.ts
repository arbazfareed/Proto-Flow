import type { StateCreator } from "zustand";
import type { CanvasSlice, StoreState } from "./types";

export const createCanvasSlice: StateCreator<StoreState, [], [], CanvasSlice> = (set) => ({
  zoom: 1,
  pan: { x: 0, y: 0 },
  gridSize: 10,
  gridStyle: "dots",
  gridVisible: true,
  snapEnabled: true,
  selectedIds: [],
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
  clearSelection: () => set({ selectedIds: [], geometryPreview: null }),
  setGeometryPreview: (geometryPreview) => set({ geometryPreview }),
  clearGeometryPreview: () => set({ geometryPreview: null }),
});

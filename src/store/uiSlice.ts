import type { StateCreator } from "zustand";
import type { StoreState, UISlice } from "./types";

export const createUISlice: StateCreator<StoreState, [], [], UISlice> = (set) => ({
  paletteOpen: false,
  leftPanelOpen: true,
  rightPanelOpen: true,
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  togglePalette: () => set((state) => ({ paletteOpen: !state.paletteOpen })),
  toggleLeftPanel: () => set((state) => ({ leftPanelOpen: !state.leftPanelOpen })),
  toggleRightPanel: () => set((state) => ({ rightPanelOpen: !state.rightPanelOpen })),
});

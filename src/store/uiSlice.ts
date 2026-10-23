import type { StateCreator } from "zustand";
import type { StoreState, UISlice } from "./types";

export const createUISlice: StateCreator<StoreState, [], [], UISlice> = (set) => ({
  paletteOpen: false,
  leftPanelOpen: true,
  rightPanelOpen: true,
  showDeviceFrame: true,
  showSafeArea: true,
  statusBarTheme: "dark",
  statusBarTimeMode: "static",
  showBattery: true,
  showSignal: true,
  notesOverlay: false,
  inspectorTab: "design",
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  togglePalette: () => set((state) => ({ paletteOpen: !state.paletteOpen })),
  toggleLeftPanel: () => set((state) => ({ leftPanelOpen: !state.leftPanelOpen })),
  toggleRightPanel: () => set((state) => ({ rightPanelOpen: !state.rightPanelOpen })),
  toggleDeviceFrame: () => set((state) => ({ showDeviceFrame: !state.showDeviceFrame })),
  toggleSafeArea: () => set((state) => ({ showSafeArea: !state.showSafeArea })),
  setStatusBarTheme: (statusBarTheme) => set({ statusBarTheme }),
  setStatusBarTimeMode: (statusBarTimeMode) => set({ statusBarTimeMode }),
  toggleBattery: () => set((state) => ({ showBattery: !state.showBattery })),
  toggleSignal: () => set((state) => ({ showSignal: !state.showSignal })),
  toggleNotesOverlay: () => set((state) => ({ notesOverlay: !state.notesOverlay })),
  setInspectorTab: (inspectorTab) => set({ inspectorTab }),
});

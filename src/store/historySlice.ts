import type { StateCreator } from "zustand";
import type { Project } from "../project/schema";
import type { HistorySlice, StoreState } from "./types";

export const HISTORY_LIMIT = 50;

export const createHistorySlice: StateCreator<StoreState, [], [], HistorySlice> = (
  set,
  get,
) => ({
  past: [],
  future: [],
  pushHistory: (snapshot) =>
    set((state) => ({
      past: [...state.past, snapshot].slice(-HISTORY_LIMIT),
      future: [],
    })),
  clearHistory: () => set({ past: [], future: [] }),
  undo: () => {
    let previous: Project | undefined;
    set((state) => {
      previous = state.past.at(-1);
      if (!previous) return state;
      return {
        project: { ...previous, updatedAt: new Date().toISOString() },
        past: state.past.slice(0, -1),
        future: [state.project, ...state.future].slice(0, HISTORY_LIMIT),
        isDirty: true,
      };
    });
    return previous;
  },
  redo: () => {
    let next: Project | undefined;
    set((state) => {
      next = state.future[0];
      if (!next) return state;
      return {
        project: { ...next, updatedAt: new Date().toISOString() },
        past: [...state.past, state.project].slice(-HISTORY_LIMIT),
        future: state.future.slice(1),
        isDirty: true,
      };
    });
    return next;
  },
  canUndo: () => get().past.length > 0,
  canRedo: () => get().future.length > 0,
});

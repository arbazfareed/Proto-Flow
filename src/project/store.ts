import { create } from "zustand";
import { createProject, type Project } from "./schema";

const HISTORY_LIMIT = 100;

interface ProjectState {
  project: Project;
  filePath: string | null;
  isDirty: boolean;
  lastSavedAt: number | null;
  past: Project[];
  future: Project[];
  newProject: () => void;
  renameProject: (name: string) => void;
  loadProject: (project: Project, filePath: string) => void;
  restoreProject: (project: Project, filePath: string | null) => void;
  markSaved: (filePath: string) => void;
  undo: () => void;
  redo: () => void;
}

export const useProjectStore = create<ProjectState>((set) => ({
  project: createProject(),
  filePath: null,
  isDirty: false,
  lastSavedAt: null,
  past: [],
  future: [],
  newProject: () =>
    set({
      project: createProject(),
      filePath: null,
      isDirty: true,
      past: [],
      future: [],
    }),
  renameProject: (name) =>
    set((state) => {
      const normalizedName = name.trim().slice(0, 120);
      if (!normalizedName || normalizedName === state.project.name) return state;
      return {
        project: {
          ...state.project,
          name: normalizedName,
          updatedAt: new Date().toISOString(),
        },
        past: [...state.past, state.project].slice(-HISTORY_LIMIT),
        future: [],
        isDirty: true,
      };
    }),
  loadProject: (project, filePath) =>
    set({
      project,
      filePath,
      isDirty: false,
      lastSavedAt: Date.now(),
      past: [],
      future: [],
    }),
  restoreProject: (project, filePath) =>
    set({
      project,
      filePath,
      isDirty: true,
      lastSavedAt: null,
      past: [],
      future: [],
    }),
  markSaved: (filePath) =>
    set({ filePath, isDirty: false, lastSavedAt: Date.now() }),
  undo: () =>
    set((state) => {
      const previous = state.past.at(-1);
      if (!previous) return state;
      return {
        project: { ...previous, updatedAt: new Date().toISOString() },
        past: state.past.slice(0, -1),
        future: [state.project, ...state.future],
        isDirty: true,
      };
    }),
  redo: () =>
    set((state) => {
      const next = state.future[0];
      if (!next) return state;
      return {
        project: { ...next, updatedAt: new Date().toISOString() },
        past: [...state.past, state.project].slice(-HISTORY_LIMIT),
        future: state.future.slice(1),
        isDirty: true,
      };
    }),
}));

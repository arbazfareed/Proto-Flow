import { createEmptyProject } from "../project/schema";
import type { StateCreator } from "zustand";
import type { DocumentSlice, StoreState } from "./types";

export const createDocumentSlice: StateCreator<StoreState, [], [], DocumentSlice> = (set) => ({
  project: createEmptyProject(),
  filePath: null,
  isDirty: false,
  lastSavedAt: null,
  setProject: (project) =>
    set({
      project,
      isDirty: true,
    }),
  newProject: (name) =>
    set({
      project: createEmptyProject(name),
      filePath: null,
      isDirty: false,
      lastSavedAt: null,
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
        isDirty: true,
      };
    }),
  loadProject: (project, filePath) =>
    set({
      project,
      filePath,
      isDirty: false,
      lastSavedAt: Date.now(),
    }),
  restoreProject: (project, filePath) =>
    set({
      project,
      filePath,
      isDirty: true,
      lastSavedAt: null,
    }),
  markClean: () =>
    set({
      isDirty: false,
      lastSavedAt: Date.now(),
    }),
  markSaved: (filePath) =>
    set({
      filePath,
      isDirty: false,
      lastSavedAt: Date.now(),
    }),
});

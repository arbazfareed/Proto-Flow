import { create } from "zustand";
import { devtools } from "zustand/middleware";
import { createCanvasSlice } from "./canvasSlice";
import { createDocumentSlice } from "./documentSlice";
import { createHistorySlice } from "./historySlice";
import { createUISlice } from "./uiSlice";
import type { StoreState } from "./types";

export const useStore = create<StoreState>()(
  devtools(
    (...args) => {
      const [, get] = args;
      const documentSlice = createDocumentSlice(...args);
      const historySlice = createHistorySlice(...args);

      return {
        ...documentSlice,
        ...createCanvasSlice(...args),
        ...historySlice,
        ...createUISlice(...args),
        setProject: (project) => {
          if (project !== get().project) historySlice.pushHistory(get().project);
          documentSlice.setProject(project);
        },
        newProject: (name) => {
          documentSlice.newProject(name);
          historySlice.clearHistory();
        },
        renameProject: (name) => {
          const current = get().project;
          const normalizedName = name.trim().slice(0, 120);
          if (normalizedName && normalizedName !== current.name) {
            historySlice.pushHistory(current);
          }
          documentSlice.renameProject(name);
        },
        loadProject: (project, filePath) => {
          documentSlice.loadProject(project, filePath);
          historySlice.clearHistory();
        },
        restoreProject: (project, filePath) => {
          documentSlice.restoreProject(project, filePath);
          historySlice.clearHistory();
        },
      };
    },
    {
      name: "ProtoFlow",
      enabled: import.meta.env.DEV,
    },
  ),
);

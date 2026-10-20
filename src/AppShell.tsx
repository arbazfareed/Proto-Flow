import { useCallback, useEffect, useMemo, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Check, CircleAlert } from "lucide-react";
import { clearAutosave, subscribeAutosaveErrors } from "./project/autosave";
import { openProjectFile, saveProjectFile } from "./project/files";
import { useStore } from "./store";
import { RestoreModal } from "./layout/RestoreModal";
import { UpdateToast } from "./layout/UpdateToast";
import { WalletDialog } from "./layout/WalletDialog";
import { CommandPalette } from "./layout/CommandPalette";
import { commandRegistry, createCoreCommands } from "./commands/registry";
import { handleGlobalShortcut } from "./commands/shortcuts";
import { formatProjectValidationError, SchemaValidationError } from "./project/schema";
import type { Screen } from "./project/schema";
import { createDefaultBreakpoints } from "./project/responsive";
import { DEVICE_PRESETS, toScreenDevice } from "./devices/catalog";
import { useWalletStore } from "./wallet/store";
import type { DeviceCategory } from "./devices/types";
import type { ShapeTool } from "./canvas/shapeTools";
import {
  CanvasArea,
  LeftSidebar,
  RightInspector,
  StatusBar,
  TopBar,
} from "./layout/ShellComponents";

function AppShell() {
  const paletteOpen = useStore((state) => state.paletteOpen);
  const setPaletteOpen = useStore((state) => state.setPaletteOpen);
  const togglePalette = useStore((state) => state.togglePalette);
  const toggleLeftPanel = useStore((state) => state.toggleLeftPanel);
  const toggleRightPanel = useStore((state) => state.toggleRightPanel);
  const toggleGrid = useStore((state) => state.toggleGrid);
  const toggleSnap = useStore((state) => state.toggleSnap);
  const loadProject = useStore((state) => state.loadProject);
  const renameProject = useStore((state) => state.renameProject);
  const undo = useStore((state) => state.undo);
  const redo = useStore((state) => state.redo);
  const [notice, setNotice] = useState("");
  const [noticeIsError, setNoticeIsError] = useState(false);
  const [updateCheckRequest, setUpdateCheckRequest] = useState(0);
  const [activeTool, setActiveTool] = useState<ShapeTool | null>(null);
  const [walletOpen, setWalletOpen] = useState(false);
  const initializeWallet = useWalletStore((state) => state.initialize);

  useEffect(() => {
    void initializeWallet();
  }, [initializeWallet]);

  const notify = useCallback((message: string, isError = false) => {
    setNotice(message);
    setNoticeIsError(isError);
    window.setTimeout(() => setNotice(""), 4000);
  }, []);

  useEffect(
    () => subscribeAutosaveErrors((message) => notify(message, true)),
    [notify],
  );

  const requestUpdateCheck = useCallback(() => {
    if (import.meta.env.DEV || !isTauri()) {
      notify("Update checks are available in installed desktop builds.");
      return;
    }
    setUpdateCheckRequest((requestId) => requestId + 1);
  }, [notify]);

  const save = useCallback(async (saveAs = false) => {
    const current = useStore.getState();
    try {
      const result = await saveProjectFile(
        current.project,
        saveAs ? null : current.filePath,
        saveAs,
      );
      if (!result) return;
      useStore.setState({ project: result.project });
      useStore.getState().markSaved(result.path);
      useStore.getState().markClean();
      try {
        clearAutosave();
      } catch (error) {
        console.error("Could not clear the saved autosave snapshot.", error);
      }
      notify("Project saved");
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Could not save project.",
        true,
      );
    }
  }, [notify]);

  const confirmDiscard = useCallback(() => {
    const current = useStore.getState();
    return !current.isDirty || window.confirm("You have unsaved changes. Continue without saving them?");
  }, []);

  const openFile = useCallback(async () => {
    if (!confirmDiscard()) return;
    try {
      const result = await openProjectFile();
      if (!result) return;
      loadProject(result.project, result.path);
      try {
        clearAutosave();
      } catch (error) {
        console.error("Could not clear the previous autosave snapshot.", error);
      }
      notify("Project opened");
    } catch (error) {
      notify(
        error instanceof SchemaValidationError
          ? formatProjectValidationError(error)
          : error instanceof Error
            ? error.message
            : "Could not open project.",
        true,
      );
    }
  }, [confirmDiscard, loadProject, notify]);

  const createNewProject = useCallback(() => {
    if (!confirmDiscard()) return;
    useStore.getState().newProject();
    try {
      clearAutosave();
    } catch (error) {
      console.error("Could not clear the previous autosave snapshot.", error);
    }
    notify("New project created");
  }, [confirmDiscard, notify]);

  const coreCommands = useMemo(
    () => createCoreCommands({
      newProject: createNewProject,
      openProject: openFile,
      saveProject: (saveAs) => void save(saveAs),
      undo,
      redo,
      toggleGrid,
      toggleSnap,
      checkForUpdates: requestUpdateCheck,
    }),
    [createNewProject, openFile, redo, requestUpdateCheck, save, toggleGrid, toggleSnap, undo],
  );

  useEffect(() => {
    const unregister = coreCommands.map((command) =>
      commandRegistry.register(command),
    );
    return () => unregister.reverse().forEach((remove) => remove());
  }, [coreCommands]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      handleGlobalShortcut(event, {
        paletteOpen,
        togglePalette,
        closePalette: () => setPaletteOpen(false),
        saveProject: (saveAs) => void save(saveAs),
        undo,
        redo,
        newProject: createNewProject,
        openProject: () => void openFile(),
        toggleGrid,
        toggleSnap,
      });
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    createNewProject,
    openFile,
    paletteOpen,
    redo,
    save,
    setPaletteOpen,
    toggleGrid,
    toggleSnap,
    togglePalette,
    undo,
  ]);

  const runWindowAction = (action: "minimize" | "maximize" | "close") => {
    if (!isTauri()) return;
    const window = getCurrentWindow();
    const operation =
      action === "minimize"
        ? window.minimize()
        : action === "maximize"
          ? window.toggleMaximize()
          : window.close();
    void operation.catch((error: unknown) => {
      notify(error instanceof Error ? error.message : "Could not control the app window.");
    });
  };

  const startWindowDragging = useCallback(() => {
    if (!isTauri()) return;
    void getCurrentWindow().startDragging().catch((error: unknown) => {
      notify(error instanceof Error ? error.message : "Could not move the app window.");
    });
  }, [notify]);

  const addLibraryScreen = useCallback((category: DeviceCategory) => {
    const preset = DEVICE_PRESETS.find((device) => device.category === category);
    if (!preset) {
      notify(`No ${category} device preset is available.`, true);
      return;
    }
    const device = toScreenDevice(preset);
    const screen: Screen = {
      id: crypto.randomUUID(),
      name: preset.name,
      device,
      breakpoints: createDefaultBreakpoints(device.width, device.height),
      widgets: [],
      interactionRules: [],
    };
    const current = useStore.getState();
    current.setProject({
      ...current.project,
      updatedAt: new Date().toISOString(),
      screens: [...current.project.screens, screen],
    });
    current.setActiveScreen(screen.id);
  }, [notify]);

  return (
    <div className="app-shell">
      <TopBar
        onNew={createNewProject}
        onOpen={() => void openFile()}
        onSave={() => void save()}
        onSaveAs={() => void save(true)}
        onUndo={undo}
        onRedo={redo}
        onOpenPalette={() => setPaletteOpen(true)}
        onOpenWallet={() => setWalletOpen(true)}
        onStartDragging={startWindowDragging}
        onWindowAction={runWindowAction}
      />
      <div className="workspace">
        <LeftSidebar
          onNew={createNewProject}
          onOpen={() => void openFile()}
          onToggle={toggleLeftPanel}
          onOpenPalette={() => setPaletteOpen(true)}
          onUpdates={requestUpdateCheck}
          activeTool={activeTool}
          onSelectTool={setActiveTool}
          onAddScreen={addLibraryScreen}
        />
        <CanvasArea
          onToggleLeft={toggleLeftPanel}
          onToggleRight={toggleRightPanel}
          onSaveAs={() => void save(true)}
          onOpen={() => void openFile()}
          onOpenPalette={() => setPaletteOpen(true)}
          onNotify={notify}
          activeTool={activeTool}
          setActiveTool={setActiveTool}
        />
        <RightInspector
          onToggle={toggleRightPanel}
          onUpdates={requestUpdateCheck}
          onRename={renameProject}
        />
      </div>
      <StatusBar />
      <RestoreModal />
      <UpdateToast requestId={updateCheckRequest} />
      <CommandPalette />
      {walletOpen && <WalletDialog onClose={() => setWalletOpen(false)} />}

      {notice && (
        <div className={`toast${noticeIsError ? " toast-error" : ""}`} role={noticeIsError ? "alert" : "status"}>
          {noticeIsError ? <CircleAlert size={15} /> : <Check size={15} />}
          <span>{notice}</span>
        </div>
      )}

    </div>
  );
}

export default AppShell;

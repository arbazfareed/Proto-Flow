import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  ArrowDownToLine,
  Bell,
  Check,
  FilePlus2,
  FileText,
  FolderOpen,
  Keyboard,
  Redo2,
  Search,
  Undo2,
} from "lucide-react";
import { clearAutosave } from "./project/autosave";
import { openProjectFile, saveProjectFile } from "./project/files";
import { useStore } from "./store";
import { RestoreModal } from "./layout/RestoreModal";
import { UpdateToast } from "./layout/UpdateToast";
import {
  CanvasArea,
  LeftSidebar,
  RightInspector,
  StatusBar,
  TopBar,
} from "./layout/ShellComponents";

type CommandItem = {
  label: string;
  shortcut?: string;
  icon: ReactNode;
  run: () => void | Promise<void>;
};

function AppShell() {
  const paletteOpen = useStore((state) => state.paletteOpen);
  const setPaletteOpen = useStore((state) => state.setPaletteOpen);
  const togglePalette = useStore((state) => state.togglePalette);
  const toggleLeftPanel = useStore((state) => state.toggleLeftPanel);
  const toggleRightPanel = useStore((state) => state.toggleRightPanel);
  const loadProject = useStore((state) => state.loadProject);
  const renameProject = useStore((state) => state.renameProject);
  const undo = useStore((state) => state.undo);
  const redo = useStore((state) => state.redo);
  const [notice, setNotice] = useState("");
  const [paletteQuery, setPaletteQuery] = useState("");
  const [updateCheckRequest, setUpdateCheckRequest] = useState(0);
  const paletteInput = useRef<HTMLInputElement>(null);

  const notify = useCallback((message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 4000);
  }, []);

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
      const path = await saveProjectFile(
        current.project,
        saveAs ? null : current.filePath,
        saveAs,
      );
      if (!path) return;
      useStore.getState().markSaved(path);
      useStore.getState().markClean();
      try {
        clearAutosave();
      } catch (error) {
        console.error("Could not clear the saved autosave snapshot.", error);
      }
      notify("Project saved");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not save project.");
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
      notify(error instanceof Error ? error.message : "Could not open project.");
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

  const commands = useMemo<CommandItem[]>(
    () => [
      { label: "New project", shortcut: "Ctrl N", icon: <FilePlus2 />, run: createNewProject },
      { label: "Open project", shortcut: "Ctrl O", icon: <FolderOpen />, run: openFile },
      { label: "Save project", shortcut: "Ctrl S", icon: <ArrowDownToLine />, run: () => save() },
      { label: "Save project as…", shortcut: "Ctrl Shift S", icon: <FileText />, run: () => save(true) },
      { label: "Undo", shortcut: "Ctrl Z", icon: <Undo2 />, run: undo },
      { label: "Redo", shortcut: "Ctrl Shift Z", icon: <Redo2 />, run: redo },
      {
        label: "Check for updates",
        icon: <Bell />,
        run: requestUpdateCheck,
      },
    ],
    [createNewProject, openFile, redo, requestUpdateCheck, save, undo],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const modifier = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();
      const target = event.target;
      const editing = target instanceof HTMLElement &&
        (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

      if (modifier && key === "k") {
        event.preventDefault();
        setPaletteQuery("");
        togglePalette();
        return;
      }
      if (event.key === "Escape") {
        setPaletteOpen(false);
        return;
      }
      if (!modifier) return;
      if (key === "s") {
        event.preventDefault();
        void save(event.shiftKey);
      } else if (!editing && key === "z") {
        event.preventDefault();
        event.shiftKey ? redo() : undo();
      } else if (!editing && key === "y") {
        event.preventDefault();
        redo();
      } else if (key === "n") {
        event.preventDefault();
        createNewProject();
      } else if (key === "o") {
        event.preventDefault();
        void openFile();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [createNewProject, openFile, redo, save, setPaletteOpen, togglePalette, undo]);

  useEffect(() => {
    if (paletteOpen) paletteInput.current?.focus();
  }, [paletteOpen]);

  const filteredCommands = commands.filter((command) =>
    command.label.toLowerCase().includes(paletteQuery.toLowerCase()),
  );

  const runCommand = (command: CommandItem) => {
    setPaletteOpen(false);
    void command.run();
  };

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
        onWindowAction={runWindowAction}
      />
      <div className="workspace">
        <LeftSidebar
          onNew={createNewProject}
          onOpen={() => void openFile()}
          onToggle={toggleLeftPanel}
          onOpenPalette={() => setPaletteOpen(true)}
          onUpdates={requestUpdateCheck}
        />
        <CanvasArea
          onToggleLeft={toggleLeftPanel}
          onToggleRight={toggleRightPanel}
          onSaveAs={() => void save(true)}
          onOpen={() => void openFile()}
          onOpenPalette={() => setPaletteOpen(true)}
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

      {notice && <div className="toast" role="status"><Check size={15} /><span>{notice}</span></div>}

      {paletteOpen && (
        <div className="overlay palette-overlay" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setPaletteOpen(false);
        }}>
          <section className="command-palette" aria-label="Command palette">
            <div className="palette-search"><Search size={17} /><input ref={paletteInput} value={paletteQuery} onChange={(event) => setPaletteQuery(event.currentTarget.value)} placeholder="What would you like to do?" /><kbd>ESC</kbd></div>
            <div className="palette-list">
              <span className="palette-label">ACTIONS</span>
              {filteredCommands.length ? filteredCommands.map((command) => (
                <button className="palette-item" key={command.label} onClick={() => runCommand(command)}>
                  <span className="palette-item-icon">{command.icon}</span><span>{command.label}</span>{command.shortcut && <kbd>{command.shortcut}</kbd>}
                </button>
              )) : <div className="palette-empty">No matching actions</div>}
            </div>
            <div className="palette-footer"><span><Keyboard size={13} /> Navigate with your keyboard</span><span>PROTO FLOW <b>·</b> PHASE 1</span></div>
          </section>
        </div>
      )}

    </div>
  );
}

export default AppShell;

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { currentMonitor, getCurrentWindow } from "@tauri-apps/api/window";
import { emitTo, listen } from "@tauri-apps/api/event";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { getCurrent, onOpenUrl } from "@tauri-apps/plugin-deep-link";
import { Check, CircleAlert } from "lucide-react";
import { clearAutosave, subscribeAutosaveErrors } from "./project/autosave";
import { openProjectFile, saveProjectFile } from "./project/files";
import { useStore } from "./store";
import { RestoreModal } from "./layout/RestoreModal";
import { UpdateToast } from "./layout/UpdateToast";
import { WalletDialog } from "./layout/WalletDialog";
import { CloudPreviewDialog } from "./layout/CloudPreviewDialog";
import { ReactCodeExportDialog } from "./layout/ReactCodeExportDialog";
import { CommandPalette } from "./layout/CommandPalette";
import { commandRegistry, createCoreCommands } from "./commands/registry";
import { handleGlobalShortcut } from "./commands/shortcuts";
import { formatProjectValidationError, SchemaValidationError } from "./project/schema";
import type { Screen } from "./project/schema";
import { createDefaultBreakpoints } from "./project/responsive";
import { DEVICE_PRESETS, toScreenDevice } from "./devices/catalog";
import { getPreviewWindowSize } from "./preview/windowSizing";
import { useWalletStore } from "./wallet/store";
import { checkCloudHealth } from "./wallet/api";
import { startNetworkMonitor } from "./wallet/network";
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
  const [cloudPreviewOpen, setCloudPreviewOpen] = useState(false);
  const [reactExportOpen, setReactExportOpen] = useState(false);
  const walletInitializationStarted = useRef(false);
  const previewConnected = useRef(false);
  const syncWallet = useWalletStore((state) => state.sync);
  const initializeWallet = useWalletStore((state) => state.initialize);

  const notify = useCallback((message: string, isError = false) => {
    setNotice(message);
    setNoticeIsError(isError);
    window.setTimeout(() => setNotice(""), 4000);
  }, []);

  useEffect(() => {
    if (isTauri()) {
      let disposed = false;
      let unlisten: (() => void) | undefined;
      const setup = async () => {
        const stop = await listen("preview:ready", () => {
          previewConnected.current = true;
          void emitTo("preview", "preview:project", useStore.getState().project).catch((error: unknown) => {
            previewConnected.current = false;
            console.error("Could not send the current project to preview.", error);
            notify(error instanceof Error ? error.message : "Could not sync the project to preview.", true);
          });
        });
        const stopClosed = await listen("preview:closed", () => {
          previewConnected.current = false;
        });
        if (disposed) {
          stop();
          stopClosed();
          return;
        }
        unlisten = () => {
          stop();
          stopClosed();
        };
      };
      void setup().catch((error: unknown) => {
        console.error("Could not initialize preview synchronization.", error);
        notify(error instanceof Error ? error.message : "Could not initialize preview synchronization.", true);
      });
      const unsubscribe = useStore.subscribe((state, previous) => {
        if (state.project === previous.project || !previewConnected.current) return;
        void emitTo("preview", "preview:project", state.project).catch((error: unknown) => {
          previewConnected.current = false;
          console.error("Could not hot-reload the preview project.", error);
          notify(error instanceof Error ? error.message : "Could not hot-reload preview.", true);
        });
      });
      return () => {
        disposed = true;
        unlisten?.();
        unsubscribe();
      };
    }

    const channel = new BroadcastChannel("protoflow-preview");
    channel.onmessage = (event: MessageEvent<{ type?: string }>) => {
      if (event.data?.type === "preview-ready") {
        previewConnected.current = true;
        channel.postMessage({ type: "project", project: useStore.getState().project });
      } else if (event.data?.type === "preview-closed") {
        previewConnected.current = false;
      }
    };
    const unsubscribe = useStore.subscribe((state, previous) => {
      if (state.project !== previous.project && previewConnected.current) {
        channel.postMessage({ type: "project", project: state.project });
      }
    });
    return () => {
      unsubscribe();
      channel.close();
    };
  }, [notify]);

  const processAuthCallback = useCallback(async (value: string) => {
    let callback: URL;
    try {
      callback = new URL(value);
    } catch {
      return;
    }

    const isDesktopCallback =
      callback.protocol === "protoflow:" &&
      callback.hostname === "auth" &&
      (callback.pathname === "/verify" || callback.pathname === "/google-callback");
    const isBrowserCallback =
      !isTauri() &&
      callback.origin === window.location.origin &&
      callback.pathname === window.location.pathname;
    if (!isDesktopCallback && !isBrowserCallback) return;

    const magicToken = callback.pathname === "/verify" ? callback.searchParams.get("token") : null;
    const googleTicket =
      callback.pathname === "/google-callback" ? callback.searchParams.get("ticket") : null;
    if (!magicToken && !googleTicket) return;

    if (isBrowserCallback) {
      window.history.replaceState({}, document.title, callback.pathname);
    }
    try {
      await useWalletStore.getState().sync();
      if (magicToken) {
        await useWalletStore.getState().verifyEmailSignIn(magicToken);
      } else if (googleTicket) {
        await useWalletStore.getState().verifyGoogleSignIn(googleTicket);
      }
      notify(`Wallet linked to ${useWalletStore.getState().email}.`);
    } catch (callbackError) {
      notify(
        callbackError instanceof Error ? callbackError.message : "Could not complete sign-in.",
        true,
      );
    }
  }, [notify]);

  useEffect(() => {
    if (!isTauri()) {
      void processAuthCallback(window.location.href);
      return;
    }

    let disposed = false;
    let stopDeepLink: (() => void) | undefined;
    const setup = async () => {
      stopDeepLink = await onOpenUrl((urls) => {
        for (const url of urls) void processAuthCallback(url);
      });
      if (disposed) {
        stopDeepLink();
        return;
      }
      const initialUrls = await getCurrent();
      for (const url of initialUrls ?? []) void processAuthCallback(url);
    };
    void setup().catch((callbackError) => {
      notify(
        callbackError instanceof Error ? callbackError.message : "Could not initialize sign-in callbacks.",
        true,
      );
    });
    return () => {
      disposed = true;
      stopDeepLink?.();
    };
  }, [notify, processAuthCallback]);

  useEffect(() => {
    if (!walletInitializationStarted.current) {
      walletInitializationStarted.current = true;
      void initializeWallet().then((granted) => {
        if (granted > 0) notify(`Daily refill: +${granted} credits`);
      });
    }

    const syncWhenVisible = () => {
      if (!document.hidden) void syncWallet();
    };
    const interval = window.setInterval(syncWhenVisible, 60_000);
    document.addEventListener("visibilitychange", syncWhenVisible);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", syncWhenVisible);
    };
  }, [initializeWallet, notify, syncWallet, walletInitializationStarted]);

  useEffect(
    () => subscribeAutosaveErrors((message) => notify(message, true)),
    [notify],
  );

  useEffect(
    () =>
      startNetworkMonitor(
        checkCloudHealth,
        (networkStatus) => useWalletStore.setState({ networkStatus }),
        () => void syncWallet(),
      ),
    [syncWallet],
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

  const openPreview = useCallback(async () => {
    const state = useStore.getState();
    const screen = state.project.screens.find((item) => item.id === state.getActiveScreenId());
    const width = screen?.device?.width ?? 1280;
    const height = screen?.device?.height ?? 800;
    try {
      if (!isTauri()) {
        const previewUrl = new URL(window.location.href);
        previewUrl.searchParams.set("preview", "1");
        const preview = window.open(
          previewUrl.toString(),
          "protoflow-preview",
          `popup=yes,width=${Math.max(360, width)},height=${Math.max(320, height + 72)}`,
        );
        if (!preview) throw new Error("The preview window was blocked by the browser.");
        previewConnected.current = true;
        return;
      }

      const existing = await WebviewWindow.getByLabel("preview");
      if (existing) {
        await existing.show();
        await existing.setFocus();
        await emitTo("preview", "preview:project", state.project);
        previewConnected.current = true;
        return;
      }

      const monitor = await currentMonitor();
      const previewSize = getPreviewWindowSize({ width, height }, monitor);
      const preview = new WebviewWindow("preview", {
        url: "/?preview=1",
        title: "ProtoFlow Preview",
        width: previewSize.width,
        height: previewSize.height,
        minWidth: Math.min(360, previewSize.width),
        minHeight: Math.min(320, previewSize.height),
        resizable: true,
        center: true,
      });
      await new Promise<void>((resolve, reject) => {
        void preview.once("tauri://created", () => resolve()).catch(reject);
        void preview.once<{ message?: string }>("tauri://error", (event) => {
          reject(new Error(event.payload.message ?? "Could not create the preview window."));
        }).catch(reject);
      });
      previewConnected.current = true;
    } catch (error) {
      console.error("Could not open the preview window.", error);
      notify(error instanceof Error ? error.message : "Could not open preview.", true);
    }
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
        onOpenPreview={() => void openPreview()}
        onPublishCloudPreview={() => setCloudPreviewOpen(true)}
        onExportReactCode={() => setReactExportOpen(true)}
        onOpenWallet={() => setWalletOpen(true)}
        onNotify={notify}
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
      {cloudPreviewOpen && <CloudPreviewDialog onClose={() => setCloudPreviewOpen(false)} />}
      {reactExportOpen && <ReactCodeExportDialog onClose={() => setReactExportOpen(false)} />}

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

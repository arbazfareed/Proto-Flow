import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { currentMonitor, getCurrentWindow } from "@tauri-apps/api/window";
import { LogicalSize } from "@tauri-apps/api/dpi";
import { emitTo, listen } from "@tauri-apps/api/event";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import { getCurrent, onOpenUrl } from "@tauri-apps/plugin-deep-link";
import { Check, CircleAlert } from "lucide-react";
import { BETA_FEEDBACK_URL } from "./beta/feedback";
import { PrivacySettingsDialog } from "./diagnostics/PrivacySettingsDialog";
import { readPrivacySettings } from "./diagnostics/privacy";
import { OnboardingWizard } from "./onboarding/OnboardingWizard";
import {
  applyThemePreference,
  DEFAULT_ONBOARDING_STATE,
  readOnboardingState,
  readThemePreference,
  writeOnboardingState,
  writeThemePreference,
} from "./onboarding/storage";
import type { OnboardingState, ThemePreference } from "./onboarding/storage";
import { createStarterProject, type StarterTemplateId } from "./onboarding/templates";
import {
  categorizeTelemetryError,
  recordDiagnostic,
  startObservability,
  trackEvent,
} from "./diagnostics/observability";
import { AUTOSAVE_KEY, clearAutosave, subscribeAutosaveErrors } from "./project/autosave";
import { openProjectFile, saveProjectFile } from "./project/files";
import { useStore } from "./store";
import { RestoreModal } from "./layout/RestoreModal";
import { UpdateToast } from "./layout/UpdateToast";
import { WalletDialog } from "./layout/WalletDialog";
import { CloudPreviewDialog } from "./layout/CloudPreviewDialog";
import { ReactCodeExportDialog } from "./layout/ReactCodeExportDialog";
import { ImportCodeDialog, type ImportedCode } from "./layout/ImportCodeDialog";
import { findRequiredIcons, importHtmlToWidgets } from "./project/htmlImport";
import {
  getImportedHtmlGeometryUpdates,
  updateImportedHtmlGeometry,
} from "./project/importedCodeSync";
import { getImportedElementTools } from "./project/importedElementTools";
import { HtmlExportDialog } from "./layout/HtmlExportDialog";
import { PluginManagerDialog } from "./layout/PluginManagerDialog";
import { CollaborationDialog } from "./layout/CollaborationDialog";
import { CommandPalette } from "./layout/CommandPalette";
import { VersionHistoryDialog } from "./layout/VersionHistoryDialog";
import { commandRegistry, createCoreCommands } from "./commands/registry";
import { handleGlobalShortcut } from "./commands/shortcuts";
import { formatProjectValidationError, SchemaValidationError } from "./project/schema";
import type { Screen, Widget } from "./project/schema";
import {
  createDefaultBreakpoints,
  expandBreakpointsForWidgets,
  getScreenBreakpoints,
} from "./project/responsive";
import { inferScreenInputMode } from "./project/inputModes";
import { DEFAULT_DEVICE_PRESET, DEVICE_PRESETS, toScreenDevice } from "./devices/catalog";
import { fitWindowSizeToMonitor, getPreviewWindowSize } from "./preview/windowSizing";
import { useWalletStore } from "./wallet/store";
import { createProjectCheckpoint, startVersionHistoryAutosave } from "./project/versionHistory";
import { checkCloudHealth } from "./wallet/api";
import { startNetworkMonitor } from "./wallet/network";
import { createTutorialProjectCopy } from "./tutorial/project";
import { TutorialGuide } from "./tutorial/TutorialGuide";
import { emitTutorialAction } from "./tutorial/events";
import { TUTORIAL_UI_STRINGS } from "./tutorial/content";
import { HelpPanel } from "./help/HelpPanel";
import { HELP_NAVIGATION_EVENT } from "./help/navigation";
import { getHelpArticle, parseHelpDeepLink } from "./help/docs";
import type { DeviceCategory } from "./devices/types";
import { getShapeToolDefinition, type ShapeTool } from "./canvas/shapeTools";
import {
  isTextStyleWidget,
  parseStyleColor,
  styleColorToRgba,
} from "./canvas/styleInspector";
import {
  EMPTY_IMPORTED_DESIGN_TOKENS,
  type ImportedColorToken,
  type ImportedDesignTokens,
  type ImportedTextStyleToken,
} from "./project/importedDesignTokens";
import { createInteractionRule } from "./project/interactions";
import type { ImportedDomInteractionBinding } from "./project/importedDomInspector";
import type { ImportedJsListenerSuggestion } from "./project/importedJsEvents";
import {
  CanvasArea,
  LeftSidebar,
  RightInspector,
  StatusBar,
  TopBar,
} from "./layout/ShellComponents";

function AppShell() {
  const paletteOpen = useStore((state) => state.paletteOpen);
  const currentProject = useStore((state) => state.project);
  const currentFilePath = useStore((state) => state.filePath);
  const projectIsDirty = useStore((state) => state.isDirty);
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
  const noticeTimeoutRef = useRef<number | null>(null);
  const [updateCheckRequest, setUpdateCheckRequest] = useState(0);
  const [activeTool, setActiveTool] = useState<ShapeTool | null>(null);
  const [unlockedElementTools, setUnlockedElementTools] = useState<ShapeTool[]>([]);
  const [walletOpen, setWalletOpen] = useState(false);
  const [cloudPreviewOpen, setCloudPreviewOpen] = useState(false);
  const [reactExportOpen, setReactExportOpen] = useState(false);
  const [htmlExportOpen, setHtmlExportOpen] = useState(false);
  const [importCodeOpen, setImportCodeOpen] = useState(false);
  const [importCodeDraft, setImportCodeDraft] = useState<ImportedCode | null>(null);
  const [importCodeGroup, setImportCodeGroup] = useState<{ id: string; screenId: string } | null>(null);
  const syncingImportedCodeRef = useRef(false);
  const [importedDesignTokens, setImportedDesignTokens] = useState<ImportedDesignTokens>(
    EMPTY_IMPORTED_DESIGN_TOKENS,
  );
  const [pluginManagerOpen, setPluginManagerOpen] = useState(false);
  const [collaborationMounted, setCollaborationMounted] = useState(false);
  const [collaborationOpen, setCollaborationOpen] = useState(false);
  const [collaborationInviteId, setCollaborationInviteId] = useState<string | null>(null);
  const [versionHistoryOpen, setVersionHistoryOpen] = useState(false);
  const [privacyDialogOpen, setPrivacyDialogOpen] = useState(false);
  const [privacyFirstLaunch, setPrivacyFirstLaunch] = useState(false);
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [onboardingState, setOnboardingState] = useState<OnboardingState>(DEFAULT_ONBOARDING_STATE);
  const [onboardingTheme, setOnboardingTheme] = useState<ThemePreference>("system");
  const [onboardingTipVisible, setOnboardingTipVisible] = useState(false);
  const [tutorialOpen, setTutorialOpen] = useState(false);
  const [tutorialSession, setTutorialSession] = useState(0);
  const [helpOpen, setHelpOpen] = useState(false);
  const [helpArticleSlug, setHelpArticleSlug] = useState<string | undefined>();
  const walletInitializationStarted = useRef(false);
  const previewConnected = useRef(false);
  const openPreviewShortcut = useRef<(() => Promise<void>) | null>(null);
  const tutorialReturnState = useRef<ReturnType<typeof useStore.getState> | null>(null);
  const tutorialAutosave = useRef<string | null>(null);
  const syncWallet = useWalletStore((state) => state.sync);
  const initializeWallet = useWalletStore((state) => state.initialize);

  useEffect(() => {
    setImportedDesignTokens(EMPTY_IMPORTED_DESIGN_TOKENS);
  }, [currentProject.id]);

  useEffect(() => {
    if (!importCodeGroup) return;
    return useStore.subscribe((state, previous) => {
      if (syncingImportedCodeRef.current || state.project === previous.project) return;
      const screen = state.project.screens.find((item) => item.id === importCodeGroup.screenId);
      const previousScreen = previous.project.screens.find((item) =>
        item.id === importCodeGroup.screenId,
      );
      if (!screen || !previousScreen) return;
      const geometryUpdates = getImportedHtmlGeometryUpdates(
        previousScreen,
        screen,
        importCodeGroup.id,
        state.activeBreakpointId,
      );
      if (geometryUpdates.length === 0) return;
      setImportCodeDraft((draft) => draft
        ? { ...draft, html: updateImportedHtmlGeometry(draft.html, geometryUpdates) }
        : draft);
    });
  }, [importCodeGroup]);

  const notify = useCallback((message: string, isError = false) => {
    if (noticeTimeoutRef.current !== null) {
      window.clearTimeout(noticeTimeoutRef.current);
    }
    setNotice(message);
    setNoticeIsError(isError);
    if (isError) trackEvent("error_shown", { category: categorizeTelemetryError(message) });
    noticeTimeoutRef.current = window.setTimeout(() => {
      setNotice("");
      noticeTimeoutRef.current = null;
    }, 4000);
  }, []);

  useEffect(() => () => {
    if (noticeTimeoutRef.current !== null) window.clearTimeout(noticeTimeoutRef.current);
  }, []);

  const openBetaFeedback = useCallback(async () => {
    try {
      if (isTauri()) {
        await openExternal(BETA_FEEDBACK_URL);
      } else {
        const link = document.createElement("a");
        link.href = BETA_FEEDBACK_URL;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.referrerPolicy = "no-referrer";
        link.click();
      }
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not open the beta feedback form.", true);
    }
  }, [notify]);

  useEffect(() => {
    let active = true;
    void startObservability().then(() => {
      if (!active) return;
      const savedOnboarding = readOnboardingState();
      const theme = readThemePreference();
      applyThemePreference(theme);
      const settings = readPrivacySettings();
      setOnboardingState(savedOnboarding);
      setOnboardingTheme(theme);
      setOnboardingOpen(!savedOnboarding.hasCompletedOnboarding && settings !== null);
      setPrivacyFirstLaunch(settings === null);
      setPrivacyDialogOpen(settings === null);
    }).catch((error: unknown) => {
      recordDiagnostic("error", "First-run preferences initialization failed.");
      notify(error instanceof Error ? error.message : "First-run preferences could not be loaded.", true);
      if (active) {
        setPrivacyFirstLaunch(true);
        setOnboardingOpen(true);
      }
    });
    return () => {
      active = false;
    };
  }, [notify]);

  useEffect(() => {
    const preference = onboardingTheme;
    if (preference !== "system") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const updateSystemTheme = () => applyThemePreference("system");
    media.addEventListener("change", updateSystemTheme);
    return () => media.removeEventListener("change", updateSystemTheme);
  }, [onboardingTheme]);

  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    const fitToMonitor = async () => {
      const monitor = await currentMonitor();
      if (!monitor || disposed) return;
      const nextSize = fitWindowSizeToMonitor(
        { width: window.innerWidth, height: window.innerHeight },
        monitor,
      );
      if (nextSize.width === window.innerWidth && nextSize.height === window.innerHeight) return;
      await getCurrentWindow().setSize(new LogicalSize(nextSize.width, nextSize.height));
    };
    void fitToMonitor().catch((error: unknown) => {
      console.error("Could not fit the main window to the current display.", error);
      notify(error instanceof Error ? error.message : "Could not fit ProtoFlow on this display.", true);
    });
    return () => {
      disposed = true;
    };
  }, [notify]);

  const openCollaboration = useCallback(() => {
    setCollaborationMounted(true);
    setCollaborationOpen(true);
  }, []);
  const closeCollaboration = useCallback(() => setCollaborationOpen(false), []);
  const setActiveCollaboration = useCallback((sessionId: string | null) => {
    setCollaborationInviteId(sessionId);
    if (!sessionId) setCollaborationMounted(false);
  }, []);

  useEffect(() => {
    const sessionId = new URLSearchParams(window.location.search).get("collab");
    if (!sessionId || !/^[A-Za-z0-9_-]{24}$/.test(sessionId)) return;
    setCollaborationInviteId(sessionId);
    setCollaborationMounted(true);
    setCollaborationOpen(true);
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

    const collaborationMatch =
      callback.protocol === "protoflow:" &&
      callback.hostname === "collaboration" &&
      /^\/[A-Za-z0-9_-]{24}$/.test(callback.pathname);
    if (collaborationMatch) {
      const sessionId = callback.pathname.slice(1);
      setCollaborationInviteId(sessionId);
      setCollaborationMounted(true);
      setCollaborationOpen(true);
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
        trackEvent("signin_completed", { provider: "email" });
      } else if (googleTicket) {
        await useWalletStore.getState().verifyGoogleSignIn(googleTicket);
        trackEvent("signin_completed", { provider: "google" });
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
    const openHelpFromContext = (event: Event) => {
      const slug = (event as CustomEvent<{ slug?: string }>).detail?.slug;
      if (slug && !getHelpArticle(slug)) {
        notify(`The help article "${slug}" was not found.`, true);
        return;
      }
      if (slug) setHelpArticleSlug(slug);
      setHelpOpen(true);
    };
    window.addEventListener(HELP_NAVIGATION_EVENT, openHelpFromContext);
    return () => window.removeEventListener(HELP_NAVIGATION_EVENT, openHelpFromContext);
  }, [notify]);

  useEffect(() => {
    if (!isTauri()) {
      const slug = parseHelpDeepLink(window.location.href);
      if (slug) {
        if (getHelpArticle(slug)) {
          setHelpArticleSlug(slug);
          setHelpOpen(true);
        } else {
          notify(`The help article "${slug}" was not found.`, true);
        }
      }
      void processAuthCallback(window.location.href);
      return;
    }

    let disposed = false;
    let stopDeepLink: (() => void) | undefined;
    const handleUrl = (url: string) => {
      const slug = parseHelpDeepLink(url);
      if (slug) {
        if (getHelpArticle(slug)) {
          setHelpArticleSlug(slug);
          setHelpOpen(true);
        } else {
          notify(`The help article "${slug}" was not found.`, true);
        }
        return;
      }
      void processAuthCallback(url);
    };
    const setup = async () => {
      stopDeepLink = await onOpenUrl((urls) => {
        for (const url of urls) handleUrl(url);
      });
      if (disposed) {
        stopDeepLink();
        return;
      }
      const initialUrls = await getCurrent();
      for (const url of initialUrls ?? []) handleUrl(url);
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
    () => startVersionHistoryAutosave(
      () => useStore.getState(),
      (error) => {
        console.error("Could not create an automatic project checkpoint.", error);
        notify(error instanceof Error ? error.message : "Could not create an automatic checkpoint.", true);
      },
    ),
    [notify],
  );

  const createManualCheckpoint = useCallback(async () => {
    const current = useStore.getState();
    try {
      await createProjectCheckpoint(current.project, current.filePath, "Manual checkpoint", "manual", true);
      notify("Manual checkpoint created");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not create a checkpoint.", true);
    }
  }, [notify]);

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
      trackEvent("project_saved");
      try {
        clearAutosave();
      } catch (error) {
        console.error("Could not clear the saved autosave snapshot.", error);
      }
      notify(isTauri() ? "Project saved" : `Project downloaded as ${result.path}`);
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

  const openFile = useCallback(async (): Promise<boolean> => {
    if (!confirmDiscard()) return false;
    try {
      const result = await openProjectFile();
      if (!result) return false;
      loadProject(result.project, result.path);
      trackEvent("project_opened");
      try {
        clearAutosave();
      } catch (error) {
        console.error("Could not clear the previous autosave snapshot.", error);
      }
      notify("Project opened");
      return true;
    } catch (error) {
      notify(
        error instanceof SchemaValidationError
          ? formatProjectValidationError(error)
          : error instanceof Error
            ? error.message
            : "Could not open project.",
        true,
      );
      return false;
    }
  }, [confirmDiscard, loadProject, notify]);

  const createNewProject = useCallback(() => {
    if (!confirmDiscard()) return;
    useStore.getState().newProject();
    trackEvent("project_created");
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
      openProject: () => { void openFile(); },
      saveProject: (saveAs) => void save(saveAs),
      undo,
      redo,
      toggleGrid,
      toggleSnap,
      checkForUpdates: requestUpdateCheck,
      openPlugins: () => setPluginManagerOpen(true),
      openVersionHistory: () => setVersionHistoryOpen(true),
      createCheckpoint: () => void createManualCheckpoint(),
      openHelp: () => setHelpOpen(true),
    }),
    [createManualCheckpoint, createNewProject, openFile, redo, requestUpdateCheck, save, toggleGrid, toggleSnap, undo],
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
        createCheckpoint: () => void createManualCheckpoint(),
        undo,
        redo,
        newProject: createNewProject,
        openProject: () => void openFile(),
        toggleGrid,
        toggleSnap,
        openPreview: () => { void openPreviewShortcut.current?.(); },
        openHelp: () => setHelpOpen(true),
      });
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    createNewProject,
    createManualCheckpoint,
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
        emitTutorialAction("preview-opened");
        return;
      }

      const existing = await WebviewWindow.getByLabel("preview");
      if (existing) {
        await existing.show();
        await existing.setFocus();
        await emitTo("preview", "preview:project", state.project);
        previewConnected.current = true;
        emitTutorialAction("preview-opened");
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
      emitTutorialAction("preview-opened");
    } catch (error) {
      console.error("Could not open the preview window.", error);
      notify(error instanceof Error ? error.message : "Could not open preview.", true);
    }
  }, [notify]);
  openPreviewShortcut.current = openPreview;

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
      inputMode: inferScreenInputMode(device),
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

  const updateOnboardingState = useCallback((update: Partial<OnboardingState>) => {
    const next = { ...onboardingState, ...update };
    try {
      writeOnboardingState(next);
      setOnboardingState(next);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Onboarding preferences could not be saved.", true);
    }
  }, [notify, onboardingState]);

  const chooseOnboardingTheme = useCallback((theme: ThemePreference) => {
    try {
      writeThemePreference(theme);
      const next = { ...onboardingState, theme };
      writeOnboardingState(next);
      setOnboardingState(next);
      setOnboardingTheme(theme);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Theme preference could not be saved.", true);
    }
  }, [notify, onboardingState]);

  const completeOnboarding = useCallback((template: StarterTemplateId | "existing") => {
    try {
      if (template !== "existing") {
        useStore.getState().loadProject(createStarterProject(template), null);
        trackEvent("project_created");
      }
      const next = {
        ...onboardingState,
        hasCompletedOnboarding: true,
        selectedTemplate: template,
        deviceTourCompleted: onboardingState.deviceTourCompleted,
      };
      writeOnboardingState(next);
      setOnboardingState(next);
      setOnboardingOpen(false);
      trackEvent("onboarding_completed");
      if (privacyFirstLaunch) setPrivacyDialogOpen(true);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Onboarding could not be completed.", true);
    }
  }, [notify, onboardingState, privacyFirstLaunch]);

  const skipOnboarding = useCallback(() => {
    try {
      const showTip = !onboardingState.skipTipShown;
      const next = {
        ...onboardingState,
        hasCompletedOnboarding: true,
        skipTipShown: true,
      };
      writeOnboardingState(next);
      setOnboardingState(next);
      setOnboardingOpen(false);
      setOnboardingTipVisible(showTip);
      trackEvent("onboarding_skipped");
      if (privacyFirstLaunch) setPrivacyDialogOpen(true);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Onboarding could not be skipped.", true);
    }
  }, [notify, onboardingState, privacyFirstLaunch]);

  const showOnboardingAgain = useCallback(() => {
    try {
      const next = { ...onboardingState, hasCompletedOnboarding: false };
      writeOnboardingState(next);
      setOnboardingState(next);
      setPrivacyDialogOpen(false);
      setOnboardingTipVisible(false);
      setOnboardingOpen(true);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Onboarding could not be restarted.", true);
    }
  }, [notify, onboardingState]);

  const openTutorialProject = useCallback(async () => {
    if (tutorialOpen && !window.confirm(TUTORIAL_UI_STRINGS.restartConfirmation)) {
      return;
    }

    let returnState = tutorialReturnState.current;
    let autosaveSnapshot = tutorialAutosave.current;
    if (!tutorialOpen) {
      returnState = useStore.getState();
      if (returnState.isDirty &&
        !window.confirm(TUTORIAL_UI_STRINGS.preserveProjectConfirmation)) {
        return;
      }
      try {
        autosaveSnapshot = localStorage.getItem(AUTOSAVE_KEY);
      } catch (error) {
        notify(error instanceof Error ? error.message : "The current recovery snapshot could not be preserved.", true);
        return;
      }
    }

    try {
      const tutorialProject = createTutorialProjectCopy();
      await createProjectCheckpoint(tutorialProject, null, "Tutorial start", "manual", true);
      if (!tutorialOpen) {
        tutorialReturnState.current = returnState;
        tutorialAutosave.current = autosaveSnapshot;
      }
      useStore.getState().loadProject(tutorialProject, null);
      useStore.getState().setActiveScreen(tutorialProject.startScreenId);
      useStore.getState().setActiveBreakpoint("mobile");
      setTutorialOpen(true);
      setTutorialSession((current) => current + 1);
      trackEvent("tutorial_started");
    } catch (error) {
      notify(error instanceof Error ? error.message : "The tutorial project could not be opened.", true);
    }
  }, [notify, tutorialOpen]);

  const closeTutorial = useCallback(() => {
    const previousState = tutorialReturnState.current;
    tutorialReturnState.current = null;
    setTutorialOpen(false);
    if (previousState) useStore.setState(previousState, true);
    try {
      const snapshot = tutorialAutosave.current;
      if (snapshot === null) localStorage.removeItem(AUTOSAVE_KEY);
      else localStorage.setItem(AUTOSAVE_KEY, snapshot);
    } catch (error) {
      notify(error instanceof Error ? error.message : "The previous recovery snapshot could not be restored.", true);
    } finally {
      tutorialAutosave.current = null;
    }
  }, [notify]);

  const takeTutorialFromOnboarding = useCallback(() => {
    const selected = onboardingState.selectedTemplate;
    const template: StarterTemplateId = selected && selected !== "existing"
      ? selected as StarterTemplateId
      : "blank";
    completeOnboarding(template);
    void openTutorialProject();
  }, [completeOnboarding, onboardingState.selectedTemplate, openTutorialProject]);

  const renderImportedCode = useCallback((
    { html, css }: Pick<ImportedCode, "html" | "css">,
    tokens: ImportedDesignTokens,
    interactionBinding: ImportedDomInteractionBinding | null,
    javascriptListeners: ImportedJsListenerSuggestion[],
    sourceCode: ImportedCode,
  ) => {
    const state = useStore.getState();
    const screenId = state.getActiveScreenId();
    const screen = state.project.screens.find((item) => item.id === screenId);
    if (!screen) throw new Error("Select a screen before rendering imported code.");

    const groupId = importCodeGroup?.screenId === screenId
      ? importCodeGroup.id
      : crypto.randomUUID();
    const previousImportedWidgets = screen.widgets.filter(
      (widget) => widget.props.importedCodeId === groupId,
    );
    const firstZIndex = previousImportedWidgets.length > 0
      ? Math.min(...previousImportedWidgets.map((widget) => widget.zIndex))
      : screen.widgets.reduce((highest, widget) => Math.max(highest, widget.zIndex), -1) + 1;
    const parsedWidgets = importHtmlToWidgets(
      html,
      css,
      screen.device?.width ?? DEFAULT_DEVICE_PRESET.viewport.width,
      firstZIndex,
      getScreenBreakpoints(screen),
    );
    const previousByNodeId = new Map(previousImportedWidgets.flatMap((widget) =>
      typeof widget.props.importedNodeId === "string"
        ? [[widget.props.importedNodeId, widget] as const]
        : [],
    ));
    const mappedIds = new Map(parsedWidgets.map((widget) => [
      widget.id,
      previousByNodeId.get(String(widget.props.importedNodeId))?.id ?? widget.id,
    ]));
    const importedWidgets: Widget[] = parsedWidgets.map((widget) => {
      const existing = previousByNodeId.get(String(widget.props.importedNodeId));
      return {
        ...widget,
        id: existing?.id ?? widget.id,
        groupId: widget.groupId ? mappedIds.get(widget.groupId) ?? widget.groupId : undefined,
        props: { ...widget.props, importedCodeId: groupId },
      };
    });
    const importedRules: ReturnType<typeof createInteractionRule>[] = [];
    if (interactionBinding) {
      const widget = importedWidgets.find(
        (candidate) => candidate.props.importedNodeId === interactionBinding.nodeId,
      );
      if (!widget) throw new Error("The inspected DOM element could not be matched to an imported canvas element.");
      if (!state.project.screens.some((item) =>
        item.id === interactionBinding.targetScreenId && item.id !== screenId,
      )) throw new Error("Choose an existing destination screen for the imported interaction.");
      const rule = createInteractionRule(widget);
      rule.importedCodeId = groupId;
      rule.importedNodeId = interactionBinding.nodeId;
      rule.actions[0] = {
        type: "navigate",
        target: interactionBinding.targetScreenId,
      };
      importedRules.push(rule);
    }
    for (const listener of javascriptListeners) {
      const widget = importedWidgets.find(
        (candidate) => candidate.props.importedNodeId === listener.nodeId,
      );
      if (!widget) {
        throw new Error(`JavaScript listener target ${listener.selector} could not be matched to an imported canvas element.`);
      }
      if (listener.textValue === undefined) {
        throw new Error(`JavaScript listener on ${listener.selector} has no supported text update to convert.`);
      }
      const rule = createInteractionRule(widget);
      rule.importedCodeId = groupId;
      rule.importedNodeId = listener.nodeId;
      rule.event = listener.protoFlowEvent;
      rule.actions[0] = {
        type: "setWidgetText",
        target: widget.id,
        value: listener.textValue,
      };
      importedRules.push(rule);
    }
    const importedElementTools = getImportedElementTools(findRequiredIcons(html).requiredIcons);
    const newlyUnlockedTools = importedElementTools.filter(
      (tool) => !unlockedElementTools.includes(tool),
    );
    if (newlyUnlockedTools.length > 0) {
      setUnlockedElementTools((current) => [...current, ...newlyUnlockedTools]);
    }
    const screenWidgets = [
      ...screen.widgets.filter((widget) => widget.props.importedCodeId !== groupId),
      ...importedWidgets,
    ];
    const importedWidgetIds = new Set(importedWidgets.map((widget) => widget.id));
    const previousImportedWidgetIds = new Set(previousImportedWidgets.map((widget) => widget.id));
    const interactionRules = [
      ...screen.interactionRules.filter((rule) =>
        rule.importedCodeId !== groupId &&
        (!rule.widgetId || !previousImportedWidgetIds.has(rule.widgetId) ||
          importedWidgetIds.has(rule.widgetId)),
      ),
      ...importedRules,
    ];
    const breakpoints = expandBreakpointsForWidgets(
      getScreenBreakpoints(screen),
      screenWidgets,
    );
    if (state.activePanelEdit) state.setActivePanelEdit(null);
    if (state.activeRepeaterEdit) state.setActiveRepeaterEdit(null);
    syncingImportedCodeRef.current = true;
    try {
      state.setProject({
        ...state.project,
        updatedAt: new Date().toISOString(),
        screens: state.project.screens.map((item) =>
          item.id === screenId
            ? {
                ...item,
                breakpoints,
                widgets: screenWidgets,
                interactionRules,
              }
            : item,
        ),
      });
    } finally {
      syncingImportedCodeRef.current = false;
    }
    setImportCodeGroup({ id: groupId, screenId });
    setImportCodeDraft(sourceCode);
    state.select(importedWidgets.map((widget) => widget.id));
    setImportedDesignTokens(tokens);
    const bindingMessage = interactionBinding
      ? (() => {
          const destination = state.project.screens.find((item) =>
            item.id === interactionBinding.targetScreenId,
          );
          return `Bound ${interactionBinding.nodeId} onClick to navigate to ${destination?.name ?? "the selected screen"}.`;
        })()
      : "";
    const javascriptMessage = javascriptListeners.length > 0
        ? `Converted ${javascriptListeners.length} JavaScript event ${javascriptListeners.length === 1 ? "listener" : "listeners"} into ProtoFlow rules.`
        : "";
    if (newlyUnlockedTools.includes("date-picker")) {
        notify([
          bindingMessage,
          javascriptMessage,
          "Unlocked Calendar element from imported code.",
        ].filter(Boolean).join(" "));
    } else if (newlyUnlockedTools.length > 0) {
      const labels = newlyUnlockedTools.map(
        (tool) => getShapeToolDefinition(tool)?.label ?? tool,
      );
      notify([
        bindingMessage,
        javascriptMessage,
        `Unlocked ${labels.join(", ")} ${labels.length === 1 ? "element" : "elements"} from imported code.`,
      ].filter(Boolean).join(" "));
    } else if (interactionBinding || javascriptListeners.length > 0) {
      notify([bindingMessage, javascriptMessage].filter(Boolean).join(" "));
    } else {
      notify(`Rendered ${importedWidgets.length} elements on the canvas.`);
    }
  }, [importCodeGroup, notify, unlockedElementTools]);

  const openImportCode = useCallback(() => {
    const screenId = useStore.getState().getActiveScreenId();
    if (importCodeGroup && importCodeGroup.screenId !== screenId) {
      setImportCodeGroup(null);
      setImportCodeDraft(null);
    }
    setImportCodeOpen(true);
  }, [importCodeGroup]);

  const applyImportedColor = useCallback((
    token: ImportedColorToken,
    usage: "background" | "text" | "border",
  ) => {
    const state = useStore.getState();
    const screenId = state.getActiveScreenId();
    const screen = state.project.screens.find((item) => item.id === screenId);
    if (!screen) {
      notify("Select a screen before applying an imported token.", true);
      return;
    }
    const selectedIds = new Set(state.selectedIds);
    const selectedWidgets = screen.widgets.filter((widget) => selectedIds.has(widget.id) && !widget.locked);
    if (selectedWidgets.length === 0) {
      notify("Select an unlocked canvas element before applying an imported token.", true);
      return;
    }

    const activeOverrideId = state.activeBreakpointId &&
      (screen.breakpoints ?? []).some((breakpoint) => breakpoint.id === state.activeBreakpointId)
      ? state.activeBreakpointId
      : null;
    const parsedColor = parseStyleColor(token.color);
    if (!parsedColor) {
      notify("This imported color token is invalid.", true);
      return;
    }
    const opacity = Math.min(1, Math.max(0, token.opacity * parsedColor.opacity));
    const color = parsedColor.hex;
    const textColor = styleColorToRgba(color, opacity);
    const stylePatch = usage === "background"
      ? { fill: color, fillOpacity: opacity }
      : usage === "border"
        ? { stroke: color, strokeOpacity: opacity }
        : null;
    const propsPatch = usage === "text" ? { color: textColor } : null;

    state.setProject({
      ...state.project,
      updatedAt: new Date().toISOString(),
      screens: state.project.screens.map((item) => item.id !== screenId ? item : {
        ...item,
        widgets: item.widgets.map((widget) => {
          if (!selectedIds.has(widget.id) || widget.locked) return widget;
          const currentOverride = activeOverrideId ? widget.overrides?.[activeOverrideId] : undefined;
          if (activeOverrideId && currentOverride) {
            return {
              ...widget,
              overrides: {
                ...widget.overrides,
                [activeOverrideId]: {
                  ...currentOverride,
                  ...(stylePatch ? { style: { ...currentOverride.style, ...stylePatch } } : {}),
                  ...(propsPatch ? { props: { ...currentOverride.props, ...propsPatch } } : {}),
                },
              },
            };
          }
          return {
            ...widget,
            ...(stylePatch ? { style: { ...widget.style, ...stylePatch } } : {}),
            ...(propsPatch ? { props: { ...widget.props, ...propsPatch } } : {}),
          };
        }),
      }),
    });
    notify(`Applied ${usage} token ${token.color}.`);
  }, [notify]);

  const applyImportedTextStyle = useCallback((token: ImportedTextStyleToken) => {
    const state = useStore.getState();
    const screenId = state.getActiveScreenId();
    const screen = state.project.screens.find((item) => item.id === screenId);
    if (!screen) {
      notify("Select a screen before applying an imported text style.", true);
      return;
    }
    const selectedIds = new Set(state.selectedIds);
    const selectedWidgets = screen.widgets.filter((widget) => (
      selectedIds.has(widget.id) && !widget.locked && isTextStyleWidget(widget)
    ));
    if (selectedWidgets.length === 0) {
      notify("Select an unlocked text element before applying an imported text style.", true);
      return;
    }
    const selectedTextIds = new Set(selectedWidgets.map((widget) => widget.id));

    const activeOverrideId = state.activeBreakpointId &&
      (screen.breakpoints ?? []).some((breakpoint) => breakpoint.id === state.activeBreakpointId)
      ? state.activeBreakpointId
      : null;
    const propsPatch = {
      fontFamily: token.fontFamily,
      fontSize: token.fontSize,
      fontWeight: token.fontWeight,
    };
    state.setProject({
      ...state.project,
      updatedAt: new Date().toISOString(),
      screens: state.project.screens.map((item) => item.id !== screenId ? item : {
        ...item,
        widgets: item.widgets.map((widget) => {
          if (!selectedTextIds.has(widget.id)) return widget;
          const currentOverride = activeOverrideId ? widget.overrides?.[activeOverrideId] : undefined;
          if (activeOverrideId && currentOverride) {
            return {
              ...widget,
              overrides: {
                ...widget.overrides,
                [activeOverrideId]: {
                  ...currentOverride,
                  props: { ...currentOverride.props, ...propsPatch },
                },
              },
            };
          }
          return { ...widget, props: { ...widget.props, ...propsPatch } };
        }),
      }),
    });
    notify(`Applied ${token.fontFamily} ${token.fontSize}px text style.`);
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
        onImportCode={openImportCode}
        onPublishCloudPreview={() => setCloudPreviewOpen(true)}
        onOpenCollaboration={openCollaboration}
        onExportReactCode={() => setReactExportOpen(true)}
        onExportHtml={() => setHtmlExportOpen(true)}
        onOpenWallet={() => setWalletOpen(true)}
        onOpenPrivacySettings={() => {
          setPrivacyFirstLaunch(false);
          setPrivacyDialogOpen(true);
        }}
        onOpenBetaFeedback={() => void openBetaFeedback()}
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
          onOpenParityDocumentation={() => {
            setHelpArticleSlug("axure-figma-migration");
            setHelpOpen(true);
          }}
          onOpenHelp={() => setHelpOpen(true)}
          onOpenTutorial={() => void openTutorialProject()}
          activeTool={activeTool}
          unlockedTools={unlockedElementTools}
          onSelectTool={setActiveTool}
          onAddScreen={addLibraryScreen}
          importedDesignTokens={importedDesignTokens}
          onApplyImportedColor={applyImportedColor}
          onApplyImportedTextStyle={applyImportedTextStyle}
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
          tutorialProjectId={tutorialOpen ? currentProject.id : null}
        />
      </div>
      <StatusBar />
      <RestoreModal />
      <UpdateToast requestId={updateCheckRequest} />
      <CommandPalette />
      {importCodeOpen && (
        <ImportCodeDialog
          initialCode={importCodeDraft}
          screens={currentProject.screens.map(({ id, name }) => ({ id, name }))}
          sourceScreenId={useStore.getState().getActiveScreenId()}
          onDraftChange={setImportCodeDraft}
          onClose={() => setImportCodeOpen(false)}
          onRenderOnCanvas={renderImportedCode}
        />
      )}
      {privacyDialogOpen && (
        <PrivacySettingsDialog
          firstLaunch={privacyFirstLaunch}
          theme={onboardingTheme}
          onThemeChange={chooseOnboardingTheme}
          onClose={() => setPrivacyDialogOpen(false)}
          onShowOnboarding={showOnboardingAgain}
          onSaved={() => {
            setPrivacyFirstLaunch(false);
            setPrivacyDialogOpen(false);
            setOnboardingOpen(!onboardingState.hasCompletedOnboarding);
          }}
        />
      )}
      {onboardingOpen && (
        <OnboardingWizard
          initialTheme={onboardingTheme}
          selectedTemplate={onboardingState.selectedTemplate}
          initialDeviceTourCompleted={onboardingState.deviceTourCompleted}
          onThemeChange={chooseOnboardingTheme}
          onSelectTemplate={(template) => updateOnboardingState({ selectedTemplate: template })}
          onDeviceTourCompleted={() => updateOnboardingState({ deviceTourCompleted: true })}
          onOpenExisting={openFile}
          onComplete={completeOnboarding}
          onTakeTutorial={takeTutorialFromOnboarding}
          onSkip={skipOnboarding}
        />
      )}
      {tutorialOpen && <TutorialGuide key={tutorialSession} onClose={closeTutorial} />}
      {helpOpen && (
        <HelpPanel
          initialSlug={helpArticleSlug}
          onClose={() => setHelpOpen(false)}
          onOpenTutorial={() => void openTutorialProject()}
          onNotify={notify}
        />
      )}
      {versionHistoryOpen && (
        <VersionHistoryDialog
          project={currentProject}
          filePath={currentFilePath}
          isDirty={projectIsDirty}
          onClose={() => setVersionHistoryOpen(false)}
          onRestore={(checkpoint) => {
            const current = useStore.getState();
            const previousProject = current.project;
            current.restoreProject(checkpoint, current.filePath);
            useStore.getState().pushHistory(previousProject);
            trackEvent("version_history_restored");
          }}
          onNotify={notify}
        />
      )}
      {walletOpen && <WalletDialog onClose={() => setWalletOpen(false)} />}
      {cloudPreviewOpen && <CloudPreviewDialog onClose={() => setCloudPreviewOpen(false)} />}
      {reactExportOpen && <ReactCodeExportDialog onClose={() => setReactExportOpen(false)} />}
      {htmlExportOpen && <HtmlExportDialog onClose={() => setHtmlExportOpen(false)} />}
      {pluginManagerOpen && <PluginManagerDialog onClose={() => setPluginManagerOpen(false)} />}
      {collaborationMounted && (
        <CollaborationDialog
          open={collaborationOpen}
          initialSessionId={collaborationInviteId}
          onClose={closeCollaboration}
          onSessionActive={setActiveCollaboration}
        />
      )}

      {notice && (
        <div className={`toast${noticeIsError ? " toast-error" : ""}`} role={noticeIsError ? "alert" : "status"}>
          {noticeIsError ? <CircleAlert size={15} /> : <Check size={15} />}
          <span>{notice}</span>
        </div>
      )}
      {onboardingTipVisible && (
        <div className="onboarding-tip" role="status">
          <span>Tip: Need a hand? Browse Help and Docs whenever you’re ready.</span>
          <button type="button" onClick={() => setHelpOpen(true)}>Open docs</button>
          <button type="button" aria-label="Dismiss onboarding tip" onClick={() => setOnboardingTipVisible(false)}>Dismiss</button>
        </div>
      )}

    </div>
  );
}

export default AppShell;

import { beforeEach, describe, expect, it } from "vitest";
import { createEmptyProject } from "../project/schema";
import { HISTORY_LIMIT } from "./historySlice";
import { useStore } from "./index";

function resetStore(): void {
  useStore.setState({
    project: createEmptyProject(),
    filePath: null,
    isDirty: false,
    lastSavedAt: null,
    activeScreenId: null,
    past: [],
    future: [],
    zoom: 1,
    pan: { x: 0, y: 0 },
    gridSize: 10,
    gridStyle: "dots",
    gridVisible: true,
    snapEnabled: true,
    selectedIds: [],
    geometryPreview: null,
    paletteOpen: false,
    leftPanelOpen: true,
    rightPanelOpen: true,
    showDeviceFrame: true,
    showSafeArea: true,
    statusBarTheme: "dark",
    statusBarTimeMode: "static",
    showBattery: true,
    showSignal: true,
  });
}

describe("composed Zustand store", () => {
  beforeEach(resetStore);

  it("creates a named empty project and marks document changes dirty", () => {
    useStore.setState({ filePath: "previous.pflow", isDirty: true });
    const store = useStore.getState();
    store.newProject("New prototype");
    expect(useStore.getState()).toMatchObject({
      project: { name: "New prototype", screens: [{ widgets: [] }] },
      filePath: null,
      isDirty: false,
      past: [],
      future: [],
    });

    const changed = { ...useStore.getState().project, name: "Updated prototype" };
    useStore.getState().setProject(changed);
    expect(useStore.getState().project.name).toBe("Updated prototype");
    expect(useStore.getState().isDirty).toBe(true);
    expect(useStore.getState().past).toHaveLength(1);
  });

  it("tracks rename history and supports undo, redo, and clean state", () => {
    const store = useStore.getState();
    store.renameProject("Checkout flow");
    expect(useStore.getState().past).toHaveLength(1);
    expect(useStore.getState().canUndo()).toBe(true);

    expect(useStore.getState().undo()?.name).toBe("Untitled project");
    expect(useStore.getState().project.name).toBe("Untitled project");
    expect(useStore.getState().canRedo()).toBe(true);

    expect(useStore.getState().redo()?.name).toBe("Checkout flow");
    expect(useStore.getState().project.name).toBe("Checkout flow");
    useStore.getState().markSaved("checkout.pflow");
    expect(useStore.getState().filePath).toBe("checkout.pflow");
    expect(useStore.getState().isDirty).toBe(false);
    useStore.getState().markClean();
    expect(useStore.getState().isDirty).toBe(false);
    expect(useStore.getState().lastSavedAt).not.toBeNull();
  });

  it("caps undo history at 50 snapshots and clears redo after a new change", () => {
    for (let index = 0; index < HISTORY_LIMIT + 10; index += 1) {
      useStore.getState().pushHistory(createEmptyProject(`Snapshot ${index}`));
    }
    expect(useStore.getState().past).toHaveLength(HISTORY_LIMIT);

    useStore.getState().undo();
    expect(useStore.getState().canRedo()).toBe(true);
    useStore.getState().pushHistory(createEmptyProject("New branch"));
    expect(useStore.getState().future).toEqual([]);
    expect(useStore.getState().past).toHaveLength(HISTORY_LIMIT);
  });

  it("clamps zoom, replaces pan immutably, and manages grid and selection", () => {
    const store = useStore.getState();
    store.setZoom(0);
    expect(useStore.getState().zoom).toBe(0.1);
    store.setZoom(99);
    expect(useStore.getState().zoom).toBe(4);
    store.setZoom(Number.NaN);
    expect(useStore.getState().zoom).toBe(4);

    store.setPan(12, -4);
    store.setGridSize(20);
    store.setGridStyle("lines");
    store.toggleGrid();
    store.toggleSnap();
    store.select(["widget-a", "widget-a", "widget-b"]);
    expect(useStore.getState()).toMatchObject({
      pan: { x: 12, y: -4 },
      gridSize: 20,
      gridStyle: "lines",
      gridVisible: false,
      snapEnabled: false,
      selectedIds: ["widget-a", "widget-b"],
    });

    store.clearSelection();
    expect(useStore.getState().selectedIds).toEqual([]);

    store.setGeometryPreview({ "widget-a": { x: 12 } });
    store.select(["widget-b"]);
    expect(useStore.getState().geometryPreview).toBeNull();
  });

  it("switches active screens independently of the configured start screen", () => {
    const project = createEmptyProject();
    const secondScreen = {
      ...project.screens[0],
      id: crypto.randomUUID(),
      name: "Checkout",
    };
    useStore.getState().setProject({
      ...project,
      screens: [...project.screens, secondScreen],
    });
    useStore.getState().select(["widget-on-first-screen"]);

    useStore.getState().setActiveScreen(secondScreen.id);

    expect(useStore.getState().getActiveScreenId()).toBe(secondScreen.id);
    expect(useStore.getState().project.startScreenId).toBe(project.startScreenId);
    expect(useStore.getState().selectedIds).toEqual([]);
  });

  it("falls back to the start screen if the active screen was removed", () => {
    const project = createEmptyProject();
    const secondScreen = { ...project.screens[0], id: crypto.randomUUID() };
    useStore.getState().setProject({
      ...project,
      screens: [...project.screens, secondScreen],
    });
    useStore.getState().setActiveScreen(secondScreen.id);
    useStore.setState({
      project: { ...useStore.getState().project, screens: project.screens },
    });

    expect(useStore.getState().getActiveScreenId()).toBe(project.startScreenId);
  });

  it("toggles UI slice state independently", () => {
    const store = useStore.getState();
    store.togglePalette();
    store.toggleLeftPanel();
    store.toggleRightPanel();
    store.toggleDeviceFrame();
    store.toggleSafeArea();
    store.setStatusBarTheme("light");
    store.setStatusBarTimeMode("real");
    store.toggleBattery();
    store.toggleSignal();
    expect(useStore.getState()).toMatchObject({
      paletteOpen: true,
      leftPanelOpen: false,
      rightPanelOpen: false,
      showDeviceFrame: false,
      showSafeArea: false,
      statusBarTheme: "light",
      statusBarTimeMode: "real",
      showBattery: false,
      showSignal: false,
    });
    store.setPaletteOpen(false);
    expect(useStore.getState().paletteOpen).toBe(false);
  });

  it("keeps unrelated slice values unchanged when canvas state changes", () => {
    const before = useStore.getState();
    before.setZoom(2);
    const after = useStore.getState();

    expect(after.project).toBe(before.project);
    expect(after.paletteOpen).toBe(before.paletteOpen);
    expect(after.leftPanelOpen).toBe(before.leftPanelOpen);
    expect(after.zoom).toBe(2);
  });

  it("resets history when a different project is loaded", () => {
    const store = useStore.getState();
    store.pushHistory(store.project);
    store.loadProject(createEmptyProject("Loaded project"), "loaded.pflow");
    expect(useStore.getState()).toMatchObject({
      project: { name: "Loaded project" },
      filePath: "loaded.pflow",
      isDirty: false,
      past: [],
      future: [],
    });
  });
});

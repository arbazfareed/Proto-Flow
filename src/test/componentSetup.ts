import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, vi } from "vitest";
import { createEmptyProject } from "../project/schema";
import { useStore } from "../store";
import { useWalletStore } from "../wallet/store";

export const server = setupServer();

class ResizeObserverMock implements ResizeObserver {
  constructor(_callback: ResizeObserverCallback) {}
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

globalThis.ResizeObserver ??= ResizeObserverMock;
Element.prototype.scrollIntoView ??= () => {};

vi.mock("@tauri-apps/api/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tauri-apps/api/core")>();
  return {
    ...actual,
    invoke: vi.fn(),
  };
});

beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterAll(() => server.close());
afterEach(() => {
  cleanup();
  server.resetHandlers();
  vi.clearAllMocks();
});
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  useStore.setState({
    project: createEmptyProject(),
    filePath: null,
    isDirty: false,
    lastSavedAt: null,
    activeScreenId: null,
    activeBreakpointId: null,
    activePanelEdit: null,
    activeRepeaterEdit: null,
    hoveredWidgetId: null,
    hoveredCanvasWidgetId: null,
    hoveredLayerWidgetId: null,
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
    notesOverlay: false,
    inspectorTab: "design",
  });
  useWalletStore.setState({
    status: "loading",
    networkStatus: "checking",
    balance: 0,
    lifetimeGranted: 0,
    lifetimeSpent: 0,
    jwt: null,
    accountId: null,
    email: null,
    recentLedger: [],
    lastSyncedAt: null,
    claimable: false,
    nextClaimAt: null,
    error: null,
  });
});

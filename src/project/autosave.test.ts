import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import {
  AUTOSAVE_INTERVAL_MS,
  AUTOSAVE_KEY,
  AUTOSAVE_MAX_AGE_MS,
  clearAutosave,
  readAutosave,
  startAutosave,
  subscribeAutosaveErrors,
} from "./autosave";
import { createEmptyProject } from "./schema";
import { useStore } from "../store";

class MemoryStorage implements Storage {
  private values = new Map<string, string>();

  get length(): number {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return Array.from(this.values.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

const storage = new MemoryStorage();

function resetStore(): void {
  useStore.setState({
    project: createEmptyProject(),
    filePath: null,
    isDirty: false,
    lastSavedAt: null,
    past: [],
    future: [],
    zoom: 1,
    pan: { x: 0, y: 0 },
    gridSize: 10,
    gridVisible: true,
    snapEnabled: true,
    selectedIds: [],
    paletteOpen: false,
    leftPanelOpen: true,
    rightPanelOpen: true,
  });
}

describe("local project autosave", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T12:00:00.000Z"));
    storage.clear();
    vi.stubGlobal("localStorage", storage);
    vi.stubGlobal("window", {
      setInterval: globalThis.setInterval.bind(globalThis),
      clearInterval: globalThis.clearInterval.bind(globalThis),
    });
    resetStore();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("writes only dirty projects on the 30-second interval", () => {
    startAutosave();
    vi.advanceTimersByTime(AUTOSAVE_INTERVAL_MS - 1);
    expect(storage.getItem(AUTOSAVE_KEY)).toBeNull();

    const project = { ...useStore.getState().project, name: "Dirty prototype" };
    useStore.getState().setProject(project);
    vi.advanceTimersByTime(1);

    expect(readAutosave()).toMatchObject({
      project: { name: "Dirty prototype" },
      ts: Date.now(),
    });
  });

  it("does not rewrite an unchanged autosave payload", () => {
    const setItem = vi.spyOn(storage, "setItem");
    const stopAutosave = startAutosave();
    useStore.getState().setProject({
      ...useStore.getState().project,
      name: "Dirty prototype",
    });

    vi.advanceTimersByTime(AUTOSAVE_INTERVAL_MS);
    vi.advanceTimersByTime(AUTOSAVE_INTERVAL_MS);

    expect(setItem).toHaveBeenCalledTimes(1);
    stopAutosave();
  });

  it("reports storage quota failures so the app can prompt the user to save", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeAutosaveErrors(listener);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const setItem = vi.spyOn(storage, "setItem").mockImplementation(() => {
      throw new DOMException("Quota exceeded", "QuotaExceededError");
    });
    const stopAutosave = startAutosave();
    useStore.getState().renameProject("Large prototype");

    vi.advanceTimersByTime(AUTOSAVE_INTERVAL_MS);

    expect(listener).toHaveBeenCalledWith(
      "Autosave failed. Save your project to disk and check available storage.",
    );
    expect(consoleError).toHaveBeenCalledOnce();

    stopAutosave();
    unsubscribe();
    setItem.mockRestore();
    consoleError.mockRestore();
  });

  it("does not recreate a cleared snapshot until the project changes", () => {
    const stopAutosave = startAutosave();
    useStore.getState().setProject({
      ...useStore.getState().project,
      name: "Restored prototype",
    });
    vi.advanceTimersByTime(AUTOSAVE_INTERVAL_MS);

    clearAutosave();
    expect(storage.getItem(AUTOSAVE_KEY)).toBeNull();
    vi.advanceTimersByTime(AUTOSAVE_INTERVAL_MS);
    expect(storage.getItem(AUTOSAVE_KEY)).toBeNull();

    useStore.getState().renameProject("Edited restored prototype");
    vi.advanceTimersByTime(AUTOSAVE_INTERVAL_MS);
    expect(readAutosave()?.project.name).toBe("Edited restored prototype");
    stopAutosave();
  });

  it("expires snapshots older than seven days and removes them", () => {
    storage.setItem(AUTOSAVE_KEY, JSON.stringify({
      project: createEmptyProject("Old prototype"),
      ts: Date.now() - AUTOSAVE_MAX_AGE_MS - 1,
    }));

    expect(readAutosave()).toBeNull();
    expect(storage.getItem(AUTOSAVE_KEY)).toBeNull();
  });

  it("silently discards malformed or invalid snapshots", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    storage.setItem(AUTOSAVE_KEY, "{");
    expect(readAutosave()).toBeNull();
    expect(storage.getItem(AUTOSAVE_KEY)).toBeNull();

    storage.setItem(AUTOSAVE_KEY, JSON.stringify({ project: {}, ts: Date.now() }));
    expect(readAutosave()).toBeNull();
    expect(storage.getItem(AUTOSAVE_KEY)).toBeNull();
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("migrates valid legacy recovery data and preserves its file path", () => {
    const legacyKey = "proto-flow:crash-recovery:v1";
    storage.setItem(legacyKey, JSON.stringify({
      project: createEmptyProject("Legacy prototype"),
      filePath: "legacy.pflow",
      recoveredAt: new Date().toISOString(),
    }));

    expect(readAutosave()).toMatchObject({
      project: { name: "Legacy prototype" },
      filePath: "legacy.pflow",
    });
    expect(storage.getItem(legacyKey)).toBeNull();
    expect(storage.getItem(AUTOSAVE_KEY)).not.toBeNull();
  });

  it("clears current and legacy autosave records", () => {
    storage.setItem(AUTOSAVE_KEY, "current");
    storage.setItem("proto-flow:crash-recovery:v1", "legacy");

    clearAutosave();

    expect(storage.getItem(AUTOSAVE_KEY)).toBeNull();
    expect(storage.getItem("proto-flow:crash-recovery:v1")).toBeNull();
  });
});

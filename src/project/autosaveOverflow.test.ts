import { IDBFactory } from "fake-indexeddb";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import {
  AUTOSAVE_INTERVAL_MS,
  AUTOSAVE_KEY,
  AUTOSAVE_MAX_AGE_MS,
  clearAutosave,
  readAutosave,
  readAutosaveAsync,
  startAutosave,
  subscribeAutosaveErrors,
  writeAutosave,
} from "./autosave";
import { createEmptyProject } from "./schema";
import { useStore } from "../store";

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  get length(): number { return this.values.size; }
  clear(): void { this.values.clear(); }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  key(index: number): string | null { return Array.from(this.values.keys())[index] ?? null; }
  removeItem(key: string): void { this.values.delete(key); }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

const storage = new MemoryStorage();
const quotaError = () => new DOMException("Quota exceeded", "QuotaExceededError");

/** Lets pending IndexedDB requests finish (fake-indexeddb runs on real timers). */
const settle = () => new Promise((resolve) => setTimeout(resolve, 30));

function readOverflowDirectly(): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open("proto-flow-autosave", 1);
    open.onupgradeneeded = () => open.result.createObjectStore("snapshots");
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const get = open.result.transaction("snapshots").objectStore("snapshots").get("latest");
      get.onsuccess = () => { open.result.close(); resolve((get.result as string | undefined) ?? null); };
      get.onerror = () => reject(get.error);
    };
  });
}

function resetStore(): void {
  useStore.setState({
    project: createEmptyProject(),
    filePath: null,
    isDirty: false,
    lastSavedAt: null,
    past: [],
    future: [],
    selectedIds: [],
  });
}

describe("autosave when localStorage is full (B34)", () => {
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    vi.setSystemTime(new Date("2026-01-01T12:00:00.000Z"));
    storage.clear();
    // A fresh IndexedDB for every test, removed again afterwards so it cannot leak into other files
    // (the test pool shares globals between files).
    vi.stubGlobal("indexedDB", new IDBFactory());
    vi.stubGlobal("localStorage", storage);
    vi.stubGlobal("window", {
      setInterval: globalThis.setInterval.bind(globalThis),
      clearInterval: globalThis.clearInterval.bind(globalThis),
      setTimeout: globalThis.setTimeout.bind(globalThis),
      clearTimeout: globalThis.clearTimeout.bind(globalThis),
    });
    resetStore();
    clearAutosave();
    await settle();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("stores the snapshot in IndexedDB, without an error, when localStorage is full", async () => {
    const listener = vi.fn();
    const unsubscribe = subscribeAutosaveErrors(listener);
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(storage, "setItem").mockImplementation(() => { throw quotaError(); });
    const stop = startAutosave();
    useStore.getState().renameProject("Project with many images");

    vi.advanceTimersByTime(AUTOSAVE_INTERVAL_MS);
    await settle();

    expect(listener).not.toHaveBeenCalled();
    expect(storage.getItem(AUTOSAVE_KEY)).toBeNull();
    expect(readAutosave()).toBeNull();
    await expect(readAutosaveAsync()).resolves.toMatchObject({
      project: { name: "Project with many images" },
      ts: Date.now(),
    });
    stop();
    unsubscribe();
  });

  it("does not write an unchanged project to IndexedDB again", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const setItem = vi.spyOn(storage, "setItem").mockImplementation(() => { throw quotaError(); });
    const stop = startAutosave();
    useStore.getState().renameProject("Large prototype");

    vi.advanceTimersByTime(AUTOSAVE_INTERVAL_MS);
    await settle();
    vi.advanceTimersByTime(AUTOSAVE_INTERVAL_MS);
    await settle();

    expect(setItem).toHaveBeenCalledTimes(1);
    stop();
  });

  it("restores the IndexedDB copy when it is newer than the localStorage one", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    storage.setItem(AUTOSAVE_KEY, JSON.stringify({
      project: createEmptyProject("Older local copy"),
      ts: Date.now() - 60_000,
    }));
    const setItem = vi.spyOn(storage, "setItem").mockImplementation(() => { throw quotaError(); });
    writeAutosave(createEmptyProject("Newer IndexedDB copy"), null);
    await settle();
    setItem.mockRestore();

    await expect(readAutosaveAsync()).resolves.toMatchObject({
      project: { name: "Newer IndexedDB copy" },
    });
  });

  it("restores the localStorage copy when it is newer than the IndexedDB one", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const setItem = vi.spyOn(storage, "setItem").mockImplementation(() => { throw quotaError(); });
    writeAutosave(createEmptyProject("Older IndexedDB copy"), null);
    await settle();
    setItem.mockRestore();

    vi.setSystemTime(new Date(Date.now() + 60_000));
    writeAutosave(createEmptyProject("Newer local copy"), null);

    await expect(readAutosaveAsync()).resolves.toMatchObject({
      project: { name: "Newer local copy" },
    });
  });

  it("clearing the autosave also removes the IndexedDB copy", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(storage, "setItem").mockImplementation(() => { throw quotaError(); });
    writeAutosave(createEmptyProject("To be cleared"), null);
    await settle();
    expect(await readOverflowDirectly()).not.toBeNull();

    clearAutosave();
    await settle();

    expect(await readOverflowDirectly()).toBeNull();
    await expect(readAutosaveAsync()).resolves.toBeNull();
  });

  it("drops an IndexedDB copy older than seven days", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(storage, "setItem").mockImplementation(() => { throw quotaError(); });
    writeAutosave(createEmptyProject("Old"), null);
    await settle();

    vi.setSystemTime(new Date(Date.now() + AUTOSAVE_MAX_AGE_MS + 1000));
    await expect(readAutosaveAsync()).resolves.toBeNull();
    await settle();
    expect(await readOverflowDirectly()).toBeNull();
  });

  it("reports a failure only when IndexedDB cannot take the snapshot either", async () => {
    const listener = vi.fn();
    const unsubscribe = subscribeAutosaveErrors(listener);
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(storage, "setItem").mockImplementation(() => { throw quotaError(); });
    vi.spyOn(indexedDB, "open").mockImplementation(() => {
      const request: { onerror: null | (() => void) } = { onerror: null };
      setTimeout(() => request.onerror?.(), 0);
      return request as unknown as IDBOpenDBRequest;
    });

    writeAutosave(createEmptyProject("Cannot be stored"), null);
    await settle();

    expect(listener).toHaveBeenCalledWith(
      "Autosave failed. Save your project to disk and check available storage.",
    );
    unsubscribe();
  });
});

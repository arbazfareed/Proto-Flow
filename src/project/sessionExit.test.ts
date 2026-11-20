import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getPreviousSession,
  resetSessionTrackingForTests,
  startSessionTracking,
} from "./sessionExit";

const KEY = "proto-flow-session-state";

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  get length(): number { return this.values.size; }
  clear(): void { this.values.clear(); }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  key(index: number): string | null { return Array.from(this.values.keys())[index] ?? null; }
  removeItem(key: string): void { this.values.delete(key); }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

describe("telling a crash from a normal close | B35", () => {
  const storage = new MemoryStorage();
  let listeners: Record<string, () => void>;

  beforeEach(() => {
    storage.clear();
    listeners = {};
    resetSessionTrackingForTests();
    vi.stubGlobal("localStorage", storage);
    vi.stubGlobal("window", {
      addEventListener: (name: string, listener: () => void) => { listeners[name] = listener; },
    });
  });

  afterEach(() => {
    resetSessionTrackingForTests();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("is not a crash on a first start, and marks the session running", () => {
    expect(startSessionTracking()).toBe("unknown");
    expect(getPreviousSession()).toBe("unknown");
    expect(storage.getItem(KEY)).toBe("running");
  });

  it("is a normal restart when the last session was closed or reloaded", () => {
    storage.setItem(KEY, "clean");
    expect(startSessionTracking()).toBe("clean");
    expect(storage.getItem(KEY)).toBe("running");
  });

  it("is a crash when the last session never marked itself closed", () => {
    storage.setItem(KEY, "running");
    expect(startSessionTracking()).toBe("crashed");
    expect(getPreviousSession()).toBe("crashed");
  });

  it("marks the session clean when the page is hidden for good, and running again when restored", () => {
    startSessionTracking();
    listeners.pagehide();
    expect(storage.getItem(KEY)).toBe("clean");
    listeners.pageshow();
    expect(storage.getItem(KEY)).toBe("running");
  });

  it("reads the last session only once, even if it is called twice", () => {
    storage.setItem(KEY, "running");
    expect(startSessionTracking()).toBe("crashed");
    // The first call already marked this session running; a second call must not call it a crash.
    storage.setItem(KEY, "clean");
    expect(startSessionTracking()).toBe("crashed");
    expect(Object.keys(listeners).sort()).toEqual(["pagehide", "pageshow"]);
  });

  it("never claims a crash when storage cannot be used", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => { throw new Error("blocked"); },
      setItem: () => { throw new Error("blocked"); },
    });
    expect(() => startSessionTracking()).not.toThrow();
    expect(getPreviousSession()).toBe("unknown");
    expect(() => listeners.pagehide()).not.toThrow();
  });
});

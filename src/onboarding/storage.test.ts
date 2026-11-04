import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyThemePreference,
  DEFAULT_ONBOARDING_STATE,
  ONBOARDING_STORAGE_KEY,
  readOnboardingState,
  readThemePreference,
  writeOnboardingState,
  writeThemePreference,
} from "./storage";

function installStorage() {
  const values = new Map<string, string>();
  const storage = {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => { values.set(key, value); }),
  };
  vi.stubGlobal("localStorage", storage);
  return storage;
}

describe("onboarding preferences", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("defaults to a first-run state and persists completion", () => {
    const storage = installStorage();
    expect(readOnboardingState()).toEqual(DEFAULT_ONBOARDING_STATE);

    const completed = {
      ...DEFAULT_ONBOARDING_STATE,
      hasCompletedOnboarding: true,
      selectedTemplate: "dashboard",
      deviceTourCompleted: true,
    };
    writeOnboardingState(completed);
    expect(readOnboardingState()).toEqual(completed);
    expect(storage.setItem).toHaveBeenCalledWith(ONBOARDING_STORAGE_KEY, JSON.stringify(completed));
  });

  it("rejects malformed saved onboarding state", () => {
    const storage = installStorage();
    storage.getItem.mockReturnValue("{");
    expect(() => readOnboardingState()).toThrow("invalid JSON");
    storage.getItem.mockReturnValue(JSON.stringify({ hasCompletedOnboarding: true }));
    expect(() => readOnboardingState()).toThrow("unsupported format");
  });

  it("persists and applies an explicit theme", () => {
    installStorage();
    const documentElement = { dataset: {} as Record<string, string>, style: { colorScheme: "" } };
    vi.stubGlobal("document", { documentElement });
    const systemTheme = { matches: true };
    vi.stubGlobal("window", { matchMedia: vi.fn(() => systemTheme) });

    writeThemePreference("light");
    expect(readThemePreference()).toBe("light");
    expect(documentElement.dataset.theme).toBe("light");
    writeThemePreference("system");
    expect(documentElement.dataset.theme).toBe("dark");
  });

  it("resolves the system theme from the operating-system preference", () => {
    const documentElement = { dataset: {} as Record<string, string>, style: { colorScheme: "" } };
    vi.stubGlobal("document", { documentElement });
    vi.stubGlobal("window", { matchMedia: () => ({ matches: false }) });
    applyThemePreference("system");
    expect(documentElement.dataset.theme).toBe("light");
  });
});

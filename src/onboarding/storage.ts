export const ONBOARDING_STORAGE_KEY = "protoflow.onboarding.v1";
export const THEME_STORAGE_KEY = "protoflow.theme.v1";

export type ThemePreference = "light" | "dark" | "system";

export interface OnboardingState {
  hasCompletedOnboarding: boolean;
  theme: ThemePreference;
  selectedTemplate: string | null;
  deviceTourCompleted: boolean;
  skipTipShown: boolean;
}

export const DEFAULT_ONBOARDING_STATE: OnboardingState = {
  hasCompletedOnboarding: false,
  theme: "system",
  selectedTemplate: null,
  deviceTourCompleted: false,
  skipTipShown: false,
};

function isThemePreference(value: unknown): value is ThemePreference {
  return value === "light" || value === "dark" || value === "system";
}

export function readOnboardingState(): OnboardingState {
  const stored = localStorage.getItem(ONBOARDING_STORAGE_KEY);
  if (stored === null) return { ...DEFAULT_ONBOARDING_STATE };

  let value: unknown;
  try {
    value = JSON.parse(stored);
  } catch (error) {
    throw new Error("Saved onboarding preferences are invalid JSON.", { cause: error });
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Saved onboarding preferences have an unsupported format.");
  }

  const record = value as Record<string, unknown>;
  if (
    typeof record.hasCompletedOnboarding !== "boolean" ||
    !isThemePreference(record.theme) ||
    !(record.selectedTemplate === null || typeof record.selectedTemplate === "string") ||
    typeof record.deviceTourCompleted !== "boolean" ||
    typeof record.skipTipShown !== "boolean"
  ) {
    throw new Error("Saved onboarding preferences have an unsupported format.");
  }
  return {
    hasCompletedOnboarding: record.hasCompletedOnboarding,
    theme: record.theme,
    selectedTemplate: record.selectedTemplate,
    deviceTourCompleted: record.deviceTourCompleted,
    skipTipShown: record.skipTipShown,
  };
}

export function writeOnboardingState(state: OnboardingState): void {
  localStorage.setItem(ONBOARDING_STORAGE_KEY, JSON.stringify(state));
}

export function applyThemePreference(theme: ThemePreference): void {
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const resolvedTheme = theme === "system" ? (prefersDark ? "dark" : "light") : theme;
  document.documentElement.dataset.theme = resolvedTheme;
  document.documentElement.style.colorScheme = resolvedTheme;
}

export function readThemePreference(): ThemePreference {
  const stored = localStorage.getItem(THEME_STORAGE_KEY);
  if (stored === null) return readOnboardingState().theme;
  if (!isThemePreference(stored)) {
    throw new Error("Saved theme preference is unsupported.");
  }
  return stored;
}

export function writeThemePreference(theme: ThemePreference): void {
  localStorage.setItem(THEME_STORAGE_KEY, theme);
  applyThemePreference(theme);
}

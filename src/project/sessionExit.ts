/**
 * Tells a real crash from a normal close or reload (B35). The page marks the session "running"
 * when it starts and "clean" when it is closed or reloaded. If the next start still finds
 * "running", the last session ended without a chance to say so (a crash, a killed process, a
 * power cut). Nothing found means a first start, or storage that cannot be used, and counts as
 * not a crash so the app never claims a crash it cannot know about.
 */
const SESSION_STATE_KEY = "proto-flow-session-state";

export type PreviousSession = "clean" | "crashed" | "unknown";

let previousSession: PreviousSession = "unknown";
let started = false;

function writeState(value: "running" | "clean"): void {
  try {
    localStorage.setItem(SESSION_STATE_KEY, value);
  } catch {
    // Storage may be full or blocked. The worst case is the neutral wording.
  }
}

/** Reads how the last session ended, then marks this one as running. Safe to call twice. */
export function startSessionTracking(): PreviousSession {
  if (started) return previousSession;
  started = true;

  let stored: string | null = null;
  try {
    stored = localStorage.getItem(SESSION_STATE_KEY);
  } catch {
    stored = null;
  }
  previousSession = stored === "running" ? "crashed" : stored === "clean" ? "clean" : "unknown";
  writeState("running");

  if (typeof window !== "undefined") {
    window.addEventListener("pagehide", () => writeState("clean"));
    // A page restored from the back/forward cache is running again.
    window.addEventListener("pageshow", () => writeState("running"));
  }
  return previousSession;
}

/** How the last session ended, as read by startSessionTracking(). "unknown" before it runs. */
export function getPreviousSession(): PreviousSession {
  return previousSession;
}

/** For tests only: forget what startSessionTracking() learned. */
export function resetSessionTrackingForTests(): void {
  previousSession = "unknown";
  started = false;
}

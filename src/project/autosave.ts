import { z } from "zod";
import { useStore } from "../store";
import { parseProject, ProjectSchema, serializeProject, type Project } from "./schema";

export const AUTOSAVE_KEY = "proto-flow:autosave:v1";
const LEGACY_RECOVERY_KEY = "proto-flow:crash-recovery:v1";
export const AUTOSAVE_INTERVAL_MS = 30_000;
/** Quiet period after the last edit before the recovery copy is written (B65). */
export const AUTOSAVE_DEBOUNCE_MS = 1_000;
export const AUTOSAVE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

const AutosaveSchema = z.object({
  project: ProjectSchema,
  ts: z.number().finite().nonnegative(),
  filePath: z.string().nullable().optional(),
}).strict();

const LegacyRecoverySchema = z.object({
  project: ProjectSchema,
  filePath: z.string().nullable(),
  recoveredAt: z.string().datetime(),
});

export type AutosaveSnapshot = z.infer<typeof AutosaveSchema>;

let clearedProjectPayload: string | null = null;
const autosaveErrorListeners = new Set<(message: string) => void>();

export function subscribeAutosaveErrors(
  listener: (message: string) => void,
): () => void {
  autosaveErrorListeners.add(listener);
  return () => autosaveErrorListeners.delete(listener);
}

function reportAutosaveWriteError(error: unknown): void {
  console.error("Could not write Proto Flow autosave data.", error);
  autosaveErrorListeners.forEach((listener) => {
    listener("Autosave failed. Save your project to disk and check available storage.");
  });
}

/*
 * localStorage holds only about 5 MB per site, so a project with a few images does not fit (B34).
 * When a write there fails, the snapshot goes to IndexedDB instead, which has far more room.
 * localStorage stays the first choice because other code reads it straight away.
 */
const OVERFLOW_DB_NAME = "proto-flow-autosave";
const OVERFLOW_STORE = "snapshots";
const OVERFLOW_KEY = "latest";

/** The project payload last written to IndexedDB, so an unchanged project is not written again. */
let lastOverflowPayload: string | null = null;

function overflowSupported(): boolean {
  return typeof indexedDB !== "undefined" && indexedDB !== null;
}

function openOverflowDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(OVERFLOW_DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(OVERFLOW_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open autosave storage."));
    request.onblocked = () => reject(new Error("Autosave storage is blocked by another tab."));
  });
}

async function runOverflowRequest<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const database = await openOverflowDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = database.transaction(OVERFLOW_STORE, mode);
      const request = run(transaction.objectStore(OVERFLOW_STORE));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = () => reject(transaction.error ?? new Error("Autosave storage failed."));
      transaction.onabort = () => reject(transaction.error ?? new Error("Autosave storage was cancelled."));
    });
  } finally {
    database.close();
  }
}

async function writeOverflowSnapshot(serialized: string): Promise<void> {
  await runOverflowRequest("readwrite", (store) => store.put(serialized, OVERFLOW_KEY));
}

async function readOverflowSnapshot(): Promise<string | null> {
  if (!overflowSupported()) return null;
  try {
    const value = await runOverflowRequest<unknown>("readonly", (store) => store.get(OVERFLOW_KEY));
    return typeof value === "string" ? value : null;
  } catch (error) {
    console.error("Could not read Proto Flow autosave data from IndexedDB.", error);
    return null;
  }
}

async function deleteOverflowSnapshot(): Promise<void> {
  lastOverflowPayload = null;
  if (!overflowSupported()) return;
  try {
    await runOverflowRequest("readwrite", (store) => store.delete(OVERFLOW_KEY));
  } catch (error) {
    console.error("Could not remove Proto Flow autosave data from IndexedDB.", error);
  }
}

/**
 * Stores a snapshot, in localStorage when it fits and in IndexedDB when it does not. Returns true
 * when it was stored in localStorage straight away. The person is only told that autosave failed
 * when neither place could take it.
 */
function storeSnapshot(snapshot: AutosaveSnapshot, projectPayload: string): boolean {
  const serialized = JSON.stringify(snapshot);
  try {
    localStorage.setItem(AUTOSAVE_KEY, serialized);
    lastOverflowPayload = null;
    return true;
  } catch (error) {
    if (!overflowSupported()) {
      reportAutosaveWriteError(error);
      return false;
    }
    console.error("Autosave did not fit in localStorage; using IndexedDB instead.", error);
    writeOverflowSnapshot(serialized).then(
      () => {
        lastOverflowPayload = projectPayload;
      },
      (overflowError: unknown) => reportAutosaveWriteError(overflowError),
    );
    return false;
  }
}

function removeStoredSnapshot(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch (error) {
    console.error("Could not remove Proto Flow autosave data.", error);
  }
}

function isExpired(snapshot: AutosaveSnapshot, now: number): boolean {
  return now - snapshot.ts > AUTOSAVE_MAX_AGE_MS;
}

function readLegacyAutosave(now: number): AutosaveSnapshot | null {
  let serialized: string | null;
  try {
    serialized = localStorage.getItem(LEGACY_RECOVERY_KEY);
  } catch (error) {
    console.error("Could not read previous Proto Flow recovery data.", error);
    return null;
  }
  if (!serialized) return null;

  let snapshot: AutosaveSnapshot | null = null;
  try {
    const legacy = LegacyRecoverySchema.parse(JSON.parse(serialized));
    snapshot = {
      project: legacy.project,
      ts: Date.parse(legacy.recoveredAt),
      filePath: legacy.filePath,
    };
    AutosaveSchema.parse(snapshot);
    if (isExpired(snapshot, now)) snapshot = null;
  } catch {
    snapshot = null;
  }

  removeStoredSnapshot(LEGACY_RECOVERY_KEY);
  if (!snapshot) return null;

  try {
    localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(snapshot));
    return snapshot;
  } catch (error) {
    console.error("Could not migrate previous Proto Flow recovery data.", error);
    return snapshot;
  }
}

export function readAutosave(): AutosaveSnapshot | null {
  let serialized: string | null;
  try {
    serialized = localStorage.getItem(AUTOSAVE_KEY);
  } catch (error) {
    console.error("Could not read Proto Flow autosave data.", error);
    return null;
  }
  if (!serialized) return readLegacyAutosave(Date.now());

  let snapshot: AutosaveSnapshot;
  try {
    snapshot = AutosaveSchema.parse(JSON.parse(serialized));
  } catch {
    removeStoredSnapshot(AUTOSAVE_KEY);
    return null;
  }

  if (isExpired(snapshot, Date.now())) {
    removeStoredSnapshot(AUTOSAVE_KEY);
    return null;
  }
  return snapshot;
}

/**
 * The newest recovery snapshot from localStorage or IndexedDB (B34). Use this at startup, because a
 * large project may only have been stored in IndexedDB.
 */
export async function readAutosaveAsync(): Promise<AutosaveSnapshot | null> {
  const local = readAutosave();
  const serialized = await readOverflowSnapshot();
  if (!serialized) return local;

  let overflow: AutosaveSnapshot | null = null;
  try {
    overflow = AutosaveSchema.parse(JSON.parse(serialized));
    if (isExpired(overflow, Date.now())) overflow = null;
  } catch {
    overflow = null;
  }
  if (!overflow) {
    await deleteOverflowSnapshot();
    return local;
  }
  return !local || overflow.ts > local.ts ? overflow : local;
}

/**
 * Write a recovery snapshot right away, outside the 30-second interval.
 * Used after restoring a recovered project and after a browser download,
 * so there is never a window in which the only copy of the work is in memory.
 */
export function writeAutosave(project: Project, filePath: string | null = null): boolean {
  const projectPayload = serializeProject(project);
  const snapshot: AutosaveSnapshot = {
    project: parseProject(projectPayload),
    ts: Date.now(),
    ...(filePath ? { filePath } : {}),
  };
  clearedProjectPayload = null;
  return storeSnapshot(snapshot, projectPayload);
}

export function clearAutosave(): void {
  localStorage.removeItem(AUTOSAVE_KEY);
  localStorage.removeItem(LEGACY_RECOVERY_KEY);
  void deleteOverflowSnapshot();
  clearedProjectPayload = serializeProject(useStore.getState().project);
}

function runAutosave(): void {
  const { project, isDirty } = useStore.getState();
  if (!isDirty) return;

  const serializedProject = serializeProject(project);
  if (clearedProjectPayload === serializedProject) return;
  clearedProjectPayload = null;

  if (lastOverflowPayload === serializedProject) return;
  const previousSnapshot = readAutosave();
  if (
    previousSnapshot &&
    serializeProject(previousSnapshot.project) === serializedProject
  ) return;

  storeSnapshot({
    project: parseProject(serializedProject),
    ts: Date.now(),
  }, serializedProject);
}

/**
 * Keeps a recovery copy of unsaved work. A copy is written shortly after every change
 * (debounced, so dragging does not write on each mouse move) and the 30-second interval stays
 * as a safety net. This closes the window in which up to 30 seconds of edits could be lost on a
 * crash or an abrupt close (B65).
 */
export function startAutosave(): () => void {
  const interval = window.setInterval(runAutosave, AUTOSAVE_INTERVAL_MS);

  let debounceTimer: number | null = null;
  const unsubscribe = useStore.subscribe((state, previous) => {
    if (state.project === previous.project || !state.isDirty) return;
    if (debounceTimer !== null) window.clearTimeout(debounceTimer);
    debounceTimer = window.setTimeout(() => {
      debounceTimer = null;
      runAutosave();
    }, AUTOSAVE_DEBOUNCE_MS);
  });

  return () => {
    window.clearInterval(interval);
    unsubscribe();
    if (debounceTimer !== null) window.clearTimeout(debounceTimer);
  };
}

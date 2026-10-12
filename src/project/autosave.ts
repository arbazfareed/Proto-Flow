import { z } from "zod";
import { useStore } from "../store";
import { parseProject, ProjectSchema, serializeProject } from "./schema";

export const AUTOSAVE_KEY = "proto-flow:autosave:v1";
const LEGACY_RECOVERY_KEY = "proto-flow:crash-recovery:v1";
export const AUTOSAVE_INTERVAL_MS = 30_000;
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

export function clearAutosave(): void {
  localStorage.removeItem(AUTOSAVE_KEY);
  localStorage.removeItem(LEGACY_RECOVERY_KEY);
  clearedProjectPayload = serializeProject(useStore.getState().project);
}

export function startAutosave(): () => void {
  const interval = window.setInterval(() => {
    const { project, isDirty } = useStore.getState();
    if (!isDirty) return;

    const serializedProject = serializeProject(project);
    if (clearedProjectPayload === serializedProject) return;
    clearedProjectPayload = null;

    const previousSnapshot = readAutosave();
    if (
      previousSnapshot &&
      serializeProject(previousSnapshot.project) === serializedProject
    ) return;

    const snapshot: AutosaveSnapshot = {
      project: parseProject(serializedProject),
      ts: Date.now(),
    };
    try {
      localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(snapshot));
    } catch (error) {
      console.error("Could not write Proto Flow autosave data.", error);
    }
  }, AUTOSAVE_INTERVAL_MS);

  return () => window.clearInterval(interval);
}

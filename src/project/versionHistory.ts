import { invoke, isTauri } from "@tauri-apps/api/core";
import { create, type Delta } from "jsondiffpatch";
import { z } from "zod";
import { openProjectFile, saveProjectFile } from "./files";
import { ProjectSchema, serializeProject, type Project } from "./schema";
import { collectWidgetsDeep } from "./dynamicPanels";

export const VERSION_HISTORY_LIMIT = 50;
export const VERSION_HISTORY_FULL_SNAPSHOT_COUNT = 10;
export const VERSION_HISTORY_MAX_BYTES = 50 * 1024 * 1024;
const VERSION_HISTORY_VERSION: 1 = 1;
export const VERSION_HISTORY_STORAGE_PREFIX = "proto-flow:version-history:v1:";
export const VERSION_HISTORY_INTERVAL_MS = 5 * 60 * 1000;

const CheckpointSchema = z.object({
  id: z.string().uuid(),
  createdAt: z.iso.datetime(),
  label: z.string().trim().min(1).max(120),
  source: z.enum(["manual", "automatic", "imported", "restore"]),
  snapshot: ProjectSchema.optional(),
  delta: z.custom<Delta>((value) => value !== null && typeof value === "object").optional(),
}).strict().superRefine((checkpoint, context) => {
  if ((checkpoint.snapshot === undefined) === (checkpoint.delta === undefined)) {
    context.addIssue({
      code: "custom",
      message: "A checkpoint must contain exactly one snapshot or diff.",
    });
  }
});

const HistoryDocumentSchema = z.object({
  version: z.literal(VERSION_HISTORY_VERSION),
  projectId: z.string().uuid(),
  checkpoints: z.array(CheckpointSchema).max(VERSION_HISTORY_LIMIT),
}).strict();

export type VersionCheckpoint = z.infer<typeof CheckpointSchema>;
type HistoryDocument = z.infer<typeof HistoryDocumentSchema>;

const diffPatcher = create({
  objectHash: (item: object) => {
    if ("id" in item && typeof item.id === "string") return item.id;
    return undefined;
  },
});

const historyCache = new Map<string, HistoryDocument>();
const HISTORY_CACHE_LIMIT = 2;

function cacheDocument(key: string, document: HistoryDocument): void {
  historyCache.delete(key);
  historyCache.set(key, document);
  while (historyCache.size > HISTORY_CACHE_LIMIT) {
    const oldestKey = historyCache.keys().next().value;
    if (oldestKey === undefined) break;
    historyCache.delete(oldestKey);
  }
}

function storageKey(projectId: string, _filePath: string | null): string {
  return isTauri()
    ? projectId
    : `${VERSION_HISTORY_STORAGE_PREFIX}${projectId}`;
}

function validateDocument(value: unknown, projectId: string): HistoryDocument {
  const parsed = HistoryDocumentSchema.parse(value);
  if (parsed.projectId !== projectId) {
    throw new Error("The checkpoint file belongs to a different project.");
  }
  return parsed;
}

async function readDocument(projectId: string, filePath: string | null): Promise<HistoryDocument> {
  const key = storageKey(projectId, filePath);
  const cached = historyCache.get(key);
  if (cached) return cached;

  let value: unknown;
  if (isTauri()) {
    const content = await invoke<string | null>("load_project_history", {
      projectId,
      filePath,
    });
    if (!content) {
      const empty = { version: VERSION_HISTORY_VERSION, projectId, checkpoints: [] };
      cacheDocument(key, empty);
      return empty;
    }
    if (new TextEncoder().encode(content).byteLength > VERSION_HISTORY_MAX_BYTES) {
      throw new Error("The project version history exceeds the 50 MB limit.");
    }
    try {
      value = JSON.parse(content) as unknown;
    } catch (error) {
      throw new Error("The project version history file is invalid JSON.", { cause: error });
    }
  } else {
    const content = localStorage.getItem(key);
    if (!content) {
      const empty = { version: VERSION_HISTORY_VERSION, projectId, checkpoints: [] };
      cacheDocument(key, empty);
      return empty;
    }
    try {
      value = JSON.parse(content) as unknown;
    } catch (error) {
      throw new Error("The saved version history is invalid JSON.", { cause: error });
    }
  }

  const document = validateDocument(value, projectId);
  cacheDocument(key, document);
  return document;
}

async function writeDocument(
  document: HistoryDocument,
  filePath: string | null,
): Promise<void> {
  const content = JSON.stringify(document);
  if (new TextEncoder().encode(content).byteLength > VERSION_HISTORY_MAX_BYTES) {
    throw new Error("The project version history exceeds the 50 MB limit.");
  }
  const key = storageKey(document.projectId, filePath);
  if (isTauri()) {
    await invoke("save_project_history", {
      projectId: document.projectId,
      filePath,
      content,
    });
  } else {
    localStorage.setItem(key, content);
  }
  cacheDocument(key, document);
}

export function clearVersionHistoryCache(): void {
  historyCache.clear();
}

export function reconstructCheckpoint(
  checkpoints: VersionCheckpoint[],
  index: number,
): Project {
  if (!Number.isInteger(index) || index < 0 || index >= checkpoints.length) {
    throw new RangeError("The selected checkpoint does not exist.");
  }
  let baseIndex = index;
  while (baseIndex >= 0 && checkpoints[baseIndex].snapshot === undefined) baseIndex -= 1;
  if (baseIndex < 0) throw new Error("The checkpoint history has no recovery snapshot.");

  let project: unknown = structuredClone(checkpoints[baseIndex].snapshot);
  for (let nextIndex = baseIndex + 1; nextIndex <= index; nextIndex += 1) {
    const delta = checkpoints[nextIndex].delta as Delta | undefined;
    if (!delta) {
      if (checkpoints[nextIndex].snapshot) {
        project = structuredClone(checkpoints[nextIndex].snapshot);
        continue;
      }
      throw new Error("The checkpoint history contains an incomplete diff.");
    }
    project = diffPatcher.patch(project, delta);
  }
  return ProjectSchema.parse(project);
}

export async function listProjectCheckpoints(
  projectId: string,
  filePath: string | null,
): Promise<VersionCheckpoint[]> {
  return (await readDocument(projectId, filePath)).checkpoints;
}

export async function createProjectCheckpoint(
  project: Project,
  filePath: string | null,
  label: string,
  source: VersionCheckpoint["source"],
  allowUnchanged = false,
): Promise<VersionCheckpoint> {
  const normalizedLabel = label.trim().slice(0, 120);
  if (!normalizedLabel) throw new Error("Checkpoint names cannot be empty.");
  const document = await readDocument(project.id, filePath);
  const checkpoints = document.checkpoints.map((checkpoint) => ({ ...checkpoint }));
  let previousProject: Project | null = null;
  if (checkpoints.length > 0) {
    previousProject = reconstructCheckpoint(checkpoints, checkpoints.length - 1);
    if (!allowUnchanged && serializeProject(previousProject) === serializeProject(project)) {
      throw new Error("There are no project changes to checkpoint.");
    }
  }

  const checkpoint: VersionCheckpoint = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    label: normalizedLabel,
    source,
    snapshot: structuredClone(project),
  };
  checkpoints.push(checkpoint);

  if (checkpoints.length > VERSION_HISTORY_LIMIT) {
    const secondProject = reconstructCheckpoint(checkpoints, 1);
    checkpoints.splice(0, 1);
    checkpoints[0] = { ...checkpoints[0], snapshot: secondProject, delta: undefined };
  }

  const lastFullSnapshotIndex = checkpoints.length - VERSION_HISTORY_FULL_SNAPSHOT_COUNT - 1;
  if (lastFullSnapshotIndex > 0 && checkpoints[lastFullSnapshotIndex].snapshot) {
    const previousProject = reconstructCheckpoint(checkpoints, lastFullSnapshotIndex - 1);
    const compactedProject = reconstructCheckpoint(checkpoints, lastFullSnapshotIndex);
    checkpoints[lastFullSnapshotIndex] = {
      ...checkpoints[lastFullSnapshotIndex],
      snapshot: undefined,
      delta: diffPatcher.diff(previousProject, compactedProject) ?? {},
    };
  }

  await writeDocument({
    version: VERSION_HISTORY_VERSION,
    projectId: project.id,
    checkpoints,
  }, filePath);
  return checkpoint;
}

export function compareProjects(before: Project, after: Project): Array<{
  screen: string;
  widget: string;
  change: "added" | "removed" | "changed";
  details: string[];
}> {
  const changes: Array<{
    screen: string;
    widget: string;
    change: "added" | "removed" | "changed";
    details: string[];
  }> = [];
  const beforeScreens = new Map(before.screens.map((screen) => [screen.id, screen]));
  const afterScreens = new Map(after.screens.map((screen) => [screen.id, screen]));

  for (const screen of after.screens) {
    const previousScreen = beforeScreens.get(screen.id);
    if (!previousScreen) {
      changes.push({ screen: screen.name, widget: "Screen", change: "added", details: ["screen"] });
      continue;
    }
    if (JSON.stringify(previousScreen.interactionRules) !== JSON.stringify(screen.interactionRules)) {
      changes.push({ screen: screen.name, widget: "Screen interactions", change: "changed", details: ["logic"] });
    }
    if (JSON.stringify(previousScreen.device) !== JSON.stringify(screen.device)) {
      changes.push({ screen: screen.name, widget: "Screen device", change: "changed", details: ["geometry"] });
    }
    if (previousScreen.name !== screen.name) {
      changes.push({ screen: screen.name, widget: "Screen name", change: "changed", details: ["content"] });
    }
    if (JSON.stringify(previousScreen.breakpoints) !== JSON.stringify(screen.breakpoints)) {
      changes.push({ screen: screen.name, widget: "Breakpoints", change: "changed", details: ["geometry"] });
    }
    const previousWidgets = new Map(collectWidgetsDeep(previousScreen.widgets).map((widget) => [widget.id, widget]));
    const nextWidgets = new Map(collectWidgetsDeep(screen.widgets).map((widget) => [widget.id, widget]));
    for (const widget of nextWidgets.values()) {
      const previous = previousWidgets.get(widget.id);
      if (!previous) {
        changes.push({ screen: screen.name, widget: widget.name ?? widget.type, change: "added", details: ["widget"] });
        continue;
      }
      const details: string[] = [];
      if (
        previous.x !== widget.x || previous.y !== widget.y ||
        previous.width !== widget.width || previous.height !== widget.height ||
        previous.rotation !== widget.rotation
      ) details.push("geometry");
      if (JSON.stringify(previous.style) !== JSON.stringify(widget.style)) details.push("style");
      if (
        previous.opacity !== widget.opacity ||
        previous.visible !== widget.visible ||
        previous.locked !== widget.locked ||
        previous.zIndex !== widget.zIndex
      ) details.push("style");
      if (JSON.stringify(previous.props) !== JSON.stringify(widget.props)) details.push("content");
      if (JSON.stringify(previous.props.interactionRules) !== JSON.stringify(widget.props.interactionRules)) details.push("logic");
      if (JSON.stringify(previous.notes) !== JSON.stringify(widget.notes)) details.push("notes");
      if (details.length) {
        changes.push({ screen: screen.name, widget: widget.name ?? widget.type, change: "changed", details });
      }
    }
    for (const widget of previousWidgets.values()) {
      if (!nextWidgets.has(widget.id)) {
        changes.push({ screen: screen.name, widget: widget.name ?? widget.type, change: "removed", details: ["widget"] });
      }
    }
  }

  for (const screen of before.screens) {
    if (!afterScreens.has(screen.id)) {
      changes.push({ screen: screen.name, widget: "Screen", change: "removed", details: ["screen"] });
    }
  }
  if (JSON.stringify(before.variables) !== JSON.stringify(after.variables)) {
    changes.push({ screen: "Project", widget: "Variables", change: "changed", details: ["logic"] });
  }
  if (JSON.stringify(before.symbols) !== JSON.stringify(after.symbols)) {
    changes.push({ screen: "Project", widget: "Symbols", change: "changed", details: ["content"] });
  }
  if (before.name !== after.name) {
    changes.push({ screen: "Project", widget: "Project name", change: "changed", details: ["content"] });
  }
  if (before.startScreenId !== after.startScreenId) {
    changes.push({ screen: "Project", widget: "Start screen", change: "changed", details: ["logic"] });
  }
  return changes;
}

export async function exportCheckpoint(
  checkpointProject: Project,
  fileName: string,
): Promise<void> {
  if (isTauri()) {
    const saved = await saveProjectFile(checkpointProject, null, true);
    if (!saved) return;
    return;
  }
  const blob = new Blob([serializeProject(checkpointProject)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${fileName.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").slice(0, 120) || "checkpoint"}.pflow`;
    anchor.click();
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function importCheckpoint(): Promise<Project | null> {
  if (isTauri()) {
    const opened = await openProjectFile();
    return opened?.project ?? null;
  }
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".pflow,application/json";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) {
        resolve(null);
        return;
      }
      if (file.size > 10 * 1024 * 1024) {
        reject(new Error("Checkpoint files must be 10 MB or smaller."));
        return;
      }
      try {
        resolve(ProjectSchema.parse(JSON.parse(await file.text())));
      } catch (error) {
        reject(error instanceof Error ? error : new Error("Could not read the checkpoint file."));
      }
    };
    input.oncancel = () => resolve(null);
    input.click();
  });
}

export function startVersionHistoryAutosave(
  getState: () => { project: Project; filePath: string | null; isDirty: boolean },
  onError: (error: unknown) => void,
): () => void {
  let inProgress = false;
  const interval = window.setInterval(() => {
    const current = getState();
    if (!current.isDirty || inProgress) return;
    inProgress = true;
    void createProjectCheckpoint(
      current.project,
      current.filePath,
      "Automatic checkpoint",
      "automatic",
    ).catch((error: unknown) => {
      if (error instanceof Error && error.message === "There are no project changes to checkpoint.") return;
      onError(error);
    }).finally(() => {
      inProgress = false;
    });
  }, VERSION_HISTORY_INTERVAL_MS);
  return () => window.clearInterval(interval);
}

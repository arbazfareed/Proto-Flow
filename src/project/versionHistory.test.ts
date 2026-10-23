import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEmptyProject, type Widget } from "./schema";
import {
  clearVersionHistoryCache,
  compareProjects,
  createProjectCheckpoint,
  listProjectCheckpoints,
  reconstructCheckpoint,
  VERSION_HISTORY_LIMIT,
  VERSION_HISTORY_INTERVAL_MS,
  VERSION_HISTORY_STORAGE_PREFIX,
  startVersionHistoryAutosave,
} from "./versionHistory";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length(): number { return this.values.size; }
  clear(): void { this.values.clear(); }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  key(index: number): string | null { return Array.from(this.values.keys())[index] ?? null; }
  removeItem(key: string): void { this.values.delete(key); }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

const storage = new MemoryStorage();

function makeWidget(name: string): Widget {
  return {
    id: crypto.randomUUID(),
    type: "button",
    name,
    x: 10,
    y: 20,
    width: 100,
    height: 40,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    zIndex: 0,
    style: {},
    props: { label: name },
  };
}

describe("project version history", () => {
  beforeEach(() => {
    storage.clear();
    clearVersionHistoryCache();
    vi.stubGlobal("localStorage", storage);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("persists manual and automatic checkpoints and reconstructs snapshots", async () => {
    const first = createEmptyProject("First");
    await createProjectCheckpoint(first, null, "Initial", "manual");
    const second = { ...first, name: "Second" };
    await createProjectCheckpoint(second, null, "Changed name", "automatic");

    const checkpoints = await listProjectCheckpoints(first.id, null);
    expect(checkpoints.map((checkpoint) => checkpoint.label)).toEqual(["Initial", "Changed name"]);
    expect(reconstructCheckpoint(checkpoints, 0).name).toBe("First");
    expect(reconstructCheckpoint(checkpoints, 1).name).toBe("Second");
    expect(checkpoints[0].snapshot).toBeDefined();
    expect(checkpoints[1].snapshot).toBeDefined();
    expect(storage.getItem(`${VERSION_HISTORY_STORAGE_PREFIX}${first.id}`)).not.toBeNull();
  });

  it("keeps ten recent snapshots, compacts older checkpoints, and prunes to fifty", async () => {
    const base = createEmptyProject("Project 0");
    await createProjectCheckpoint(base, null, "Checkpoint 0", "manual");
    for (let index = 1; index < 54; index += 1) {
      const project = { ...base, name: `Project ${index}` };
      await createProjectCheckpoint(project, null, `Checkpoint ${index}`, "automatic");
    }

    const checkpoints = await listProjectCheckpoints(base.id, null);
    expect(checkpoints).toHaveLength(VERSION_HISTORY_LIMIT);
    expect(checkpoints[0].label).toBe("Checkpoint 4");
    expect(checkpoints[0].snapshot).toBeDefined();
    expect(checkpoints.filter((checkpoint) => checkpoint.snapshot !== undefined)).toHaveLength(11);
    expect(reconstructCheckpoint(checkpoints, 0).name).toBe("Project 4");
    expect(reconstructCheckpoint(checkpoints, 20).name).toBe("Project 24");
    expect(reconstructCheckpoint(checkpoints, 49).name).toBe("Project 53");
  });

  it("loads fifty checkpoints under 500 ms and compares a large project under 200 ms", async () => {
    const base = createEmptyProject("Project 0");
    await createProjectCheckpoint(base, null, "Checkpoint 0", "manual");
    for (let index = 1; index < 50; index += 1) {
      await createProjectCheckpoint({ ...base, name: `Project ${index}` }, null, `Checkpoint ${index}`, "automatic");
    }

    const loadStartedAt = performance.now();
    const checkpoints = await listProjectCheckpoints(base.id, null);
    for (let index = 0; index < checkpoints.length; index += 1) {
      reconstructCheckpoint(checkpoints, index);
    }
    expect(performance.now() - loadStartedAt).toBeLessThan(500);

    const before = createEmptyProject("Large");
    before.screens[0].widgets = Array.from({ length: 500 }, (_, index) => ({
      ...makeWidget(`Widget ${index}`),
      x: index,
    }));
    const after = structuredClone(before);
    after.screens[0].widgets = after.screens[0].widgets.map((widget, index) => ({
      ...widget,
      x: index + 1,
    }));
    const diffStartedAt = performance.now();
    const diff = compareProjects(before, after);
    expect(diff).toHaveLength(500);
    expect(performance.now() - diffStartedAt).toBeLessThan(200);
  });

  it("skips unchanged automatic checkpoints", async () => {
    const project = createEmptyProject("No changes");
    await createProjectCheckpoint(project, null, "Initial", "manual");

    await expect(
      createProjectCheckpoint(project, null, "Automatic checkpoint", "automatic"),
    ).rejects.toThrow("There are no project changes to checkpoint.");
    expect(await listProjectCheckpoints(project.id, null)).toHaveLength(1);
  });

  it("creates an automatic checkpoint on the five-minute interval only when the project is dirty", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("window", {
      setInterval: globalThis.setInterval.bind(globalThis),
      clearInterval: globalThis.clearInterval.bind(globalThis),
    });
    const project = createEmptyProject("Autosave checkpoint");
    const reportError = vi.fn();
    const stop = startVersionHistoryAutosave(
      () => ({ project, filePath: null, isDirty: true }),
      reportError,
    );

    await vi.advanceTimersByTimeAsync(VERSION_HISTORY_INTERVAL_MS);
    expect(await listProjectCheckpoints(project.id, null)).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(VERSION_HISTORY_INTERVAL_MS);
    expect(await listProjectCheckpoints(project.id, null)).toHaveLength(1);
    expect(reportError).not.toHaveBeenCalled();

    stop();
  });

  it("reports added, removed, geometry, style, content, and screen logic changes", () => {
    const before = createEmptyProject("Before");
    const oldWidget = makeWidget("Old");
    before.screens[0].widgets = [oldWidget];
    const after = structuredClone(before);
    after.screens[0].widgets = [
      {
        ...oldWidget,
        x: 40,
        style: { fill: "#ffffff" },
        props: { label: "Updated" },
      },
      makeWidget("Added"),
    ];
    after.screens[0].interactionRules = [{
      id: crypto.randomUUID(),
      widgetId: oldWidget.id,
      event: "onClick",
      conditions: [],
      actions: [{ type: "navigate", target: "screen-2" }],
    }];
    const withAddedWidgets = structuredClone(after);

    const changes = compareProjects(before, after);
    expect(changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ widget: "Old", change: "changed", details: ["geometry", "style", "content"] }),
      expect.objectContaining({ widget: "Added", change: "added" }),
      expect.objectContaining({ widget: "Screen interactions", details: ["logic"] }),
    ]));
    after.screens[0].widgets = [];
    expect(compareProjects(withAddedWidgets, after)).toEqual(expect.arrayContaining([
      expect.objectContaining({ widget: "Old", change: "removed" }),
      expect.objectContaining({ widget: "Added", change: "removed" }),
    ]));
  });
});

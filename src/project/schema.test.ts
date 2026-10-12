import { beforeEach, describe, expect, it } from "vitest";
import { createProject, parseProject, serializeProject } from "./schema";
import { useProjectStore } from "./store";

describe("project schema", () => {
  it("creates and round-trips a valid v1 project", () => {
    const project = createProject("Checkout flow");

    expect(parseProject(serializeProject(project))).toEqual(project);
  });

  it("rejects malformed JSON and unsupported schema versions", () => {
    expect(() => parseProject("{")).toThrow("not valid JSON");
    expect(() => parseProject(JSON.stringify({ schemaVersion: "2.0.0" }))).toThrow();
  });
});

describe("project history", () => {
  beforeEach(() => {
    useProjectStore.getState().loadProject(createProject("Initial"), "initial.pflow");
  });

  it("marks renames dirty and supports undo and redo", () => {
    const store = useProjectStore.getState();
    store.renameProject("Checkout flow");
    expect(useProjectStore.getState().project.name).toBe("Checkout flow");
    expect(useProjectStore.getState().isDirty).toBe(true);

    useProjectStore.getState().undo();
    expect(useProjectStore.getState().project.name).toBe("Initial");

    useProjectStore.getState().redo();
    expect(useProjectStore.getState().project.name).toBe("Checkout flow");
  });
});

import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { createEmptyProject } from "../project/schema";
import { readSharedProject, syncSharedProject } from "./provider";

describe("collaboration project synchronization", () => {
  it("synchronizes top-level project edits between documents", () => {
    const project = createEmptyProject("Shared prototype");
    const host = new Y.Doc();
    const guest = new Y.Doc();
    syncSharedProject(host, project);
    Y.applyUpdate(guest, Y.encodeStateAsUpdate(host));

    const updated = readSharedProject(host);
    updated.name = "Updated prototype";
    syncSharedProject(host, updated);
    Y.applyUpdate(guest, Y.encodeStateAsUpdate(host));

    expect(readSharedProject(guest).name).toBe("Updated prototype");
    host.destroy();
    guest.destroy();
  });

  it("merges concurrent edits to separate variable records", () => {
    const project = createEmptyProject("Shared prototype");
    project.variables = [
      {
        id: crypto.randomUUID(),
        name: "headline",
        type: "string",
        initial: "Start",
        scope: "project",
      },
      {
        id: crypto.randomUUID(),
        name: "counter",
        type: "number",
        initial: 0,
        scope: "project",
      },
    ];

    const host = new Y.Doc();
    const guest = new Y.Doc();
    syncSharedProject(host, project);
    Y.applyUpdate(guest, Y.encodeStateAsUpdate(host));

    const hostEdit = readSharedProject(host);
    hostEdit.variables[0].initial = "Updated by host";
    syncSharedProject(host, hostEdit);

    const guestEdit = readSharedProject(guest);
    guestEdit.variables[1].initial = 42;
    syncSharedProject(guest, guestEdit);

    const hostUpdate = Y.encodeStateAsUpdate(host);
    const guestUpdate = Y.encodeStateAsUpdate(guest);
    Y.applyUpdate(host, guestUpdate);
    Y.applyUpdate(guest, hostUpdate);

    expect(readSharedProject(host).variables.map((variable) => variable.initial)).toEqual([
      "Updated by host",
      42,
    ]);
    expect(readSharedProject(guest).variables.map((variable) => variable.initial)).toEqual([
      "Updated by host",
      42,
    ]);
    host.destroy();
    guest.destroy();
  });
});

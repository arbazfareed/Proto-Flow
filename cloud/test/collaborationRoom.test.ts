import { describe, expect, it } from "vitest";
import { createEmptyProject } from "../../src/project/schema";
import { CollaborationRoom } from "../src/collaborationRoom";
import type { WorkerEnv } from "../src/env";

const sessionId = "ABCDEFGHIJKLMNOPQRSTUVWX";
const objectKey = `collaboration/${sessionId}/initial.json`;

class CollaborationDatabase {
  readonly versions: Array<{ sessionId: string; objectKey: string; size: number }> = [];
  ended = false;

  prepare(sql: string) {
    const query = sql.toLowerCase();
    let values: unknown[] = [];
    const database = this;
    return {
      bind(...bound: unknown[]) {
        values = bound;
        return this;
      },
      async first<T>() {
        if (query.includes("select object_key, ended_at from collaboration_sessions")) {
          return { object_key: objectKey, ended_at: null } as T;
        }
        if (query.includes("select view_only, ended_at, last_activity_at")) {
          return {
            view_only: 0,
            ended_at: null,
            last_activity_at: new Date().toISOString(),
          } as T;
        }
        return null;
      },
      async run<T>() {
        if (query.includes("insert into collaboration_versions")) {
          database.versions.push({
            sessionId: String(values[1]),
            objectKey: String(values[2]),
            size: Number(values[4]),
          });
        }
        if (query.includes("update collaboration_sessions set ended_at")) {
          database.ended = true;
        }
        return { success: true, meta: { changes: 1 } } as D1Result<T>;
      },
    };
  }
}

describe("collaboration room finalization", () => {
  it("writes a final version even when a periodic snapshot was just saved", async () => {
    const database = new CollaborationDatabase();
    const project = createEmptyProject("Final session snapshot");
    const snapshots = new Map<string, string>();
    const stored = new Map<string, unknown>();
    const state = {
      id: { name: sessionId },
      storage: {
        get: async <T>(key: string) => stored.get(key) as T | undefined,
        put: async (key: string, value: unknown) => { stored.set(key, value); },
        setAlarm: async () => undefined,
        deleteAlarm: async () => undefined,
      },
      getWebSockets: () => [],
    } as unknown as DurableObjectState;
    const env = {
      DB: database,
      ASSETS: {
        get: async () => ({ json: async () => project }),
        put: async (key: string, value: string) => { snapshots.set(key, value); },
      },
    } as unknown as WorkerEnv;
    const room = new CollaborationRoom(state, env);
    Object.defineProperty(room, "lastSnapshot", { value: Date.now(), writable: true });

    const response = await room.fetch(new Request("https://collaboration.internal/end", { method: "POST" }));

    expect(response.status).toBe(200);
    expect(database.ended).toBe(true);
    expect(database.versions).toHaveLength(1);
    expect(database.versions[0]?.sessionId).toBe(sessionId);
    expect(JSON.parse(snapshots.get(database.versions[0]!.objectKey)!).name)
      .toBe("Final session snapshot");
  });
});

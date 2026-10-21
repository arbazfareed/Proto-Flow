import { describe, expect, it } from "vitest";
import { signJwt } from "../src/auth";
import { app } from "../src";
import type { WorkerEnv } from "../src/env";
import { createEmptyProject } from "../../src/project/schema";

const secret = "test-secret-that-is-long-enough-for-hmac-validation";

class CollaborationStatement {
  values: unknown[] = [];

  constructor(readonly sql: string, private readonly database: CollaborationDatabase) {}

  bind(...values: unknown[]) {
    this.values = values;
    return this;
  }

  async first<T>(): Promise<T | null> {
    const query = this.sql.toLowerCase();
    if (query.includes("select id from accounts")) return { id: "account-1" } as T;
    if (query.includes("from abuse_flags")) return null;
    if (query.includes("select coalesce(sum(-delta)")) return { spent: 0 } as T;
    if (query.includes("select balance from wallets")) return { balance: this.database.balance } as T;
    if (query.includes("select balance, lifetime_granted")) {
      return {
        balance: this.database.balance,
        lifetime_granted: 50,
        lifetime_spent: this.database.lifetimeSpent,
        last_granted_at: null,
        claimable: 0,
      } as T;
    }
    return null;
  }

  async all<T>(): Promise<{ results: T[]; success: boolean }> {
    return { results: [], success: true };
  }
}

class CollaborationDatabase {
  balance: number;
  lifetimeSpent = 0;
  readonly sessions = new Map<string, Record<string, unknown>>();
  readonly ledger: Array<{ delta: number; reason: string }> = [];
  readonly usageEvents: string[] = [];

  constructor(balance: number) {
    this.balance = balance;
  }

  prepare(sql: string) {
    return new CollaborationStatement(sql, this);
  }

  async batch(statements: CollaborationStatement[]): Promise<D1Result[]> {
    let previousChanges = false;
    const results: D1Result[] = [];
    for (const statement of statements) {
      const query = statement.sql.toLowerCase();
      let changes = 0;
      if (query.startsWith("update wallets")) {
        const cost = Number(statement.values[0]);
        if (this.balance >= cost) {
          this.balance -= cost;
          this.lifetimeSpent += cost;
          changes = 1;
        }
      } else if (query.includes("insert into collaboration_sessions") && previousChanges) {
        const [id, accountId, projectName, objectKey, createdAt, lastActivity, expiresAt, viewOnly] =
          statement.values;
        this.sessions.set(String(id), {
          id,
          accountId,
          projectName,
          objectKey,
          createdAt,
          lastActivity,
          expiresAt,
          viewOnly,
        });
        changes = 1;
      } else if (query.includes("insert into ledger") && previousChanges) {
        this.ledger.push({
          delta: -Number(statement.values[2]),
          reason: "action:collaboration",
        });
        changes = 1;
      } else if (query.includes("insert into usage_events") && previousChanges) {
        const eventType = statement.sql.match(/select \?, \?, '([^']+)'/i)?.[1];
        if (eventType) this.usageEvents.push(eventType);
        changes = 1;
      }
      results.push({ success: true, meta: { changes } } as D1Result);
      previousChanges = changes === 1;
    }
    return results;
  }
}

async function runSessionAction(database: CollaborationDatabase, viewOnly: boolean) {
  const now = Math.floor(Date.now() / 1000);
  const token = await signJwt(
    { accountId: "account-1", deviceId: "device-1", iat: now, exp: now + 3600 },
    secret,
  );
  const assets = new Map<string, string>();
  const cache = new Map<string, string>();
  const project = createEmptyProject("Realtime prototype");
  const response = await app.request(
    "/action/run",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        type: "collaboration_session",
        payload: {
          projectJson: JSON.stringify(project),
          projectName: project.name,
          viewOnly,
        },
      }),
    },
    {
      DB: database as unknown as D1Database,
      CACHE: {
        get: async (key: string) => cache.get(key) ?? null,
        put: async (key: string, value: string) => { cache.set(key, value); },
        delete: async (key: string) => { cache.delete(key); },
      } as unknown as KVNamespace,
      ASSETS: {
        put: async (key: string, value: string) => { assets.set(key, value); },
        delete: async (key: string) => { assets.delete(key); },
      } as unknown as R2Bucket,
      JWT_SECRET: secret,
      ALLOWED_ORIGINS: "",
    } satisfies WorkerEnv,
  );
  return { response, assets };
}

describe("metered collaboration sessions", () => {
  it("creates an unguessable room, stores its starting project, and charges one credit", async () => {
    const database = new CollaborationDatabase(50);
    const { response, assets } = await runSessionAction(database, true);

    expect(response.status).toBe(200);
    const result = await response.json() as {
      success: boolean;
      type: string;
      result: { id: string; viewOnly: boolean };
      wallet: { balance: number };
    };
    expect(result).toMatchObject({
      success: true,
      type: "collaboration_session",
      wallet: { balance: 49 },
      result: { viewOnly: true },
    });
    expect(result.result.id).toMatch(/^[A-Za-z0-9_-]{24}$/);
    expect(database.sessions.size).toBe(1);
    expect(database.ledger).toEqual([{ delta: -1, reason: "action:collaboration" }]);
    expect(database.usageEvents).toEqual(["collaboration_session"]);
    expect([...assets.keys()]).toEqual([`collaboration/${result.result.id}/initial.json`]);
    expect(JSON.parse(assets.get(`collaboration/${result.result.id}/initial.json`)!).name)
      .toBe("Realtime prototype");
  });

  it("does not create or charge a session when the wallet is empty", async () => {
    const database = new CollaborationDatabase(0);
    const { response, assets } = await runSessionAction(database, false);

    expect(response.status).toBe(402);
    expect(await response.json()).toMatchObject({
      error: { code: "INSUFFICIENT_BALANCE" },
      balance: 0,
      required: 1,
    });
    expect(database.sessions.size).toBe(0);
    expect(database.ledger).toEqual([]);
    expect(assets.size).toBe(0);
  });

  it("rejects malformed session projects without charging", async () => {
    const database = new CollaborationDatabase(50);
    const now = Math.floor(Date.now() / 1000);
    const token = await signJwt(
      { accountId: "account-1", deviceId: "device-1", iat: now, exp: now + 3600 },
      secret,
    );
    const cache = new Map<string, string>();
    const response = await app.request(
      "/action/run",
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "collaboration_session",
          payload: { projectJson: "{", projectName: "Bad project", viewOnly: false },
        }),
      },
      {
        DB: database as unknown as D1Database,
        CACHE: {
          get: async (key: string) => cache.get(key) ?? null,
          put: async (key: string, value: string) => { cache.set(key, value); },
          delete: async (key: string) => { cache.delete(key); },
        } as unknown as KVNamespace,
        ASSETS: {} as R2Bucket,
        JWT_SECRET: secret,
        ALLOWED_ORIGINS: "",
      } satisfies WorkerEnv,
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "INVALID_PAYLOAD" } });
    expect(database.balance).toBe(50);
    expect(database.sessions.size).toBe(0);
  });
});

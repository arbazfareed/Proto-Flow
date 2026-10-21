import { afterEach, describe, expect, it, vi } from "vitest";
import { signJwt } from "../src/auth";
import { app } from "../src";
import type { WorkerEnv } from "../src/env";

const secret = "test-secret-that-is-long-enough-for-hmac-validation";

afterEach(() => vi.useRealTimers());

class ActionTestDatabase {
  reads = 0;
  balance: number | null;
  readonly cache = new Map<string, string>();

  constructor(balance: number | null) {
    this.balance = balance;
  }

  prepare(sql: string) {
    const statement: {
      bind: (...values: unknown[]) => typeof statement;
      first: <T>() => Promise<T | null>;
    } = {
      bind: (..._values: unknown[]) => statement,
      first: async <T>() => {
        const normalized = sql.toLowerCase();
        if (normalized.includes("select id from accounts")) {
          return { id: "account-1" } as T;
        }
        if (normalized.includes("from abuse_flags")) return null;
        this.reads += 1;
        if (!normalized.includes("select balance from wallets") || this.balance === null) {
          return null;
        }
        return { balance: this.balance } as T;
      },
    };
    return statement;
  }
}

async function authorizedRequest(
  database: ActionTestDatabase,
  body: string,
) {
  const now = Math.floor(Date.now() / 1000);
  const token = await signJwt(
    { accountId: "account-1", deviceId: "device-1", iat: now, exp: now + 3600 },
    secret,
  );
  return app.request(
    "/action/run",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body,
    },
    {
      DB: database as unknown as D1Database,
      CACHE: {
        get: async (key: string) => database.cache.get(key) ?? null,
        put: async (key: string, value: string) => {
          database.cache.set(key, value);
        },
        delete: async (key: string) => {
          database.cache.delete(key);
        },
      } as unknown as KVNamespace,
      ASSETS: {} as R2Bucket,
      JWT_SECRET: secret,
      ALLOWED_ORIGINS: "",
    } satisfies WorkerEnv,
  );
}

describe("metered action dispatcher", () => {
  it("rejects client-supplied costs and invalid action payloads", async () => {
    const database = new ActionTestDatabase(50);
    const response = await authorizedRequest(
      database,
      JSON.stringify({
        type: "ai_interaction_generator",
        payload: {},
        cost: 0,
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: "INVALID_PAYLOAD" },
    });
    expect(database.reads).toBe(0);
  });

  it("applies the server-owned cost when checking for sufficient balance", async () => {
    const database = new ActionTestDatabase(1);
    const response = await authorizedRequest(
      database,
      JSON.stringify({
        type: "cloud_preview_publish",
        payload: { projectId: "project-1" },
      }),
    );

    expect(response.status).toBe(402);
    expect(await response.json()).toMatchObject({
      error: { code: "INSUFFICIENT_BALANCE" },
      balance: 1,
      required: 2,
    });
  });

  it("rejects malformed export requests without deducting credits", async () => {
    const database = new ActionTestDatabase(10);
    const response = await authorizedRequest(
      database,
      JSON.stringify({
        type: "react_tailwind_code_export",
        payload: { projectId: "project-1" },
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: "INVALID_PAYLOAD" },
    });
    expect(database.balance).toBe(10);
    expect(database.reads).toBe(2);
  });

  it("limits AI dispatch to 30 calls per device per minute", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-20T12:00:00.000Z"));
    const database = new ActionTestDatabase(50);
    const request = () =>
      authorizedRequest(
        database,
        JSON.stringify({ type: "ai_interaction_generator", payload: {} }),
      );
    let response: Response | undefined;
    for (let attempt = 0; attempt < 31; attempt += 1) response = await request();

    expect(response?.status).toBe(429);
    expect(response?.headers.get("X-RateLimit-Limit")).toBe("30");
    expect(response?.headers.get("X-RateLimit-Remaining")).toBe("0");
    expect(await response?.json()).toMatchObject({ error: { code: "RATE_LIMITED" } });
  });

  it("limits code exports to ten requests per device per hour", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-21T12:00:00.000Z"));
    const database = new ActionTestDatabase(50);
    const request = () =>
      authorizedRequest(
        database,
        JSON.stringify({ type: "react_tailwind_code_export", payload: {} }),
      );
    let response: Response | undefined;
    for (let attempt = 0; attempt < 11; attempt += 1) response = await request();

    expect(response?.status).toBe(429);
    expect(response?.headers.get("X-RateLimit-Limit")).toBe("10");
    expect(await response?.json()).toMatchObject({ error: { code: "RATE_LIMITED" } });
  });

  it("rejects unknown actions and non-JSON bodies", async () => {
    const database = new ActionTestDatabase(10);
    const unsupported = await authorizedRequest(
      database,
      JSON.stringify({ type: "free_action", payload: {} }),
    );
    const malformed = await authorizedRequest(database, "{");

    expect(unsupported.status).toBe(400);
    expect(malformed.status).toBe(400);
    expect(database.reads).toBe(0);
  });
});

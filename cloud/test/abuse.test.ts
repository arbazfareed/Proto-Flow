import { afterEach, describe, expect, it, vi } from "vitest";
import { signJwt } from "../src/auth";
import { app } from "../src";
import type { WorkerEnv } from "../src/env";

const secret = "test-secret-that-is-long-enough-for-hmac-validation";

class AbuseTestDatabase {
  flag: { id: string; scope: "account" | "ip"; scope_key: string; mode: "challenge" | "read_only"; reason: string } | null;

  constructor(mode: "challenge" | "read_only") {
    this.flag = {
      id: "flag-1",
      scope: "account",
      scope_key: "account-1",
      mode,
      reason: "test-abuse",
    };
  }

  prepare(sql: string) {
    let parameters: unknown[] = [];
    const statement = {
      bind(...values: unknown[]) {
        parameters = values;
        return statement;
      },
      async first<T>() {
        const normalized = sql.toLowerCase();
        if (normalized.includes("select id from accounts")) return { id: parameters[0] } as T;
        if (normalized.includes("from abuse_flags")) return thisDatabase.flag as T | null;
        return null;
      },
    };
    const thisDatabase = this;
    return statement;
  }
}

async function authorizedRequest(
  database: AbuseTestDatabase,
  mode: "challenge" | "read_only",
  turnstileToken?: string,
  cache = new Map<string, string>(),
  failCache = false,
  body: unknown = {},
) {
  const now = Math.floor(Date.now() / 1000);
  const token = await signJwt(
    { accountId: "account-1", deviceId: "device-1", iat: now, exp: now + 3600 },
    secret,
  );
  const environment: WorkerEnv = {
    DB: database as unknown as D1Database,
    CACHE: {
      get: async (key: string) => {
        if (failCache) throw new Error("Simulated KV outage.");
        return cache.get(key) ?? null;
      },
      put: async (key: string, value: string) => {
        cache.set(key, value);
      },
      delete: async (key: string) => {
        cache.delete(key);
      },
    } as unknown as KVNamespace,
    ASSETS: {} as R2Bucket,
    JWT_SECRET: secret,
    TURNSTILE_SECRET_KEY: mode === "challenge" ? "turnstile-secret" : undefined,
    ALLOWED_ORIGINS: "",
  };
  return app.request(
    "/action/run",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...(turnstileToken ? { "X-Turnstile-Token": turnstileToken } : {}),
      },
      body: JSON.stringify(body),
    },
    environment,
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("abuse controls", () => {
  it("requires a valid Turnstile token for flagged accounts and caches verification", async () => {
    const database = new AbuseTestDatabase("challenge");
    const cache = new Map<string, string>();
    const withoutToken = await authorizedRequest(database, "challenge", undefined, cache);
    expect(withoutToken.status).toBe(403);
    expect(await withoutToken.json()).toMatchObject({
      error: { code: "TURNSTILE_REQUIRED" },
    });

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
    const verified = await authorizedRequest(database, "challenge", "valid-token", cache);
    expect(verified.status).toBe(400);
    expect(await verified.json()).toMatchObject({
      error: { code: "INVALID_PAYLOAD" },
    });
    expect([...cache.values()]).toContain("verified");

    const cachedVerification = await authorizedRequest(database, "challenge", undefined, cache);
    expect(cachedVerification.status).toBe(400);
  });

  it("blocks mutations for accounts escalated to temporary read-only mode", async () => {
    const database = new AbuseTestDatabase("read_only");
    const response = await authorizedRequest(database, "read_only");

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      error: { code: "READ_ONLY" },
    });
  });

  it("fails closed when KV rate-limit storage is unavailable", async () => {
    const database = new AbuseTestDatabase("challenge");
    database.flag = null;
    const response = await authorizedRequest(
      database,
      "challenge",
      undefined,
      new Map(),
      true,
      { type: "cloud_preview_publish", payload: {} },
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      error: { code: "RATE_LIMIT_UNAVAILABLE" },
    });
  });
});

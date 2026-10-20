import { afterEach, describe, expect, it, vi } from "vitest";
import { runOperationalAlerts } from "../src/admin";
import type { WorkerEnv } from "../src/env";

class AlertDatabase {
  prepare(sql: string) {
    const normalized = sql.toLowerCase();
    const statement = {
      bind: (..._values: unknown[]) => statement,
      first: async <T>() => {
        if (normalized.includes("count(*) as count from accounts")) return { count: 100 } as T;
        if (normalized.includes("avg(daily_count)")) return { average: 5 } as T;
        if (normalized.includes("sum(coalesce(json_extract(metadata_json, '$.inputtokens')")) {
          return { input_tokens: 1_000_000, output_tokens: 0, calls: 12 } as T;
        }
        return null;
      },
      all: async <T>() => ({
        success: true,
        results: normalized.includes("having sum(-delta) >= 500")
          ? [{ account_id: "account-high-spend", spent: 600 }] as T[]
          : [] as T[],
      } as D1Result<T>),
    };
    return statement;
  }
}

function environment(cache: Map<string, string>): WorkerEnv {
  return {
    DB: new AlertDatabase() as unknown as D1Database,
    CACHE: {
      get: async (key: string) => cache.get(key) ?? null,
      put: async (key: string, value: string) => { cache.set(key, value); },
      delete: async (key: string) => { cache.delete(key); },
    } as unknown as KVNamespace,
    ASSETS: {} as R2Bucket,
    ADMIN_ALERT_EMAIL: "ops@example.test",
    ADMIN_ALERT_WEBHOOK_URL: "https://hooks.example.test/ops",
    ADMIN_AI_COST_THRESHOLD_USD: "0.05",
    GEMINI_INPUT_USD_PER_MILLION: "0.10",
    RESEND_API_KEY: "test-resend-key",
    AUTH_EMAIL_FROM: "alerts@example.test",
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("admin operational alerts", () => {
  it("sends signup, AI cost, and high-spend alerts once and deduplicates them", async () => {
    const calls: Array<{ url: string; body: string }> = [];
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (input: string | URL, init?: RequestInit) => {
      calls.push({ url: String(input), body: String(init?.body ?? "") });
      return new Response("{}", { status: 200 });
    }));
    const cache = new Map<string, string>();
    const env = environment(cache);

    await runOperationalAlerts(env);
    expect(calls).toHaveLength(6);
    expect(calls.filter((call) => call.url === "https://hooks.example.test/ops")).toHaveLength(3);
    expect(calls.filter((call) => call.url === "https://api.resend.com/emails")).toHaveLength(3);
    expect(calls.some((call) => call.body.includes("signup anomaly"))).toBe(true);
    expect(calls.some((call) => call.body.includes("AI cost threshold exceeded"))).toBe(true);
    expect(calls.some((call) => call.body.includes("account-high-spend"))).toBe(true);
    expect([...cache.keys()].filter((key) => key.startsWith("admin-alert:"))).toHaveLength(3);

    await runOperationalAlerts(env);
    expect(calls).toHaveLength(6);
  });

  it("does not send alerts without a configured destination", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const env = environment(new Map());
    env.ADMIN_ALERT_EMAIL = undefined;
    env.ADMIN_ALERT_WEBHOOK_URL = undefined;
    await runOperationalAlerts(env);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

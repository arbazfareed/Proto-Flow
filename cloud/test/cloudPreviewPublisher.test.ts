import { afterEach, describe, expect, it, vi } from "vitest";
import { signJwt } from "../src/auth";
import { app } from "../src";
import type { WorkerEnv } from "../src/env";
import { createEmptyProject } from "../../src/project/schema";
import { encodeProjectForCodeExport } from "../../src/preview/codeExport";

const secret = "test-secret-that-is-long-enough-for-hmac-validation";
const bundle = "<!doctype html><html><head></head><body><script>document.body.textContent='preview'</script></body></html>";

interface PreviewRow {
  id: string;
  account_id: string;
  project_name: string;
  object_key: string;
  created_at: string;
  expires_at: string;
  size_bytes: number;
  view_count: number;
}

class PreviewStatement {
  values: unknown[] = [];

  constructor(readonly sql: string, private readonly database: PreviewDatabase) {}

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
    if (query.includes("from published_previews")) {
      const row = this.database.previews.get(String(this.values[0]));
      if (!row) return null;
      if (query.includes("account_id = ?") && row.account_id !== this.values[1]) return null;
      return row as T;
    }
    return null;
  }

  async all<T>(): Promise<{ results: T[]; success: boolean }> {
    const query = this.sql.toLowerCase();
    if (query.includes("from published_previews")) {
      const [accountId, now] = this.values as [string, string];
      return {
        results: [...this.database.previews.values()]
          .filter((row) => row.account_id === accountId && row.expires_at > now)
          .sort((left, right) => right.created_at.localeCompare(left.created_at))
          .slice(0, 50) as T[],
        success: true,
      };
    }
    return { results: [], success: true };
  }

  async run(): Promise<D1Result> {
    const query = this.sql.toLowerCase();
    if (query.includes("update published_previews set view_count")) {
      const row = this.database.previews.get(String(this.values[0]));
      if (row && row.expires_at > String(this.values[1])) {
        row.view_count += 1;
        return { success: true, meta: { changes: 1 } } as D1Result;
      }
      return { success: true, meta: { changes: 0 } } as D1Result;
    }
    if (query.startsWith("delete from published_previews")) {
      const row = this.database.previews.get(String(this.values[0]));
      if (row && row.account_id === this.values[1]) {
        this.database.previews.delete(row.id);
        return { success: true, meta: { changes: 1 } } as D1Result;
      }
    }
    return { success: true, meta: { changes: 1 } } as D1Result;
  }
}

class PreviewDatabase {
  balance = 50;
  lifetimeSpent = 0;
  failBatch = false;
  readonly previews = new Map<string, PreviewRow>();
  readonly ledger: Array<{ delta: number; reason: string; metadata_json: string }> = [];
  readonly usage: Array<{ event_type: string; metadata_json: string }> = [];
  readonly cache = new Map<string, string>();

  prepare(sql: string) {
    return new PreviewStatement(sql, this);
  }

  async batch(statements: PreviewStatement[]): Promise<D1Result[]> {
    if (this.failBatch) throw new Error("D1 unavailable");
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
      } else if (query.includes("insert into published_previews") && previousChanges) {
        const [id, accountId, projectName, objectKey, createdAt, expiresAt, sizeBytes] = statement.values;
        this.previews.set(String(id), {
          id: String(id),
          account_id: String(accountId),
          project_name: String(projectName),
          object_key: String(objectKey),
          created_at: String(createdAt),
          expires_at: String(expiresAt),
          size_bytes: Number(sizeBytes),
          view_count: 0,
        });
        changes = 1;
      } else if (query.includes("insert into ledger") && previousChanges) {
        this.ledger.push({
          delta: -Number(statement.values[2]),
          reason: query.includes("action:code_export") ? "action:code_export" : "action:cloud_publish",
          metadata_json: String(statement.values[3]),
        });
        changes = 1;
      } else if (query.includes("insert into usage_events") && previousChanges) {
        this.usage.push({
          event_type: query.includes("'code_export'") ? "code_export" : "cloud_publish",
          metadata_json: String(statement.values[2]),
        });
        changes = 1;
      }
      previousChanges = changes === 1;
      results.push({ success: true, meta: { changes } } as D1Result);
    }
    return results;
  }
}

class PreviewAssets {
  readonly objects = new Map<string, string>();
  failPut = false;

  async put(key: string, value: string | ArrayBuffer | ArrayBufferView | ReadableStream) {
    if (this.failPut) throw new Error("R2 unavailable");
    this.objects.set(key, typeof value === "string" ? value : String(value));
    return {} as R2Object;
  }

  async get(key: string) {
    const value = this.objects.get(key);
    return value === undefined ? null : { text: async () => value } as unknown as R2ObjectBody;
  }

  async delete(key: string) {
    this.objects.delete(key);
  }
}

function makeEnv(database: PreviewDatabase, assets: PreviewAssets) {
  const cache = database.cache;
  const env = {
    DB: database as unknown as D1Database,
    CACHE: {
      get: async (key: string) => cache.get(key) ?? null,
      put: async (key: string, value: string) => { cache.set(key, value); },
      delete: async (key: string) => { cache.delete(key); },
    } as unknown as KVNamespace,
    ASSETS: assets as unknown as R2Bucket,
    JWT_SECRET: secret,
    PREVIEW_PUBLIC_BASE_URL: "https://protoflow.link",
    ALLOWED_ORIGINS: "",
  } satisfies WorkerEnv;
  return { env, cache };
}

async function request(
  database: PreviewDatabase,
  assets: PreviewAssets,
  path: string,
  options: { method?: string; payload?: unknown; accountId?: string } = {},
) {
  const now = Math.floor(Date.now() / 1000);
  const token = await signJwt(
    { accountId: options.accountId ?? "account-1", deviceId: "device-1", iat: now, exp: now + 3600 },
    secret,
  );
  const { env } = makeEnv(database, assets);
  return app.request(
    path,
    {
      method: options.method ?? "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: options.payload === undefined ? undefined : JSON.stringify(options.payload),
    },
    env,
  );
}

async function publish(database: PreviewDatabase, assets: PreviewAssets, html = bundle) {
  return request(database, assets, "/action/run", {
    payload: {
      type: "cloud_preview_publish",
      payload: { bundle: html, projectName: "Checkout prototype" },
    },
  });
}

afterEach(() => {
  vi.useRealTimers();
});

describe("metered cloud preview publishing", () => {
  it("uploads a sandboxed 30-day preview and charges two credits only after storage succeeds", async () => {
    const database = new PreviewDatabase();
    const assets = new PreviewAssets();
    const response = await publish(database, assets);
    const body = await response.json() as {
      result: { id: string; url: string; expiresAt: string; sizeBytes: number };
      wallet: { balance: number; lifetimeSpent: number };
    };

    expect(response.status).toBe(200);
    expect(body.result.id).toMatch(/^[A-Za-z0-9]{8}$/);
    expect(body.result.url).toBe(`https://protoflow.link/p/${body.result.id}`);
    expect(Date.parse(body.result.expiresAt) - Date.parse(database.previews.get(body.result.id)!.created_at))
      .toBe(30 * 24 * 60 * 60 * 1000);
    expect(body.result.sizeBytes).toBe(new TextEncoder().encode(bundle).byteLength);
    expect(body.wallet).toMatchObject({ balance: 48, lifetimeSpent: 2 });
    expect(database.ledger).toHaveLength(1);
    expect(database.ledger[0]).toMatchObject({ delta: -2, reason: "action:cloud_publish" });
    expect(database.usage).toEqual([{
      event_type: "cloud_publish",
      metadata_json: JSON.stringify({ assetBytes: body.result.sizeBytes }),
    }]);
    expect(assets.objects.get(`previews/${body.result.id}/index.html`)).toBe(bundle);

    const { env } = makeEnv(database, assets);
    expect(database.cache.get(`short:${body.result.id}`)).toBe(`previews/${body.result.id}/index.html`);
    const mapping = `previews/${body.result.id}/index.html`;
    expect(mapping).toBe(database.cache.get(`short:${body.result.id}`));
    const published = await app.request(`/p/${body.result.id}`, {}, env);
    const document = await published.text();
    expect(published.status).toBe(200);
    expect(published.headers.get("Content-Security-Policy")).toContain("sandbox allow-scripts");
    expect(published.headers.get("Content-Security-Policy")).toContain("connect-src 'none'");
    expect(document).toContain('sandbox="allow-scripts"');
    expect(document).not.toContain("allow-same-origin");
    expect(database.previews.get(body.result.id)?.view_count).toBe(1);
  });

  describe("metered React code export", () => {
    const exportOptions = {
      scope: "all",
      includeInteractions: true,
      includeVariables: true,
      includeAssets: true,
      responsive: false,
      tailwindVersion: "4",
    };

    it("generates a ZIP and charges three credits only after generation succeeds", async () => {
      const database = new PreviewDatabase();
      const assets = new PreviewAssets();
      const project = createEmptyProject("Checkout");
      const response = await request(database, assets, "/action/run", {
        payload: {
          type: "react_tailwind_code_export",
          payload: {
            projectJson: encodeProjectForCodeExport(project),
            options: exportOptions,
          },
        },
      });
      const body = await response.json() as {
        result: { fileName: string; zipBase64: string; sizeBytes: number };
        wallet: { balance: number; lifetimeSpent: number };
      };

      expect(response.status).toBe(200);
      expect(body.result).toMatchObject({ fileName: "checkout-react-export.zip" });
      expect(body.result.zipBase64).toMatch(/^[A-Za-z0-9+/]+=*$/);
      expect(body.result.sizeBytes).toBeGreaterThan(0);
      expect(body.wallet).toMatchObject({ balance: 47, lifetimeSpent: 3 });
      expect(database.ledger).toMatchObject([{ delta: -3, reason: "action:code_export" }]);
      expect(database.usage[0]?.event_type).toBe("code_export");
    });

    it("rejects invalid projects and does not charge when the wallet changed", async () => {
      const database = new PreviewDatabase();
      const assets = new PreviewAssets();
      const invalidProject = await request(database, assets, "/action/run", {
        payload: {
          type: "react_tailwind_code_export",
          payload: { projectJson: "invalid", options: exportOptions },
        },
      });
      expect(invalidProject.status).toBe(400);
      expect(database.balance).toBe(50);
      expect(database.ledger).toHaveLength(0);

      database.balance = 2;
      const insufficient = await request(database, assets, "/action/run", {
        payload: {
          type: "react_tailwind_code_export",
          payload: {
            projectJson: encodeProjectForCodeExport(createEmptyProject("Needs credits")),
            options: exportOptions,
          },
        },
      });
      expect(insufficient.status).toBe(402);
      expect(database.balance).toBe(2);
      expect(database.ledger).toHaveLength(0);
    });
  });

  it("does not charge if R2 or the atomic D1 charge transaction fails", async () => {
    const storageFailureDb = new PreviewDatabase();
    const failingAssets = new PreviewAssets();
    failingAssets.failPut = true;
    const storageResponse = await publish(storageFailureDb, failingAssets);
    expect(storageResponse.status).toBe(503);
    expect(await storageResponse.json()).toMatchObject({
      error: { code: "PREVIEW_PUBLISH_FAILED" },
    });
    expect(storageFailureDb.balance).toBe(50);
    expect(storageFailureDb.ledger).toHaveLength(0);

    const databaseFailure = new PreviewDatabase();
    databaseFailure.failBatch = true;
    const assets = new PreviewAssets();
    const failedCharge = await publish(databaseFailure, assets);
    expect(failedCharge.status).toBe(503);
    expect(databaseFailure.balance).toBe(50);
    expect(databaseFailure.ledger).toHaveLength(0);
    expect(assets.objects).toHaveLength(0);
  });

  it("rejects oversized bundles without upload or charge", async () => {
    const database = new PreviewDatabase();
    const assets = new PreviewAssets();
    const oversized = `<!doctype html><html>${"x".repeat(10 * 1024 * 1024)}</html>`;
    const response = await publish(database, assets, oversized);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "INVALID_PAYLOAD" } });
    expect(database.balance).toBe(50);
    expect(assets.objects).toHaveLength(0);
  });

  it("serves history, denies unpublishing another account's link, then removes owned storage", async () => {
    const database = new PreviewDatabase();
    const assets = new PreviewAssets();
    const publishResponse = await publish(database, assets);
    const published = await publishResponse.json() as { result: { id: string } };
    const { env, cache } = makeEnv(database, assets);
    const objectKey = `previews/${published.result.id}/index.html`;
    cache.set(`short:${published.result.id}`, objectKey);

    const history = await request(database, assets, "/previews", { method: "GET" });
    expect(await history.json()).toMatchObject({
      previews: [{ id: published.result.id, projectName: "Checkout prototype", viewCount: 0 }],
    });

    const foreignDelete = await request(
      database,
      assets,
      `/previews/${published.result.id}`,
      { method: "DELETE", accountId: "another-account" },
    );
    expect(foreignDelete.status).toBe(404);
    expect(assets.objects.has(objectKey)).toBe(true);

    const token = await signJwt({
      accountId: "account-1",
      deviceId: "device-1",
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
    }, secret);
    const deleted = await app.request(`/previews/${published.result.id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    }, env);
    expect(deleted.status).toBe(200);
    expect(await deleted.json()).toEqual({ success: true });
    expect(assets.objects.has(objectKey)).toBe(false);
    expect(cache.has(`short:${published.result.id}`)).toBe(false);
    expect(database.previews.has(published.result.id)).toBe(false);
    expect(database.balance).toBe(48);
  });

  it("limits publish requests to ten per device per hour", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-21T12:15:00.000Z"));
    const database = new PreviewDatabase();
    const assets = new PreviewAssets();
    let lastResponse: Response | undefined;
    for (let attempt = 0; attempt < 11; attempt += 1) {
      lastResponse = await publish(database, assets);
    }
    expect(lastResponse?.status).toBe(429);
    expect(lastResponse?.headers.get("X-RateLimit-Limit")).toBe("10");
  });
});

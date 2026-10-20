import { afterEach, describe, expect, it, vi } from "vitest";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { app } from "../src";
import type { WorkerEnv } from "../src/env";

let teamDomain = "https://pf-t310-test.cloudflareaccess.com";
const audience = "admin-application-audience";
const allowedEmail = "maintainer@example.test";

class AdminTestDatabase {
  balance = 70;
  ledger: Array<{ delta: number; reason: string; metadata_json: string }> = [];
  audit: Array<{ actor: string; action: string; details: string }> = [];
  private previousChanges = 0;

  prepare(sql: string) {
    let parameters: unknown[] = [];
    const statement = {
      bind: (...values: unknown[]) => {
        parameters = values;
        return statement;
      },
      run: async () => this.execute(sql, parameters),
      first: async <T>() => {
        if (sql.toLowerCase().includes("select balance from wallets")) {
          return { balance: this.balance } as T;
        }
        return null;
      },
      all: async <T>() => ({ results: [] as T[], success: true, meta: { changes: 0 } } as D1Result<T>),
    };
    return statement;
  }

  async batch(statements: Array<ReturnType<AdminTestDatabase["prepare"]>>) {
    const results: D1Result[] = [];
    for (const statement of statements) results.push(await statement.run());
    return results;
  }

  private execute(sql: string, parameters: unknown[]): D1Result {
    const normalized = sql.toLowerCase();
    let changes = 0;
    if (normalized.startsWith("update wallets set balance = balance +")) {
      const [delta, , , , , , accountId] = parameters as [number, number, number, number, number, string, string, number, number, number];
      if (accountId === "account-1" && this.balance + delta >= 0 && this.balance + delta <= 100) {
        this.balance += delta;
        changes = 1;
      }
    } else if (normalized.includes("insert into ledger") && normalized.includes("admin_adjust")) {
      if (normalized.includes("where changes() = 1") && this.previousChanges === 1) {
        const [, , delta] = parameters as [string, string, number, string];
        this.ledger.push({ delta, reason: "admin_adjust", metadata_json: "{}" });
        changes = 1;
      }
    } else if (normalized.includes("insert into admin_audit") && normalized.includes("credit_adjust")) {
      const [, actor, , details] = parameters as [string, string, string, string, string];
      if (this.previousChanges === 1) {
        this.audit.push({ actor, action: "credit_adjust", details });
        changes = 1;
      }
    }
    const result = { results: [], success: true, meta: { changes } } as unknown as D1Result;
    this.previousChanges = changes;
    return result;
  }
}

let privateKey: CryptoKey;
let publicJwk: Record<string, unknown>;

async function setupKeys() {
  teamDomain = `https://pf-t310-${crypto.randomUUID()}.cloudflareaccess.com`;
  const pair = await generateKeyPair("RS256");
  privateKey = pair.privateKey;
  publicJwk = {
    ...await exportJWK(pair.publicKey),
    kid: "pf-t310-key",
    alg: "RS256",
    use: "sig",
  };
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ keys: [publicJwk] }), {
      status: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=3600" },
    }),
  ));
}

async function accessToken(email: string, tokenAudience = audience): Promise<string> {
  return new SignJWT({ email })
    .setProtectedHeader({ alg: "RS256", kid: "pf-t310-key" })
    .setIssuer(teamDomain)
    .setAudience(tokenAudience)
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(privateKey);
}

function env(database = new AdminTestDatabase(), overrides: Partial<WorkerEnv> = {}): WorkerEnv {
  const values = new Map<string, string>();
  return {
    DB: database as unknown as D1Database,
    CACHE: {
      get: async (key: string) => values.get(key) ?? null,
      put: async (key: string, value: string) => { values.set(key, value); },
      delete: async (key: string) => { values.delete(key); },
    } as unknown as KVNamespace,
    ASSETS: {} as R2Bucket,
    JWT_SECRET: "test-secret-that-is-long-enough-for-admin-tests",
    ADMIN_ACCESS_TEAM_DOMAIN: teamDomain,
    ADMIN_ACCESS_AUD: audience,
    ADMIN_ALLOWED_EMAILS: allowedEmail,
    ALLOWED_ORIGINS: "",
    ...overrides,
  };
}

async function adminRequest(
  path: string,
  token?: string,
  options: { method?: string; body?: unknown; database?: AdminTestDatabase; env?: Partial<WorkerEnv> } = {},
) {
  return app.request(
    path,
    {
      method: options.method ?? "GET",
      headers: {
        ...(token ? { "Cf-Access-Jwt-Assertion": token } : {}),
        ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    },
    env(options.database, options.env),
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("Cloudflare Access admin gate", () => {
  it("fails closed when Access configuration or the signed assertion is missing", async () => {
    const unconfigured = await adminRequest("/admin/me", undefined, {
      env: { ADMIN_ACCESS_AUD: undefined, ADMIN_ALLOWED_EMAILS: undefined },
    });
    expect(unconfigured.status).toBe(503);
    expect(await unconfigured.json()).toMatchObject({ error: { code: "ADMIN_NOT_CONFIGURED" } });

    const missingToken = await adminRequest("/admin/me");
    expect(missingToken.status).toBe(401);
    expect(await missingToken.json()).toMatchObject({ error: { code: "ADMIN_ACCESS_REQUIRED" } });
  });

  it("checks the RS256 signature, team issuer, application audience, and exact email allowlist", async () => {
    await setupKeys();
    const deniedToken = await accessToken("other@example.test");
    const denied = await adminRequest("/admin/me", deniedToken);
    expect(denied.status).toBe(403);
    expect(await denied.json()).toMatchObject({ error: { code: "ADMIN_NOT_ALLOWED" } });

    const wrongAudience = await accessToken(allowedEmail, "another-app-audience");
    const invalid = await adminRequest("/admin/me", wrongAudience);
    expect(invalid.status).toBe(401);

    const validToken = await accessToken(allowedEmail);
    const accepted = await adminRequest("/admin/me", validToken);
    expect(accepted.status).toBe(200);
    expect(await accepted.json()).toEqual({ email: allowedEmail });
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      `${teamDomain}/cdn-cgi/access/certs`,
      expect.any(Object),
    );
  });

  it("applies a manual credit adjustment and records its ledger and audit entries", async () => {
    await setupKeys();
    const token = await accessToken(allowedEmail);
    const database = new AdminTestDatabase();
    const response = await adminRequest("/admin/accounts/account-1/adjust", token, {
      method: "POST",
      body: { delta: 25, reason: "Support correction" },
      database,
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ adjusted: true, balance: 95 });
    expect(database.ledger).toEqual([{ delta: 25, reason: "admin_adjust", metadata_json: "{}" }]);
    expect(database.audit).toHaveLength(1);
    expect(database.audit[0]).toMatchObject({ actor: allowedEmail, action: "credit_adjust" });
    expect(database.audit[0]?.details).toContain("Support correction");

    const overCap = await adminRequest("/admin/accounts/account-1/adjust", token, {
      method: "POST",
      body: { delta: 10, reason: "Must respect wallet cap" },
      database,
    });
    expect(overCap.status).toBe(409);
    expect(database.balance).toBe(95);
    expect(database.ledger).toHaveLength(1);
    expect(database.audit).toHaveLength(1);
  });
});

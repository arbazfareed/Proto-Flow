import { describe, expect, it } from "vitest";
import { app } from "../src";
import type { WorkerEnv } from "../src/env";

const secret = "test-secret-that-is-long-enough-for-hmac-validation";
const allowedOrigins = "tauri://localhost,https://tauri.localhost,http://localhost:1420";

function environment(overrides: Partial<WorkerEnv> = {}): WorkerEnv {
  return {
    DB: {} as D1Database,
    CACHE: {} as KVNamespace,
    ASSETS: {} as R2Bucket,
    JWT_SECRET: secret,
    ALLOWED_ORIGINS: allowedOrigins,
    ...overrides,
  };
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

async function signToken(
  claims: Record<string, unknown>,
  signingSecret = secret,
  algorithm = "HS256",
): Promise<string> {
  const header = base64Url(new TextEncoder().encode(JSON.stringify({ alg: algorithm, typ: "JWT" })));
  const payload = base64Url(new TextEncoder().encode(JSON.stringify(claims)));
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(signingSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${header}.${payload}`),
  );
  return `${header}.${payload}.${base64Url(new Uint8Array(signature))}`;
}

function validClaims(overrides: Record<string, unknown> = {}) {
  const now = Math.floor(Date.now() / 1000);
  return {
    accountId: "account-123",
    deviceId: "device-123",
    iat: now,
    exp: now + 3600,
    ...overrides,
  };
}

describe("Worker API gateway", () => {
  it("returns the health response", async () => {
    const response = await app.request("/health", {}, environment());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  });

  it("adds CORS headers for the configured Tauri origins", async () => {
    const response = await app.request(
      "/health",
      { headers: { Origin: "tauri://localhost" } },
      environment(),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("tauri://localhost");
    expect(response.headers.get("Vary")).toBe("Origin");
    expect(response.headers.get("X-RateLimit-Limit")).toBe("1000");
    expect(response.headers.get("X-RateLimit-Remaining")).toBe("1000");
    expect(response.headers.get("X-RateLimit-Reset")).toMatch(/^\d+$/);
    expect(response.headers.get("Access-Control-Expose-Headers")).toContain("Retry-After");
  });

  it("rejects disallowed origins and preflight requests", async () => {
    for (const method of ["GET", "OPTIONS"]) {
      const response = await app.request(
        "/health",
        { method, headers: { Origin: "https://attacker.example" } },
        environment(),
      );
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({
        error: {
          code: "ORIGIN_NOT_ALLOWED",
          message: "This origin is not allowed to access the API.",
        },
      });
      expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
    }
  });

  it("answers preflight requests from an allowed origin", async () => {
    const response = await app.request(
      "/wallet/me",
      {
        method: "OPTIONS",
        headers: {
          Origin: "https://tauri.localhost",
          "Access-Control-Request-Method": "GET",
        },
      },
      environment(),
    );
    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Methods")).toBe("GET, POST, DELETE, OPTIONS");
    expect(response.headers.get("Access-Control-Allow-Headers")).toContain("X-Turnstile-Token");
    expect(response.headers.get("Access-Control-Expose-Headers")).toContain("X-RateLimit-Remaining");
  });

  it("requires a bearer token for wallet, metered-action, and admin routes", async () => {
    const requests = [
      app.request("/wallet/me", {}, environment()),
      app.request("/wallet/claim-daily", { method: "POST" }, environment()),
      app.request("/action/run", { method: "POST" }, environment()),
      app.request("/admin/status", {}, environment()),
    ];
    for (const response of await Promise.all(requests)) {
      expect(response.status).toBe(401);
      expect(await response.json()).toMatchObject({
        error: { code: "MISSING_TOKEN" },
      });
    }
  });

  it("rejects tampered, expired, malformed, and non-HS256 tokens", async () => {
    const valid = await signToken(validClaims());
    const expired = await signToken(validClaims({ exp: Math.floor(Date.now() / 1000) - 1 }));
    const wrongAlgorithm = await signToken(validClaims(), secret, "none");
    const tampered = `${valid.slice(0, -1)}x`;

    for (const token of [tampered, expired, wrongAlgorithm, "not.a.jwt"]) {
      const response = await app.request(
        "/wallet/me",
        { headers: { Authorization: `Bearer ${token}` } },
        environment(),
      );
      expect(response.status).toBe(401);
      expect(await response.json()).toMatchObject({
        error: { code: "INVALID_TOKEN" },
      });
    }
  });

  it("verifies valid HS256 tokens before dispatching metered actions", async () => {
    const token = await signToken(validClaims());
    const response = await app.request(
      "/action/run",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ type: "ai_interaction_generator", payload: {} }),
      },
      environment(),
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      error: { code: "DATABASE_UNAVAILABLE" },
    });
  });

  it("fails clearly when the JWT secret is not configured", async () => {
    const response = await app.request(
      "/wallet/me",
      {},
      environment({ JWT_SECRET: undefined }),
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      error: { code: "SERVICE_NOT_CONFIGURED" },
    });
  });

  it("validates the device hash and installation ID before wallet provisioning", async () => {
    const response = await app.request(
      "/auth/anonymous",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceId: "hostname", installId: "not-a-uuid" }),
      },
      environment(),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: "BAD_REQUEST" },
    });
  });

  it("requires a configured signing secret before wallet provisioning", async () => {
    const response = await app.request(
      "/auth/anonymous",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deviceId: "a".repeat(64),
          installId: "123e4567-e89b-42d3-a456-426614174000",
        }),
      },
      environment({ JWT_SECRET: undefined }),
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      error: { code: "SERVICE_NOT_CONFIGURED" },
    });
  });

  it("requires authentication for account-linking endpoints", async () => {
    for (const path of [
      "/auth/email/start",
      "/auth/email/verify",
      "/auth/google/start",
      "/auth/google/verify",
      "/auth/sign-out",
    ]) {
      const response = await app.request(path, { method: "POST" }, environment());
      expect(response.status).toBe(401);
      expect(await response.json()).toMatchObject({
        error: { code: "MISSING_TOKEN" },
      });
    }
  });

  it("validates email sign-in inputs and reports missing provider configuration", async () => {
    const token = await signToken(validClaims());
    const database = {
      prepare(sql: string) {
        const statement = {
          bind() {
            return statement;
          },
          async first() {
            return sql.toLowerCase().includes("select id from accounts")
              ? { id: "account-123" }
              : null;
          },
        };
        return statement;
      },
    } as unknown as D1Database;
    const request = (body: unknown) =>
      app.request(
        "/auth/email/start",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        },
        environment({ DB: database }),
      );

    const invalid = await request({
      email: "not-an-email",
      accountId: "account-123",
      callbackUri: "protoflow://auth/verify",
    });
    expect(invalid.status).toBe(400);

    const unsafeCallback = await request({
      email: "person@example.com",
      accountId: "account-123",
      callbackUri: "https://tauri.localhost/?redirect=unsafe",
    });
    expect(unsafeCallback.status).toBe(400);

    const notConfigured = await request({
      email: "person@example.com",
      accountId: "account-123",
      callbackUri: "protoflow://auth/verify",
    });
    expect(notConfigured.status).toBe(503);
    expect(await notConfigured.json()).toMatchObject({
      error: { code: "SERVICE_NOT_CONFIGURED" },
    });
  });

  it("reports missing Google OAuth configuration without accepting arbitrary callbacks", async () => {
    const token = await signToken(validClaims());
    const database = {
      prepare(sql: string) {
        return {
          bind() {
            return this;
          },
          async first() {
            return sql.toLowerCase().includes("select id from accounts")
              ? { id: "account-123" }
              : null;
          },
        };
      },
    } as unknown as D1Database;
    const request = (callbackUri: string) =>
      app.request(
        "/auth/google/start",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ callbackUri }),
        },
        environment({ DB: database }),
      );

    const unsafe = await request("https://attacker.example/callback");
    expect(unsafe.status).toBe(400);
    const notConfigured = await request("protoflow://auth/google-callback");
    expect(notConfigured.status).toBe(503);
    expect(await notConfigured.json()).toMatchObject({
      error: { code: "SERVICE_NOT_CONFIGURED" },
    });
  });

  it("returns a consistent not-found error for unknown routes", async () => {
    const response = await app.request("/unknown", {}, environment());
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({
      error: { code: "NOT_FOUND" },
    });
  });
});

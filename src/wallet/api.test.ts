import { afterEach, describe, expect, it, vi } from "vitest";
import {
  canUseOfflineWallet,
  checkCloudHealth,
  claimDailyCredits,
  fetchWalletMe,
  getCachedWallet,
  provisionAnonymousWallet,
  resetWalletIdentity,
  runMeteredAction,
  WalletApiError,
  type WalletSnapshot,
} from "./api";

const now = 1_800_000_000_000;

function token(expiresAt: number): string {
  const payload = btoa(JSON.stringify({ exp: expiresAt }));
  return `header.${payload}.signature`;
}

function wallet(syncedAt: number): WalletSnapshot {
  return {
    accountId: "account-1",
    balance: 50,
    lifetimeGranted: 50,
    lifetimeSpent: 0,
    syncedAt,
    recentLedger: [],
    claimable: false,
    nextClaimAt: null,
  };
}

function stubStorage() {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
  vi.stubGlobal("sessionStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
  return values;
}

afterEach(() => vi.unstubAllGlobals());

describe("offline wallet grace", () => {
  it("allows a fresh cached balance for offline display", () => {
    expect(canUseOfflineWallet(wallet(now - 60_000), now)).toBe(true);
  });

  it("allows display-only cached balance without a usable token", () => {
    expect(canUseOfflineWallet(wallet(now - 60_000), now)).toBe(true);
  });

  it("rejects a balance cache older than 24 hours or dated in the future", () => {
    const oneDay = 24 * 60 * 60 * 1000;
    expect(canUseOfflineWallet(wallet(now - oneDay - 1), now)).toBe(false);
    expect(canUseOfflineWallet(wallet(now + 1), now)).toBe(false);
  });
});

describe("wallet persistence", () => {
  it("reads cached wallet data written by the earlier wallet version", () => {
    const values = stubStorage();
    values.set(
      "protoflow.wallet.cache",
      JSON.stringify({
        accountId: "account-1",
        balance: 50,
        lifetimeGranted: 50,
        lifetimeSpent: 0,
        syncedAt: now - 60_000,
      }),
    );

    expect(getCachedWallet()).toMatchObject({
      accountId: "account-1",
      balance: 50,
      recentLedger: [],
      claimable: false,
      nextClaimAt: null,
      syncedAt: now - 60_000,
    });
  });

  it("clears the prior JWT and wallet cache when resetting to a new identity", async () => {
    const values = stubStorage();
    values.set("protoflow.wallet.install-id", "old-install-id");
    values.set("protoflow.wallet.jwt", "old-token");
    values.set("protoflow.wallet.cache", JSON.stringify(wallet(now)));

    const identity = await resetWalletIdentity();

    expect(identity.installId).not.toBe("old-install-id");
    expect(identity.deviceId).toHaveLength(64);
    expect(values.has("protoflow.wallet.jwt")).toBe(false);
    expect(values.has("protoflow.wallet.cache")).toBe(false);
    expect(values.get("protoflow.wallet.install-id")).toBe(identity.installId);
  });

  it("reports cloud health only for a successful health response", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: "ok" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: "degraded" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(checkCloudHealth()).resolves.toBe(true);
    await expect(checkCloudHealth()).resolves.toBe(false);
    await expect(checkCloudHealth()).resolves.toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://127.0.0.1:8790/health");
  });

  it("reads next refill timestamps and preserves server claim cooldown responses", async () => {
    const nextClaimAt = new Date(now + 24 * 60 * 60 * 1000).toISOString();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            accountId: "account-1",
            balance: 50,
            lifetimeGranted: 50,
            lifetimeSpent: 0,
            recentLedger: [],
            claimable: false,
            nextClaimAt,
            syncedAt: now,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: { code: "DAILY_ALREADY_CLAIMED", message: "Already claimed." },
            nextClaimAt,
            balance: 50,
          }),
          { status: 409, headers: { "Content-Type": "application/json" } },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    const snapshot = await fetchWalletMe("session-token");
    expect(snapshot.nextClaimAt).toBe(nextClaimAt);
    await expect(claimDailyCredits("session-token")).rejects.toMatchObject({
      code: "DAILY_ALREADY_CLAIMED",
      nextClaimAt,
      balance: 50,
    });
  });

  describe("metered action API", () => {
    it("sends action type and payload without a client-supplied cost", async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            success: true,
            type: "ai_interaction_generator",
            result: { prompt: "ready" },
            wallet: {
              accountId: "account-1",
              balance: 49,
              lifetimeGranted: 50,
              lifetimeSpent: 1,
              syncedAt: now,
              recentLedger: [{
                id: "ledger-1",
                delta: -1,
                reason: "ai_interaction_generator",
                metadata_json: "{}",
                created_at: new Date(now).toISOString(),
              }],
              claimable: false,
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
      vi.stubGlobal("fetch", fetchMock);

      const result = await runMeteredAction<{ prompt: string }>(
        "session-token",
        "ai_interaction_generator",
        { screenId: "screen-1" },
      );

      const [, request] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(JSON.parse(request.body as string)).toEqual({
        type: "ai_interaction_generator",
        payload: { screenId: "screen-1" },
      });
      expect(request.headers).toMatchObject({ Authorization: "Bearer session-token" });
      expect(result).toMatchObject({
        result: { prompt: "ready" },
        wallet: { balance: 49, lifetimeSpent: 1, recentLedger: [{ delta: -1 }] },
      });
    });

    it("surfaces insufficient balance and Retry-After responses as structured errors", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn()
          .mockResolvedValueOnce(
            new Response(
              JSON.stringify({ error: { code: "INSUFFICIENT_BALANCE", message: "Need credits." } }),
              { status: 402, headers: { "Content-Type": "application/json" } },
            ),
          )
          .mockResolvedValueOnce(
            new Response(
              JSON.stringify({ error: { code: "RATE_LIMITED", message: "Slow down." } }),
              { status: 429, headers: { "Content-Type": "application/json", "Retry-After": "17" } },
            ),
          ),
      );

      await expect(
        runMeteredAction("session-token", "cloud_preview_publish", { projectId: "project-1" }),
      ).rejects.toMatchObject<Partial<WalletApiError>>({ code: "INSUFFICIENT_BALANCE" });
      await expect(
        runMeteredAction("session-token", "cloud_preview_publish", { projectId: "project-1" }),
      ).rejects.toMatchObject<Partial<WalletApiError>>({
        code: "RATE_LIMITED",
        retryAfterSeconds: 17,
      });
    });

    it("rejects oversized and non-serializable payloads before making a request", async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);
      const cyclic: Record<string, unknown> = {};
      cyclic.self = cyclic;

      await expect(
        runMeteredAction("session-token", "react_tailwind_code_export", cyclic),
      ).rejects.toMatchObject<Partial<WalletApiError>>({ code: "INVALID_PAYLOAD" });
      await expect(
        runMeteredAction("session-token", "react_tailwind_code_export", { source: "x".repeat(70_000) }),
      ).rejects.toMatchObject<Partial<WalletApiError>>({ code: "INVALID_PAYLOAD" });
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  it("stores the JWT outside localStorage when provisioning a wallet", async () => {
    const values = stubStorage();
    const accessToken = token(Math.floor(Date.now() / 1000) + 3600);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            accountId: "account-1",
            token: accessToken,
            tokenExpiresAt: new Date(Date.now() + 3600_000).toISOString(),
            balance: 50,
            lifetimeGranted: 50,
            lifetimeSpent: 0,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );

    await provisionAnonymousWallet({
      deviceId: "a".repeat(64),
      installId: "123e4567-e89b-42d3-a456-426614174000",
    });

    expect(JSON.stringify(values.get("protoflow.wallet.cache"))).not.toContain(accessToken);
    expect(values.get("protoflow.wallet.jwt")).toBe(accessToken);
  });
});

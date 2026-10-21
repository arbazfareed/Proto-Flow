import { afterEach, describe, expect, it, vi } from "vitest";
import {
  canUseOfflineWallet,
  checkCloudHealth,
  claimDailyCredits,
  deleteCloudWalletData,
  exportWalletData,
  fetchAllLedgerEntries,
  fetchPublishedPreviews,
  fetchLedgerPage,
  fetchWalletMe,
  getCachedWallet,
  provisionAnonymousWallet,
  resetWalletIdentity,
  runMeteredAction,
  submitInteractionFeedback,
  unpublishPreview,
  signOutAccount,
  startEmailSignIn,
  startGoogleSignIn,
  verifyEmailSignIn,
  verifyGoogleSignIn,
  WalletApiError,
  type WalletSnapshot,
} from "./api";
import { useWalletStore } from "./store";

const now = 1_800_000_000_000;

function token(expiresAt: number): string {
  const payload = btoa(JSON.stringify({ exp: expiresAt }));
  return `header.${payload}.signature`;
}

function wallet(syncedAt: number): WalletSnapshot {
  return {
    accountId: "account-1",
    email: null,
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

  it("does not persist a linked email or JWT in the local wallet cache", () => {
    const values = stubStorage();
    const linkedWallet = { ...wallet(now), email: "person@example.com" };
    useWalletStore.getState().setWallet(linkedWallet, "sensitive-jwt");
    expect(getCachedWallet()?.email).toBeNull();
    expect(values.get("protoflow.wallet.cache")).not.toContain("person@example.com");
    expect(values.get("protoflow.wallet.cache")).not.toContain("sensitive-jwt");
    expect(useWalletStore.getState().jwt).toBe("sensitive-jwt");
    useWalletStore.setState({ email: null, jwt: null });
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

  describe("optional account sign-in API", () => {
    it("sends email-link requests for the authenticated account", async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ sent: true, expiresIn: 900 }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
      vi.stubGlobal("fetch", fetchMock);

      await startEmailSignIn("session-token", "account-1", "person@example.com", "protoflow://auth/verify");

      const [url, request] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("http://127.0.0.1:8790/auth/email/start");
      expect(request.headers).toMatchObject({ Authorization: "Bearer session-token" });
      expect(JSON.parse(request.body as string)).toEqual({
        email: "person@example.com",
        accountId: "account-1",
        callbackUri: "protoflow://auth/verify",
      });
    });

    it("verifies email and Google callbacks then refreshes the cloud wallet", async () => {
      const linkedToken = token(now + 60 * 60 * 1000);
      const walletResponse = {
        accountId: "account-1",
        email: "person@example.com",
        balance: 55,
        lifetimeGranted: 55,
        lifetimeSpent: 0,
        recentLedger: [],
        claimable: false,
        syncedAt: now,
      };
      const fetchMock = vi.fn()
        .mockResolvedValueOnce(new Response(JSON.stringify({
          accountId: "account-1",
          email: "person@example.com",
          token: linkedToken,
          tokenExpiresAt: new Date(now + 60 * 60 * 1000).toISOString(),
        }), { status: 200, headers: { "Content-Type": "application/json" } }))
        .mockResolvedValueOnce(new Response(JSON.stringify(walletResponse), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }))
        .mockResolvedValueOnce(new Response(JSON.stringify({
          accountId: "account-1",
          email: "person@example.com",
          token: linkedToken,
          tokenExpiresAt: new Date(now + 60 * 60 * 1000).toISOString(),
        }), { status: 200, headers: { "Content-Type": "application/json" } }))
        .mockResolvedValueOnce(new Response(JSON.stringify(walletResponse), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }));
      vi.stubGlobal("fetch", fetchMock);

      const emailLink = await verifyEmailSignIn("session-token", "magic-token");
      const googleLink = await verifyGoogleSignIn("session-token", "google-ticket");

      expect(emailLink.snapshot.email).toBe("person@example.com");
      expect(googleLink.snapshot.balance).toBe(55);
      expect(JSON.parse((fetchMock.mock.calls[0]?.[1] as RequestInit).body as string)).toEqual({
        token: "magic-token",
      });
      expect(JSON.parse((fetchMock.mock.calls[2]?.[1] as RequestInit).body as string)).toEqual({
        ticket: "google-ticket",
      });
    });

    it("accepts only Google authorization URLs on Google's OAuth endpoint", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          new Response(JSON.stringify({ authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth?state=test" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        ),
      );
      await expect(startGoogleSignIn("session-token", "protoflow://auth/google-callback"))
        .resolves.toContain("accounts.google.com/o/oauth2/v2/auth");

      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          new Response(JSON.stringify({ authorizationUrl: "https://attacker.example/" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        ),
      );
      await expect(startGoogleSignIn("session-token", "protoflow://auth/google-callback"))
        .rejects.toThrow("untrusted Google sign-in URL");
    });

    it("requires server confirmation before signing out", async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ signedOut: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
      vi.stubGlobal("fetch", fetchMock);
      await signOutAccount("session-token");
      expect((fetchMock.mock.calls[0]?.[1] as RequestInit).method).toBe("POST");
    });
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

    it("submits AI feedback without including the prompt or charging credits", async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
      vi.stubGlobal("fetch", fetchMock);

      await expect(
        submitInteractionFeedback("session-token", "20000000-0000-4000-8000-000000000002", "positive"),
      ).resolves.toBeUndefined();

      const [url, request] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toContain("/action/feedback");
      expect(JSON.parse(request.body as string)).toEqual({
        ruleId: "20000000-0000-4000-8000-000000000002",
        feedback: "positive",
      });
      expect(JSON.stringify(request.body)).not.toContain("prompt");
    });

    it("allows bounded 10 MiB cloud publish bundles through the metered API", async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            success: true,
            type: "cloud_preview_publish",
            result: { id: "AbC123xY" },
            wallet: {
              accountId: "account-1",
              balance: 48,
              lifetimeGranted: 50,
              lifetimeSpent: 2,
              syncedAt: now,
              recentLedger: [],
              claimable: false,
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
      vi.stubGlobal("fetch", fetchMock);

      await expect(
        runMeteredAction(
          "session-token",
          "cloud_preview_publish",
          { projectName: "Large preview", bundle: `<!doctype html>${"x".repeat(100_000)}</html>` },
        ),
      ).resolves.toMatchObject({ wallet: { balance: 48 } });
      expect(new TextEncoder().encode(fetchMock.mock.calls[0][1].body as string).byteLength).toBeGreaterThan(64 * 1024);
    });

    it("allows a bounded encoded project export and validates the returned ZIP", async () => {
      const archive = {
        fileName: "checkout-react-export.zip",
        zipBase64: "UEsFBgAAAAAAAAAAAAAAAAAAAAAAAA==",
        sizeBytes: 22,
      };
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            success: true,
            type: "react_tailwind_code_export",
            result: archive,
            wallet: {
              accountId: "account-1",
              balance: 47,
              lifetimeGranted: 50,
              lifetimeSpent: 3,
              syncedAt: now,
              recentLedger: [],
              claimable: false,
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
      vi.stubGlobal("fetch", fetchMock);

      const result = await runMeteredAction<{ fileName: string }>(
        "session-token",
        "react_tailwind_code_export",
        { projectJson: "A".repeat(100_000), options: { scope: "all" } },
      );

      expect(result.result.fileName).toBe("checkout-react-export.zip");
      expect(result.wallet.balance).toBe(47);
      expect(new TextEncoder().encode(fetchMock.mock.calls[0][1].body as string).byteLength).toBeGreaterThan(64 * 1024);
    });

    it("loads validated publish history and confirms unpublishing", async () => {
      const preview = {
        id: "AbC123xY",
        projectName: "Checkout",
        url: "https://protoflow.link/p/AbC123xY",
        createdAt: new Date(now).toISOString(),
        expiresAt: new Date(now + 30 * 24 * 60 * 60 * 1000).toISOString(),
        sizeBytes: 900,
        viewCount: 3,
      };
      const fetchMock = vi.fn()
        .mockResolvedValueOnce(new Response(JSON.stringify({ previews: [preview] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }));
      vi.stubGlobal("fetch", fetchMock);

      await expect(fetchPublishedPreviews("session-token")).resolves.toEqual([preview]);
      await expect(unpublishPreview("session-token", preview.id)).resolves.toBeUndefined();
      expect(fetchMock.mock.calls[0][0]).toContain("/previews");
      expect(fetchMock.mock.calls[1][0]).toContain(`/previews/${preview.id}`);
      expect((fetchMock.mock.calls[1][1] as RequestInit).method).toBe("DELETE");
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
        runMeteredAction("session-token", "ai_interaction_generator", { source: "x".repeat(70_000) }),
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

describe("wallet history and data controls API", () => {
  it("fetches a paginated ledger page with reason and cursor filters", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      entries: [{
        id: "ledger-1",
        delta: 20,
        reason: "daily_refill",
        metadata: {},
        createdAt: new Date(now).toISOString(),
      }],
      nextCursor: "next-page",
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchLedgerPage("session-token", {
      limit: 50,
      cursor: "cursor-value",
      reason: "daily_refill",
    })).resolves.toMatchObject({ entries: [{ reason: "daily_refill", delta: 20 }], nextCursor: "next-page" });
    const [url, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/wallet/ledger?");
    expect(url).toContain("limit=50");
    expect(url).toContain("cursor=cursor-value");
    expect(url).toContain("reason=daily_refill");
    expect(request.headers).toMatchObject({ Authorization: "Bearer session-token" });
  });

  it("retrieves every CSV-export page and rejects repeated pagination cursors", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        entries: [{ id: "one", delta: 1, reason: "starter_grant", metadata: {}, createdAt: new Date(now).toISOString() }],
        nextCursor: "next",
      }), { status: 200, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        entries: [{ id: "two", delta: 20, reason: "daily_refill", metadata: {}, createdAt: new Date(now - 1).toISOString() }],
        nextCursor: null,
      }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchAllLedgerEntries("session-token")).resolves.toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify({
      entries: [{ id: "one", delta: 1, reason: "starter_grant", metadata: {}, createdAt: new Date(now).toISOString() }],
      nextCursor: "repeated",
    }), { status: 200, headers: { "Content-Type": "application/json" } }))));
    await expect(fetchAllLedgerEntries("session-token")).rejects.toThrow("repeated a ledger cursor");
  });

  it("validates a JSON export and sends typed DELETE confirmation", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        schemaVersion: 1,
        exportedAt: new Date(now).toISOString(),
        account: {
          id: "account-1",
          deviceIdHash: "a".repeat(64),
          email: "owner@example.com",
          createdAt: new Date(now - 10).toISOString(),
        },
        wallet: { balance: 50, lifetimeGranted: 50, lifetimeSpent: 0 },
        ledger: [{
          id: "ledger-1",
          delta: 50,
          reason: "starter_grant",
          metadata: {},
          createdAt: new Date(now).toISOString(),
        }],
      }), { status: 200, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        deleted: true,
        deletedAt: new Date(now).toISOString(),
        purgeAfter: new Date(now + 30 * 24 * 60 * 60 * 1000).toISOString(),
      }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const exported = await exportWalletData("session-token");
    expect(exported.account.email).toBe("owner@example.com");
    expect(exported.ledger).toHaveLength(1);
    await expect(deleteCloudWalletData("session-token")).resolves.toMatchObject({ purgeAfter: expect.any(String) });
    const [url, request] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(url).toContain("/account/data");
    expect(request.method).toBe("DELETE");
    expect(JSON.parse(request.body as string)).toEqual({ confirmation: "DELETE" });
  });
});

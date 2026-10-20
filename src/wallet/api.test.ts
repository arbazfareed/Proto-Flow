import { afterEach, describe, expect, it, vi } from "vitest";
import {
  canUseOfflineWallet,
  getCachedWallet,
  provisionAnonymousWallet,
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
      syncedAt: now - 60_000,
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

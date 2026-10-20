import { describe, expect, it } from "vitest";
import { canUseOfflineWallet, type WalletSnapshot } from "./api";

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
  };
}

describe("offline wallet grace", () => {
  it("allows the last balance while the token and 24-hour cache are valid", () => {
    expect(canUseOfflineWallet(token(now / 1000 + 60), wallet(now - 60_000), now)).toBe(true);
  });

  it("rejects missing or expired tokens", () => {
    expect(canUseOfflineWallet(null, wallet(now - 60_000), now)).toBe(false);
    expect(canUseOfflineWallet(token(now / 1000 - 1), wallet(now - 60_000), now)).toBe(false);
  });

  it("rejects a balance cache older than 24 hours or dated in the future", () => {
    const oneDay = 24 * 60 * 60 * 1000;
    const validToken = token(now / 1000 + 60);
    expect(canUseOfflineWallet(validToken, wallet(now - oneDay - 1), now)).toBe(false);
    expect(canUseOfflineWallet(validToken, wallet(now + 1), now)).toBe(false);
  });
});

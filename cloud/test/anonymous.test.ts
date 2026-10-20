import { afterEach, describe, expect, it, vi } from "vitest";
import { app } from "../src";
import type { WorkerEnv } from "../src/env";

const secret = "test-secret-that-is-long-enough-for-hmac-validation";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

interface WalletResponse {
  accountId: string;
  token: string;
  balance: number;
  lifetimeGranted: number;
  lifetimeSpent: number;
}

interface MemoryAccount {
  id: string;
  device_fingerprint: string;
  install_id: string | null;
  merged_into: string | null;
  email: string | null;
}

interface MemoryWallet {
  account_id: string;
  balance: number;
  lifetime_granted: number;
  lifetime_spent: number;
}

interface MemoryLedgerEntry {
  id: string;
  account_id: string;
  delta: number;
  reason: string;
  metadata_json: string;
  created_at: string;
}

interface MemoryDailyGrant {
  granted_at: string;
  amount: number;
}

interface MemoryIpActivity {
  ip_hash: string;
  account_id: string;
  last_seen_at: string;
}

class MemoryD1Statement {
  private parameters: unknown[] = [];

  constructor(
    private readonly database: MemoryD1Database,
    private readonly sql: string,
  ) {}

  bind(...parameters: unknown[]): MemoryD1Statement {
    this.parameters = parameters;
    return this;
  }

  async run<T>(): Promise<D1Result<T>> {
    return this.database.execute<T>(this.sql, this.parameters);
  }

  async first<T>(): Promise<T | null> {
    const result = await this.run<T>();
    return result.results[0] ?? null;
  }

  async all<T>(): Promise<D1Result<T>> {
    return this.run<T>();
  }
}

class MemoryD1Database {
  readonly accounts = new Map<string, MemoryAccount>();
  readonly wallets = new Map<string, MemoryWallet>();
  readonly starterGrants = new Set<string>();
  readonly ledger = new Map<string, MemoryLedgerEntry>();
  readonly dailyGrants = new Map<string, MemoryDailyGrant>();
  readonly ipActivity = new Map<string, MemoryIpActivity>();
  readonly dailyIpGrants = new Map<string, { account_id: string; granted_at: string }>();
  readonly signups = new Map<string, { ip_hash: string; created_at: number }>();
  readonly cache = new Map<string, string>();
  private changes = 0;

  prepare(sql: string): MemoryD1Statement {
    return new MemoryD1Statement(this, sql);
  }

  async batch(statements: MemoryD1Statement[]): Promise<D1Result[]> {
    const results: D1Result[] = [];
    for (const statement of statements) results.push(await statement.run());
    return results;
  }

  execute<T>(sql: string, parameters: unknown[]): D1Result<T> {
    const statement = sql.replace(/\s+/g, " ").trim().toLowerCase();
    let results: unknown[] = [];
    const previousChanges = this.changes;
    this.changes = 0;

    if (statement.startsWith("insert or ignore into accounts")) {
      const [id, fingerprint, installId] = parameters as [string, string, string];
      const exists = [...this.accounts.values()].some(
        (account) =>
          account.device_fingerprint === fingerprint || account.install_id === installId,
      );
      if (!exists) {
        this.accounts.set(id, {
          id,
          device_fingerprint: fingerprint,
          install_id: installId,
          merged_into: null,
          email: null,
        });
        this.changes = 1;
      }
    } else if (statement.startsWith("select id from accounts where id = ? and merged_into is null")) {
      const account = this.accounts.get(parameters[0] as string);
      if (account && !account.merged_into) results = [{ id: account.id }];
    } else if (statement.startsWith("select email from accounts where id = ? and merged_into is null")) {
      const account = this.accounts.get(parameters[0] as string);
      if (account && !account.merged_into) results = [{ email: account.email }];
    } else if (statement.startsWith("select id, device_fingerprint, install_id, merged_into from accounts where id = ?")) {
      const account = this.accounts.get(parameters[0] as string);
      if (account) results = [account];
    } else if (statement.startsWith("select id, device_fingerprint, install_id, merged_into from accounts")) {
      const [fingerprint, installId] = parameters as [string, string];
      results = [...this.accounts.values()]
        .filter(
          (account) =>
            account.device_fingerprint === fingerprint || account.install_id === installId,
        )
        .slice(0, 2);
    } else if (statement.startsWith("select id, scope, scope_key, mode, reason from abuse_flags")) {
      results = [];
    } else if (statement.startsWith("select id from abuse_flags")) {
      results = [];
    } else if (statement.startsWith("insert or ignore into abuse_signups")) {
      const [accountId, ipHash, createdAt] = parameters as [string, string, number];
      if (!this.signups.has(accountId)) {
        this.signups.set(accountId, { ip_hash: ipHash, created_at: createdAt });
        this.changes = 1;
      }
    } else if (statement.startsWith("select count(*) as count from abuse_signups")) {
      const [ipHash, createdAt] = parameters as [string, number];
      results = [{
        count: [...this.signups.values()].filter(
          (signup) => signup.ip_hash === ipHash && signup.created_at > createdAt,
        ).length,
      }];
    } else if (statement.startsWith("update accounts set device_fingerprint")) {
      const [fingerprint, accountId] = parameters as [string, string];
      const account = this.accounts.get(accountId);
      if (account) {
        account.device_fingerprint = fingerprint;
        this.changes = 1;
      }
    } else if (statement.startsWith("update accounts set install_id")) {
      const [installId, accountId] = parameters as [string, string];
      const account = this.accounts.get(accountId);
      if (account?.install_id === null) {
        account.install_id = installId;
        this.changes = 1;
      }
    } else if (statement.startsWith("update accounts set last_seen_at")) {
      this.changes = 1;
    } else if (statement.startsWith("insert or ignore into wallets")) {
      const [accountId, balance, lifetimeGranted] = parameters as [string, number, number];
      if (!this.wallets.has(accountId)) {
        this.wallets.set(accountId, {
          account_id: accountId,
          balance,
          lifetime_granted: lifetimeGranted,
          lifetime_spent: 0,
        });
        this.changes = 1;
      }
    } else if (statement.startsWith("delete from wallet_ip_activity")) {
      const [cutoffNow] = parameters as [string];
      for (const [key, activity] of this.ipActivity) {
        if (
          Date.parse(activity.last_seen_at) <
          Date.parse(cutoffNow) - 30 * 24 * 60 * 60 * 1000
        ) {
          this.ipActivity.delete(key);
          this.changes += 1;
        }
      }
    } else if (statement.startsWith("delete from daily_ip_grants")) {
      const [cutoffNow] = parameters as [string];
      for (const [ipHash, grant] of this.dailyIpGrants) {
        if (
          Date.parse(grant.granted_at) <
          Date.parse(cutoffNow) - 30 * 24 * 60 * 60 * 1000
        ) {
          this.dailyIpGrants.delete(ipHash);
          this.changes += 1;
        }
      }
    } else if (statement.startsWith("insert into wallet_ip_activity")) {
      const [ipHash, accountId, seenAt] = parameters as [string, string, string];
      this.ipActivity.set(`${ipHash}:${accountId}`, {
        ip_hash: ipHash,
        account_id: accountId,
        last_seen_at: seenAt,
      });
      this.changes = 1;
    } else if (statement.startsWith("insert into ledger")) {
      if (statement.includes("'starter_grant'")) {
        const [id, accountId, delta] = parameters as [string, string, number];
        if (previousChanges === 1 && !this.starterGrants.has(accountId)) {
          this.starterGrants.add(accountId);
          this.ledger.set(id, {
            id,
            account_id: accountId,
            delta,
            reason: "starter_grant",
            metadata_json: "{}",
            created_at: new Date().toISOString(),
          });
          this.changes = 1;
        }
      } else if (statement.includes("'daily_grant'")) {
        const [id, accountId, createdAt, grantAccountId, grantedAt] = parameters as [
          string,
          string,
          string,
          string,
          string,
        ];
        const grant = this.dailyGrants.get(grantAccountId);
        if (
          previousChanges === 1 &&
          grant?.granted_at === grantedAt &&
          grant.amount > 0
        ) {
          this.ledger.set(id, {
            id,
            account_id: accountId,
            delta: grant.amount,
            reason: "daily_grant",
            metadata_json: "{}",
            created_at: createdAt,
          });
          this.changes = 1;
        }
      }
    } else if (statement.startsWith("insert or ignore into daily_grants")) {
      const accountId = parameters[0] as string;
      const grantedAt = parameters[1] as string;
      const dailyAmount = parameters[2] as number;
      const maxCatchUpDays = parameters[3] as number;
      const now = parameters[4] as string;
      const maxBalance = parameters[5] as number;
      const historyAccountId = parameters[6] as string;
      const walletId = parameters[7] as string;
      const walletCap = parameters[8] as number;
      const cooldownNow = parameters[10] as string;
      const windowDays = parameters[11] as number;
      const ipHash = parameters[12] as string | null;
      const ipCountHash = parameters[13] as string | null;
      const ipNow = parameters[14] as string;
      const ipWindowDays = parameters[15] as number;
      const ipThreshold = parameters[16] as number;
      const ipGrantHash = parameters[17] as string | null;
      const ipGrantNow = parameters[18] as string;
      const ipGrantWindow = parameters[19] as number;
      const activityHash = parameters[20] as string | null;
      const activityNow = parameters[21] as string;
      const activityWindow = parameters[22] as number;
      const grantNow = parameters[23] as string;
      const grantWindow = parameters[24] as number;
      const wallet = this.wallets.get(walletId);
      const latestGrant = this.dailyGrants.get(historyAccountId);
      const isClaimedRecently =
        latestGrant !== undefined &&
        Date.parse(latestGrant.granted_at) >
          Date.parse(cooldownNow) - windowDays * 24 * 60 * 60 * 1000;
      const recentIdentities = [...this.ipActivity.values()].filter(
        (activity) =>
          activity.ip_hash === ipCountHash &&
          Date.parse(activity.last_seen_at) >
            Date.parse(ipNow) - ipWindowDays * 24 * 60 * 60 * 1000,
      );
      const hasRecentIpGrant =
        ipGrantHash !== null &&
        this.dailyIpGrants.has(ipGrantHash) &&
        Date.parse(this.dailyIpGrants.get(ipGrantHash)?.granted_at ?? "") >
          Date.parse(ipGrantNow) - ipGrantWindow * 24 * 60 * 60 * 1000;
      const hasEarlierGrantFromIp = [...this.dailyGrants.entries()].some(
        ([grantAccountId, grant]) =>
          recentIdentities.some(
            (activity) =>
              activity.ip_hash === activityHash &&
              activity.account_id === grantAccountId &&
              Date.parse(activity.last_seen_at) >
                Date.parse(activityNow) - activityWindow * 24 * 60 * 60 * 1000,
          ) &&
          Date.parse(grant.granted_at) >
            Date.parse(grantNow) - grantWindow * 24 * 60 * 60 * 1000,
      );
      const ipLimited =
        ipHash !== null &&
        recentIdentities.length >= ipThreshold &&
        (hasRecentIpGrant || hasEarlierGrantFromIp);
      if (wallet && wallet.balance < walletCap && !isClaimedRecently && !ipLimited) {
        const elapsedDays = latestGrant
          ? Math.max(
              1,
              Math.floor(
                (Date.parse(now) - Date.parse(latestGrant.granted_at)) /
                  (24 * 60 * 60 * 1000),
              ),
            )
          : 1;
        this.dailyGrants.set(accountId, {
          granted_at: grantedAt,
          amount: Math.min(dailyAmount * Math.min(maxCatchUpDays, elapsedDays), maxBalance - wallet.balance),
        });
        this.changes = 1;
      }
    } else if (statement.startsWith("insert into daily_ip_grants")) {
      const [ipHash, accountId, grantedAt, countHash, now, windowDays, threshold] = parameters as [
        string,
        string,
        string,
        string,
        string,
        number,
        number,
      ];
      const activeIdentityCount = [...this.ipActivity.values()].filter(
        (activity) =>
          activity.ip_hash === countHash &&
          Date.parse(activity.last_seen_at) > Date.parse(now) - windowDays * 24 * 60 * 60 * 1000,
      ).length;
      if (previousChanges === 1 && activeIdentityCount >= threshold) {
        this.dailyIpGrants.set(ipHash, { account_id: accountId, granted_at: grantedAt });
        this.changes = 1;
      }
    } else if (statement.startsWith("update wallets set balance = balance +")) {
      const grantAccountId = parameters[0] as string;
      const grantedAt = parameters[1] as string;
      const lifetimeGrantedAt = parameters[3] as string;
      const accountId = parameters[5] as string;
      const expectedAt = parameters[7] as string;
      const grant = this.dailyGrants.get(grantAccountId);
      const wallet = this.wallets.get(accountId);
      if (
        previousChanges === 1 &&
        grant?.granted_at === grantedAt &&
        grant.granted_at === lifetimeGrantedAt &&
        grant.granted_at === expectedAt &&
        wallet
      ) {
        wallet.balance += grant.amount;
        wallet.lifetime_granted += grant.amount;
        this.changes = 1;
      }
    } else if (statement.startsWith("select balance, lifetime_granted, lifetime_spent, (select max")) {
      const [historyAccountId, , claimableAccountId, now, , accountId] = parameters as [
        string,
        number,
        string,
        string,
        number,
        string,
      ];
      const wallet = this.wallets.get(accountId);
      const grant = this.dailyGrants.get(historyAccountId);
      const latestAccountGrant = this.dailyGrants.get(claimableAccountId);
      const recentlyClaimed =
        latestAccountGrant !== undefined &&
        Date.parse(latestAccountGrant.granted_at) > Date.parse(now) - 24 * 60 * 60 * 1000;
      if (wallet) {
        results = [{
          balance: wallet.balance,
          lifetime_granted: wallet.lifetime_granted,
          lifetime_spent: wallet.lifetime_spent,
          claimable: wallet.balance < 100 && !recentlyClaimed ? 1 : 0,
          last_granted_at: grant?.granted_at ?? null,
        }];
      }
    } else if (statement.startsWith("select count(*) as identity_count from wallet_ip_activity")) {
      const [ipHash, activityNow, windowDays] = parameters as [string, string, number];
      results = [{
        identity_count: [...this.ipActivity.values()].filter(
          (activity) =>
            activity.ip_hash === ipHash &&
            Date.parse(activity.last_seen_at) >
              Date.parse(activityNow) - windowDays * 24 * 60 * 60 * 1000,
        ).length,
      }];
    } else if (statement.startsWith("select max(ip_daily_grants.granted_at) as last_granted_at")) {
      const [ipHash, activityNow, activityWindow, grantNow, grantWindow] = parameters as [
        string,
        string,
        number,
        string,
        number,
      ];
      const accountIds = new Set(
        [...this.ipActivity.values()]
          .filter(
            (activity) =>
              activity.ip_hash === ipHash &&
              Date.parse(activity.last_seen_at) >
                Date.parse(activityNow) - activityWindow * 24 * 60 * 60 * 1000,
          )
          .map((activity) => activity.account_id),
      );
      const latestGrant = [...this.dailyGrants.entries()]
        .filter(
          ([accountId, grant]) =>
            accountIds.has(accountId) &&
            Date.parse(grant.granted_at) >
              Date.parse(grantNow) - grantWindow * 24 * 60 * 60 * 1000,
        )
        .map(([, grant]) => grant.granted_at)
        .sort()
        .at(-1);
      results = [{ last_granted_at: latestGrant ?? null }];
    } else if (statement.startsWith("select id, delta, reason, metadata_json, created_at from ledger")) {
      const [accountId] = parameters as [string];
      results = [...this.ledger.values()]
        .filter((entry) => entry.account_id === accountId)
        .sort((left, right) => right.created_at.localeCompare(left.created_at))
        .slice(0, 20);
    } else if (statement.startsWith("select balance, lifetime_granted, lifetime_spent from wallets")) {
      const [accountId] = parameters as [string];
      const wallet = this.wallets.get(accountId);
      if (wallet) {
        results = [{
          balance: wallet.balance,
          lifetime_granted: wallet.lifetime_granted,
          lifetime_spent: wallet.lifetime_spent,
        }];
      }
    } else {
      throw new Error(`Unexpected SQL in test database: ${statement}`);
    }

    return {
      results: results as T[],
      success: true,
      meta: { changes: this.changes },
    } as D1Result<T>;
  }
}

function environment(
  database: MemoryD1Database,
  overrides: Partial<WorkerEnv> = {},
): WorkerEnv {
  const cache: KVNamespace = {
    get: async (key: string) => database.cache.get(key) ?? null,
    put: async (key: string, value: string) => {
      database.cache.set(key, value);
    },
    delete: async (key: string) => {
      database.cache.delete(key);
    },
  } as unknown as KVNamespace;
  return {
    DB: database as unknown as D1Database,
    CACHE: cache,
    ASSETS: {} as R2Bucket,
    JWT_SECRET: secret,
    ALLOWED_ORIGINS: "",
    ...overrides,
  };
}

async function hashIp(ipAddress: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`protoflow-wallet-ip:${ipAddress}`),
  );
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function provision(
  database: MemoryD1Database,
  deviceId: string,
  installId: string,
) {
  return app.request(
    "/auth/anonymous",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deviceId, installId }),
    },
    environment(database),
  );
}

describe("anonymous wallet provisioning", () => {
  it("rate-limits anonymous provisioning per device and returns rate-limit headers", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-20T12:00:00.000Z"));
    const database = new MemoryD1Database();
    const request = () =>
      provision(
        database,
        "f".repeat(64),
        "723e4567-e89b-42d3-a456-426614174000",
      );

    let response: Response | undefined;
    for (let attempt = 0; attempt < 11; attempt += 1) response = await request();

    expect(response?.status).toBe(429);
    expect(response?.headers.get("X-RateLimit-Limit")).toBe("10");
    expect(response?.headers.get("X-RateLimit-Remaining")).toBe("0");
    expect(response?.headers.get("Retry-After")).toMatch(/^\d+$/);
    expect(await response?.json()).toMatchObject({
      error: { code: "RATE_LIMITED" },
    });
    expect(database.wallets.size).toBe(1);
  });

  it("creates a 50-credit wallet once and returns the same account on retry", async () => {
    const database = new MemoryD1Database();
    const deviceId = "a".repeat(64);
    const installId = "123e4567-e89b-42d3-a456-426614174000";

    const firstResponse = await provision(database, deviceId, installId);
    const retryResponse = await provision(database, deviceId, installId);
    const first = (await firstResponse.json()) as WalletResponse;
    const retry = (await retryResponse.json()) as WalletResponse;

    expect(firstResponse.status).toBe(200);
    expect(first).toMatchObject({ balance: 50, lifetimeGranted: 50, lifetimeSpent: 0 });
    expect(retry).toMatchObject({ accountId: first.accountId, balance: 50 });
    expect(database.wallets.size).toBe(1);
    expect(database.starterGrants.size).toBe(1);

    const authenticated = await app.request(
      "/wallet/me",
      { headers: { Authorization: `Bearer ${first.token}` } },
      environment(database),
    );
    const wallet = await authenticated.json();
    expect(authenticated.status).toBe(200);
    expect(wallet).toMatchObject({
      accountId: first.accountId,
      balance: 50,
      lifetimeGranted: 50,
      lifetimeSpent: 0,
      claimable: true,
      nextClaimAt: null,
      recentLedger: [{ delta: 50, reason: "starter_grant" }],
    });
  });

  it("claims only the balance needed to reach the daily cap and records one ledger grant", async () => {
    const database = new MemoryD1Database();
    const provisionedResponse = await provision(
      database,
      "c".repeat(64),
      "323e4567-e89b-42d3-a456-426614174000",
    );
    const provisioned = (await provisionedResponse.json()) as WalletResponse;
    const wallet = database.wallets.get(provisioned.accountId);
    if (!wallet) throw new Error("Test wallet was not provisioned.");
    wallet.balance = 95;

    const claim = () =>
      app.request(
        "/wallet/claim-daily",
        {
          method: "POST",
          headers: { Authorization: `Bearer ${provisioned.token}` },
        },
        environment(database),
      );
    const firstClaim = await claim();
    const firstResult = (await firstClaim.json()) as Record<string, unknown>;
    expect(firstClaim.status).toBe(200);
    expect(firstResult).toMatchObject({
      accountId: provisioned.accountId,
      claimed: true,
      granted: 5,
      balance: 100,
      lifetimeGranted: 55,
      claimable: false,
    });
    expect(typeof firstResult.nextClaimAt).toBe("string");
    expect([...database.ledger.values()].filter((entry) => entry.reason === "daily_grant")).toHaveLength(1);

    const repeatedClaim = await claim();
    expect(repeatedClaim.status).toBe(409);
    expect(await repeatedClaim.json()).toMatchObject({
      error: { code: "DAILY_ALREADY_CLAIMED" },
      balance: 100,
    });
    expect([...database.ledger.values()].filter((entry) => entry.reason === "daily_grant")).toHaveLength(1);
  });

  it("accumulates missed daily refills up to 60 credits without exceeding the wallet cap", async () => {
    const database = new MemoryD1Database();
    const provisionedResponse = await provision(
      database,
      "d".repeat(64),
      "423e4567-e89b-42d3-a456-426614174000",
    );
    const provisioned = (await provisionedResponse.json()) as WalletResponse;
    const wallet = database.wallets.get(provisioned.accountId);
    if (!wallet) throw new Error("Test wallet was not provisioned.");
    wallet.balance = 10;
    database.dailyGrants.set(provisioned.accountId, {
      granted_at: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
      amount: 20,
    });

    const response = await app.request(
      "/wallet/claim-daily",
      {
        method: "POST",
        headers: { Authorization: `Bearer ${provisioned.token}` },
      },
      environment(database),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      claimed: true,
      granted: 60,
      balance: 70,
      lifetimeGranted: 110,
      lifetimeSpent: 0,
    });
    expect(wallet.balance).toBeLessThanOrEqual(100);
  });

  it("limits daily refills by hashed IP after five distinct accounts share an address", async () => {
    const database = new MemoryD1Database();
    const sharedIp = "203.0.113.7";
    const claims: Response[] = [];
    for (let index = 0; index < 5; index += 1) {
      const digit = String(index + 1);
      const provisionedResponse = await provision(
        database,
        digit.repeat(64),
        `123e4567-e89b-42d3-a456-42661417400${digit}`,
      );
      const provisioned = (await provisionedResponse.json()) as WalletResponse;
      claims.push(
        await app.request(
          "/wallet/claim-daily",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${provisioned.token}`,
              "CF-Connecting-IP": sharedIp,
            },
          },
          environment(database),
        ),
      );
    }

    expect(claims.slice(0, 4).every((response) => response.status === 200)).toBe(true);
    expect(claims[4].status).toBe(409);
    expect(await claims[4].json()).toMatchObject({
      error: { code: "DAILY_IP_LIMIT" },
      balance: 50,
    });
    expect([...database.ipActivity.values()].every((entry) => entry.ip_hash !== sharedIp)).toBe(true);
  });

  it("requires and verifies Turnstile only when a suspicious IP has a configured secret", async () => {
    const database = new MemoryD1Database();
    const sharedIp = "203.0.113.18";
    const hashedIp = await hashIp(sharedIp);
    const now = new Date().toISOString();
    for (let index = 0; index < 4; index += 1) {
      database.ipActivity.set(`${hashedIp}:existing-${index}`, {
        ip_hash: hashedIp,
        account_id: `existing-${index}`,
        last_seen_at: now,
      });
    }
    const provisionedResponse = await provision(
      database,
      "a".repeat(64),
      "523e4567-e89b-42d3-a456-426614174000",
    );
    const provisioned = (await provisionedResponse.json()) as WalletResponse;
    const request = (turnstileToken?: string) =>
      app.request(
        "/wallet/claim-daily",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${provisioned.token}`,
            "CF-Connecting-IP": sharedIp,
            ...(turnstileToken ? { "X-Turnstile-Token": turnstileToken } : {}),
          },
        },
        environment(database, { TURNSTILE_SECRET_KEY: "turnstile-secret" }),
      );

    const missingToken = await request();
    expect(missingToken.status).toBe(403);
    expect(await missingToken.json()).toMatchObject({
      error: { code: "TURNSTILE_REQUIRED" },
    });

    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() =>
        Promise.resolve(new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })),
      ),
    );
    const verified = await request("valid-turnstile-token");
    expect(verified.status).toBe(200);
    expect(await verified.json()).toMatchObject({ claimed: true, granted: 20 });
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      expect.objectContaining({ method: "POST" }),
    );

    const anotherProvision = await provision(
      database,
      "b".repeat(64),
      "623e4567-e89b-42d3-a456-426614174000",
    );
    const anotherAccount = (await anotherProvision.json()) as WalletResponse;
    const limited = await app.request(
      "/wallet/claim-daily",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${anotherAccount.token}`,
          "CF-Connecting-IP": sharedIp,
          "X-Turnstile-Token": "valid-turnstile-token",
        },
      },
      environment(database, { TURNSTILE_SECRET_KEY: "turnstile-secret" }),
    );
    expect(limited.status).toBe(409);
    expect(await limited.json()).toMatchObject({
      error: { code: "DAILY_IP_LIMIT" },
    });
  });

  it("uses the stable install ID when the device fingerprint changes", async () => {
    const database = new MemoryD1Database();
    const installId = "123e4567-e89b-42d3-a456-426614174000";
    const firstResponse = await provision(database, "a".repeat(64), installId);
    const migratedResponse = await provision(database, "b".repeat(64), installId);
    const first = (await firstResponse.json()) as WalletResponse;
    const migrated = (await migratedResponse.json()) as WalletResponse;

    expect(migratedResponse.status).toBe(200);
    expect(migrated).toMatchObject({ accountId: first.accountId, balance: 50 });
    expect(database.accounts.size).toBe(1);
    expect(database.wallets.size).toBe(1);
    expect(database.starterGrants.size).toBe(1);
  });

  it("rejects device and install identifiers that resolve to different accounts", async () => {
    const database = new MemoryD1Database();
    await provision(database, "a".repeat(64), "123e4567-e89b-42d3-a456-426614174000");
    await provision(database, "b".repeat(64), "223e4567-e89b-42d3-a456-426614174000");

    const response = await provision(
      database,
      "a".repeat(64),
      "223e4567-e89b-42d3-a456-426614174000",
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: { code: "IDENTITY_CONFLICT" },
    });
  });
});

import { describe, expect, it } from "vitest";
import { app } from "../src";
import type { WorkerEnv } from "../src/env";

const secret = "test-secret-that-is-long-enough-for-hmac-validation";

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
        });
        this.changes = 1;
      }
    } else if (statement.startsWith("select id, device_fingerprint, install_id from accounts")) {
      const [fingerprint, installId] = parameters as [string, string];
      results = [...this.accounts.values()]
        .filter(
          (account) =>
            account.device_fingerprint === fingerprint || account.install_id === installId,
        )
        .slice(0, 2);
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
      const [accountId, grantedAt, dailyAmount, maxBalance, walletId, walletCap, historyAccountId, now] =
        parameters as [string, string, number, number, string, number, string, string];
      const wallet = this.wallets.get(walletId);
      const latestGrant = this.dailyGrants.get(historyAccountId);
      const isClaimedRecently =
        latestGrant !== undefined &&
        Date.parse(latestGrant.granted_at) > Date.parse(now) - 24 * 60 * 60 * 1000;
      if (wallet && wallet.balance < walletCap && !isClaimedRecently) {
        this.dailyGrants.set(accountId, {
          granted_at: grantedAt,
          amount: Math.min(dailyAmount, maxBalance - wallet.balance),
        });
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
    } else if (statement.startsWith("select balance, lifetime_granted, lifetime_spent, case")) {
      const [, historyAccountId, now, accountId] = parameters as [number, string, string, string];
      const wallet = this.wallets.get(accountId);
      const grant = this.dailyGrants.get(historyAccountId);
      const recentlyClaimed =
        grant !== undefined && Date.parse(grant.granted_at) > Date.parse(now) - 24 * 60 * 60 * 1000;
      if (wallet) {
        results = [{
          balance: wallet.balance,
          lifetime_granted: wallet.lifetime_granted,
          lifetime_spent: wallet.lifetime_spent,
          claimable: wallet.balance < 100 && !recentlyClaimed ? 1 : 0,
        }];
      }
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

function environment(database: MemoryD1Database): WorkerEnv {
  return {
    DB: database as unknown as D1Database,
    CACHE: {} as KVNamespace,
    ASSETS: {} as R2Bucket,
    JWT_SECRET: secret,
    ALLOWED_ORIGINS: "",
  };
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
    const firstResult = await firstClaim.json();
    expect(firstClaim.status).toBe(200);
    expect(firstResult).toMatchObject({
      accountId: provisioned.accountId,
      claimed: true,
      granted: 5,
      balance: 100,
      lifetimeGranted: 55,
      claimable: false,
    });
    expect([...database.ledger.values()].filter((entry) => entry.reason === "daily_grant")).toHaveLength(1);

    const repeatedClaim = await claim();
    expect(repeatedClaim.status).toBe(200);
    expect(await repeatedClaim.json()).toMatchObject({
      claimed: false,
      granted: 0,
      balance: 100,
      lifetimeGranted: 55,
    });
    expect([...database.ledger.values()].filter((entry) => entry.reason === "daily_grant")).toHaveLength(1);
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

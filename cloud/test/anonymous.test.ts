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
      const [grantId, accountId] = parameters as [string, string, number];
      void grantId;
      if (previousChanges === 1 && !this.starterGrants.has(accountId)) {
        this.starterGrants.add(accountId);
        this.changes = 1;
      } else {
        this.changes = 0;
      }
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
    const authenticationResult = await authenticated.json();
    expect(authenticationResult).toMatchObject({
      error: { code: "WALLET_NOT_IMPLEMENTED" },
    });
    expect(authenticated.status).toBe(501);
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

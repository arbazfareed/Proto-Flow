import { afterEach, describe, expect, it, vi } from "vitest";
import { app, runScheduledTasks } from "../src";
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
  google_sub?: string | null;
  deleted_at?: string | null;
  created_at?: string;
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

interface MemoryPreview {
  id: string;
  account_id: string;
  project_name: string;
  object_key: string;
  created_at: string;
  expires_at: string;
  size_bytes: number;
  view_count: number;
}

interface MemoryCollaboration {
  id: string;
  account_id: string;
  project_name: string;
  object_key: string;
  created_at: string;
  last_activity_at: string;
  expires_at: string;
  view_only: number;
  ended_at: string | null;
}

interface MemoryCheckpoint {
  id: string;
  session_id: string;
  object_key: string;
  created_at: string;
  size_bytes: number;
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
  readonly previews = new Map<string, MemoryPreview>();
  readonly collaborations = new Map<string, MemoryCollaboration>();
  readonly checkpoints = new Map<string, MemoryCheckpoint>();
  readonly deletedAssetKeys: string[] = [];
  readonly erasedCollaborationIds: string[] = [];
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
          google_sub: null,
          deleted_at: null,
          created_at: new Date().toISOString(),
        });
        this.changes = 1;
      }
    } else if (statement.startsWith("select id from accounts where id = ? and merged_into is null")) {
      const account = this.accounts.get(parameters[0] as string);
      if (account && !account.merged_into && !account.deleted_at) results = [{ id: account.id }];
    } else if (statement.startsWith("select email from accounts where id = ? and merged_into is null")) {
      const account = this.accounts.get(parameters[0] as string);
      if (account && !account.merged_into) results = [{ email: account.email }];
    } else if (statement.startsWith("select a.id, a.device_fingerprint, a.email, a.created_at")) {
      const account = this.accounts.get(parameters[0] as string);
      const wallet = this.wallets.get(parameters[0] as string);
      if (account && wallet && !account.deleted_at && !account.merged_into) {
        results = [{
          id: account.id,
          device_fingerprint: account.device_fingerprint,
          email: account.email,
          created_at: account.created_at,
          balance: wallet.balance,
          lifetime_granted: wallet.lifetime_granted,
          lifetime_spent: wallet.lifetime_spent,
        }];
      }
    } else if (statement.startsWith("update accounts set deleted_at")) {
      const [deletedAt, accountId] = parameters as [string, string];
      const account = this.accounts.get(accountId);
      if (account && !account.deleted_at && !account.merged_into) {
        account.deleted_at = deletedAt;
        account.email = null;
        account.google_sub = null;
        results = [{ id: accountId }];
        this.changes = 1;
      }
    } else if (statement.startsWith("select id, device_fingerprint, install_id, merged_into, deleted_at from accounts where id = ?")) {
      const account = this.accounts.get(parameters[0] as string);
      if (account) results = [account];
    } else if (statement.startsWith("select id, device_fingerprint, install_id, merged_into, deleted_at from accounts")) {
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
    } else if (
      statement.startsWith("update accounts set device_fingerprint") &&
      !statement.includes("randomblob(32)")
    ) {
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
      if (statement.includes("deleted_at <= ?")) {
        const [purgeBefore] = parameters as [string];
        const deletedIds = new Set([...this.accounts.values()]
          .filter((account) => account.deleted_at && account.deleted_at <= purgeBefore)
          .map((account) => account.id));
        for (const [key, activity] of this.ipActivity) {
          if (deletedIds.has(activity.account_id)) {
            this.ipActivity.delete(key);
            this.changes += 1;
          }
        }
      } else {
        const [cutoffNow] = parameters as [string];
        for (const [key, activity] of this.ipActivity) {
          if (Date.parse(activity.last_seen_at) < Date.parse(cutoffNow) - 30 * 24 * 60 * 60 * 1000) {
            this.ipActivity.delete(key);
            this.changes += 1;
          }
        }
      }
    } else if (statement.startsWith("delete from daily_ip_grants")) {
      if (statement.includes("deleted_at <= ?")) {
        const [purgeBefore] = parameters as [string];
        const deletedIds = new Set([...this.accounts.values()]
          .filter((account) => account.deleted_at && account.deleted_at <= purgeBefore)
          .map((account) => account.id));
        for (const [ipHash, grant] of this.dailyIpGrants) {
          if (deletedIds.has(grant.account_id)) {
            this.dailyIpGrants.delete(ipHash);
            this.changes += 1;
          }
        }
      } else {
        const [cutoffNow] = parameters as [string];
        for (const [ipHash, grant] of this.dailyIpGrants) {
          if (Date.parse(grant.granted_at) < Date.parse(cutoffNow) - 30 * 24 * 60 * 60 * 1000) {
            this.dailyIpGrants.delete(ipHash);
            this.changes += 1;
          }
        }
      }
    } else if (statement.startsWith("delete from daily_grants where account_id in")) {
      const [purgeBefore] = parameters as [string];
      const deletedIds = new Set([...this.accounts.values()]
        .filter((account) => account.deleted_at && account.deleted_at <= purgeBefore)
        .map((account) => account.id));
      for (const accountId of this.dailyGrants.keys()) {
        if (deletedIds.has(accountId)) {
          this.dailyGrants.delete(accountId);
          this.changes += 1;
        }
      }
    } else if (statement.startsWith("delete from wallets where account_id in")) {
      const [purgeBefore] = parameters as [string];
      const deletedIds = new Set([...this.accounts.values()]
        .filter((account) => account.deleted_at && account.deleted_at <= purgeBefore)
        .map((account) => account.id));
      for (const accountId of deletedIds) {
        if (this.wallets.delete(accountId)) this.changes += 1;
      }
    } else if (statement.startsWith("delete from ledger where account_id in")) {
      const [purgeBefore] = parameters as [string];
      const deletedIds = new Set([...this.accounts.values()]
        .filter((account) => account.deleted_at && account.deleted_at <= purgeBefore)
        .map((account) => account.id));
      for (const [id, entry] of this.ledger) {
        if (deletedIds.has(entry.account_id)) {
          this.ledger.delete(id);
          this.changes += 1;
        }
      }
    } else if (
      statement.startsWith("delete from auth_magic_links") ||
      statement.startsWith("delete from auth_oauth_states") ||
      statement.startsWith("delete from auth_oauth_tickets")
    ) {
      this.changes = 0;
    } else if (statement.startsWith("delete from abuse_signups")) {
      if (statement.includes("deleted_at <= ?")) {
        const [purgeBefore] = parameters as [string];
        const deletedIds = new Set([...this.accounts.values()]
          .filter((account) => account.deleted_at && account.deleted_at <= purgeBefore)
          .map((account) => account.id));
        for (const accountId of deletedIds) {
          if (this.signups.delete(accountId)) this.changes += 1;
        }
      } else {
        const [cutoff] = parameters as [number];
        for (const [accountId, signup] of this.signups) {
          if (signup.created_at < cutoff) {
            this.signups.delete(accountId);
            this.changes += 1;
          }
        }
      }
    } else if (statement.startsWith("delete from abuse_flags")) {
      this.changes = 0;
    } else if (
      statement.startsWith("delete from accounts where id in (") &&
      statement.includes("with recursive deleted_accounts")
    ) {
      const [purgeBefore] = parameters as [string];
      for (const account of this.accounts.values()) {
        if (account.deleted_at && account.deleted_at <= purgeBefore) {
          this.accounts.delete(account.id);
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
      } else if (statement.includes("'daily_refill'")) {
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
            reason: "daily_refill",
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
      const accountId = parameters[0] as string;
      let parameterIndex = 1;
      const reason = statement.includes("reason = ?") ? parameters[parameterIndex++] as string : null;
      const hasCursor = statement.includes("created_at < ? or (created_at = ? and id < ?)");
      const cursorCreatedAt = hasCursor ? parameters[parameterIndex++] as string : null;
      if (hasCursor) parameterIndex += 1;
      const cursorId = hasCursor ? parameters[parameterIndex++] as string : null;
      const limit = statement.includes("limit ?") ? parameters[parameterIndex] as number : Infinity;
      results = [...this.ledger.values()]
        .filter((entry) => entry.account_id === accountId)
        .filter((entry) => !reason || entry.reason === reason)
        .filter((entry) => !cursorCreatedAt || entry.created_at < cursorCreatedAt ||
          (entry.created_at === cursorCreatedAt && entry.id < cursorId!))
        .sort((left, right) => right.created_at.localeCompare(left.created_at) || right.id.localeCompare(left.id))
        .slice(0, limit);
    } else if (
      statement.startsWith("select id, project_name, created_at, expires_at, size_bytes, view_count from published_previews") ||
      statement.startsWith("select id, object_key from published_previews")
    ) {
      const accountId = statement.includes("account_id = ?")
        ? parameters[0] as string
        : null;
      const deletedBefore = statement.includes("account_id in")
        ? parameters[0] as string
        : null;
      results = [...this.previews.values()]
        .filter((preview) => accountId
          ? preview.account_id === accountId
          : deletedBefore !== null &&
            (this.accounts.get(preview.account_id)?.deleted_at ?? "") <= deletedBefore)
        .map((preview) => statement.startsWith("select id, object_key")
          ? { id: preview.id, object_key: preview.object_key }
          : {
              id: preview.id,
              project_name: preview.project_name,
              created_at: preview.created_at,
              expires_at: preview.expires_at,
              size_bytes: preview.size_bytes,
              view_count: preview.view_count,
            });
    } else if (
      statement.startsWith("select id, object_key from collaboration_sessions") ||
      statement.startsWith("select id, project_name, created_at, last_activity_at, expires_at, view_only, ended_at from collaboration_sessions")
    ) {
      const accountId = statement.includes("account_id = ?")
        ? parameters[0] as string
        : null;
      const deletedBefore = statement.includes("account_id in")
        ? parameters[0] as string
        : null;
      results = [...this.collaborations.values()]
        .filter((session) => accountId
          ? session.account_id === accountId
          : deletedBefore !== null &&
            (this.accounts.get(session.account_id)?.deleted_at ?? "") <= deletedBefore)
        .map((session) => statement.startsWith("select id, object_key")
          ? { id: session.id, object_key: session.object_key }
          : {
              id: session.id,
              project_name: session.project_name,
              created_at: session.created_at,
              last_activity_at: session.last_activity_at,
              expires_at: session.expires_at,
              view_only: session.view_only,
              ended_at: session.ended_at,
            });
    } else if (
      statement.startsWith("select versions.object_key from collaboration_versions") ||
      statement.startsWith("select versions.session_id, versions.created_at, versions.size_bytes from collaboration_versions")
    ) {
      const accountId = parameters[0] as string;
      const ownedSessions = new Set([...this.collaborations.values()]
        .filter((session) => session.account_id === accountId)
        .map((session) => session.id));
      results = [...this.checkpoints.values()]
        .filter((checkpoint) => ownedSessions.has(checkpoint.session_id))
        .map((checkpoint) => statement.startsWith("select versions.object_key")
          ? { object_key: checkpoint.object_key }
          : {
              session_id: checkpoint.session_id,
              created_at: checkpoint.created_at,
              size_bytes: checkpoint.size_bytes,
            });
    } else if (
      statement.startsWith("delete from collaboration_versions") ||
      statement.startsWith("delete from collaboration_sessions") ||
      statement.startsWith("delete from published_previews") ||
      statement.startsWith("delete from ai_interaction_feedback") ||
      statement.startsWith("delete from usage_events")
    ) {
      if (statement.startsWith("delete from collaboration_versions")) this.checkpoints.clear();
      if (statement.startsWith("delete from collaboration_sessions")) this.collaborations.clear();
      if (statement.startsWith("delete from published_previews")) this.previews.clear();
      this.changes = 0;
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

  it("paginates and filters full ledger history and exports the account data", async () => {
    const database = new MemoryD1Database();
    const created = await provision(
      database,
      "e".repeat(64),
      "823e4567-e89b-42d3-a456-426614174000",
    );
    const wallet = await created.json() as WalletResponse;
    for (let index = 0; index < 53; index += 1) {
      const createdAt = new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString();
      const id = `ledger-${String(index).padStart(3, "0")}`;
      database.ledger.set(id, {
        id,
        account_id: wallet.accountId,
        delta: index % 2 === 0 ? 1 : -1,
        reason: index % 2 === 0 ? "daily_refill" : "action:ai_generate",
        metadata_json: index === 1
          ? JSON.stringify({ email: "private@example.com", prompt: "private prompt", promptTokens: 17 })
          : "{}",
        created_at: createdAt,
      });
    }

    const request = (path: string) => app.request(
      path,
      { headers: { Authorization: `Bearer ${wallet.token}` } },
      environment(database),
    );
    const walletResponse = await request("/wallet/me");
    const walletSummary = await walletResponse.json() as {
      recentLedger: Array<{ id: string; metadata_json: string }>;
    };
    const recentSensitiveEntry = walletSummary.recentLedger.find((entry) => entry.id === "ledger-001");
    expect(recentSensitiveEntry).toBeDefined();
    expect(JSON.parse(recentSensitiveEntry!.metadata_json)).toEqual({ promptTokens: 17 });

    const firstPageResponse = await request("/wallet/ledger?limit=50");
    const firstPage = await firstPageResponse.json() as {
      entries: Array<{ id: string; reason: string }>;
      nextCursor: string | null;
    };
    expect(firstPageResponse.status).toBe(200);
    expect(firstPage.entries).toHaveLength(50);
    expect(firstPage.nextCursor).toBeTruthy();

    const secondPageResponse = await request(
      `/wallet/ledger?limit=50&cursor=${encodeURIComponent(firstPage.nextCursor!)}`,
    );
    const secondPage = await secondPageResponse.json() as typeof firstPage;
    expect(secondPage.entries).toHaveLength(4);
    expect(secondPage.nextCursor).toBeNull();
    expect(new Set([...firstPage.entries, ...secondPage.entries].map((entry) => entry.id)).size).toBe(54);

    const filteredResponse = await request("/wallet/ledger?reason=daily_refill");
    const filtered = await filteredResponse.json() as typeof firstPage;
    expect(filtered.entries).toHaveLength(27);
    expect(filtered.entries.every((entry) => entry.reason === "daily_refill")).toBe(true);
    expect((await request("/wallet/ledger?limit=51")).status).toBe(400);
    expect((await request("/wallet/ledger?reason=email")).status).toBe(400);

    const createdAt = new Date().toISOString();
    const sessionId = "abcdefghijklmnopqrstuvwx";
    database.previews.set("abcdefgh", {
      id: "abcdefgh",
      account_id: wallet.accountId,
      project_name: "Sample project",
      object_key: "previews/abcdefgh/index.html",
      created_at: createdAt,
      expires_at: new Date(Date.now() + 60_000).toISOString(),
      size_bytes: 2048,
      view_count: 3,
    });
    database.collaborations.set(sessionId, {
      id: sessionId,
      account_id: wallet.accountId,
      project_name: "Shared project",
      object_key: `collaboration/${sessionId}/initial.json`,
      created_at: createdAt,
      last_activity_at: createdAt,
      expires_at: new Date(Date.now() + 60_000).toISOString(),
      view_only: 1,
      ended_at: null,
    });
    database.checkpoints.set("checkpoint-1", {
      id: "checkpoint-1",
      session_id: sessionId,
      object_key: `collaboration/${sessionId}/versions/checkpoint-1.json`,
      created_at: createdAt,
      size_bytes: 1024,
    });

    const exportResponse = await request("/account/export");
    const exported = await exportResponse.json() as {
      schemaVersion: number;
      account: { deviceIdHash: string; email: string | null };
      wallet: { balance: number; lifetimeGranted: number; lifetimeSpent: number };
      ledger: Array<{ id: string; metadata: Record<string, unknown> }>;
      cloudData: {
        publishedPreviews: Array<{ id: string; projectName: string; sizeBytes: number }>;
        collaborations: Array<{
          id: string;
          projectName: string;
          viewOnly: boolean;
          checkpoints: Array<{ createdAt: string; sizeBytes: number }>;
        }>;
      };
    };
    expect(exportResponse.status).toBe(200);
    expect(exported).toMatchObject({
      schemaVersion: 2,
      account: { deviceIdHash: "e".repeat(64), email: null },
      wallet: { balance: 50, lifetimeGranted: 50, lifetimeSpent: 0 },
    });
    expect(exported.ledger).toHaveLength(54);
    expect(exported.ledger.find((entry) => entry.id === "ledger-001")).toMatchObject({
      metadata: { promptTokens: 17 },
    });
    expect(exported.cloudData).toMatchObject({
      publishedPreviews: [{ id: "abcdefgh", projectName: "Sample project", sizeBytes: 2048 }],
      collaborations: [{
        id: sessionId,
        projectName: "Shared project",
        viewOnly: true,
        checkpoints: [{ createdAt, sizeBytes: 1024 }],
      }],
    });
    expect(JSON.stringify(exported.ledger)).not.toContain("private@example.com");
    expect(JSON.stringify(exported.ledger)).not.toContain("private prompt");
  });

  it("soft-deletes only after typed confirmation and rejects the old session", async () => {
    const database = new MemoryD1Database();
    const created = await provision(
      database,
      "f".repeat(64),
      "923e4567-e89b-42d3-a456-426614174000",
    );
    const wallet = await created.json() as WalletResponse;
    const request = (body: string) => app.request(
      "/account/data",
      {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${wallet.token}`,
          "Content-Type": "application/json",
        },
        body,
      },
      environment(database),
    );

    expect((await request(JSON.stringify({ confirmation: "delete" }))).status).toBe(400);
    const deletion = await request(JSON.stringify({ confirmation: "DELETE" }));
    const result = await deletion.json() as {
      deleted: boolean;
      purgeAfter: string;
      cloudContentRemoved: boolean;
    };
    expect(deletion.status).toBe(200);
    expect(result.deleted).toBe(true);
    expect(result.cloudContentRemoved).toBe(true);
    expect(Date.parse(result.purgeAfter) - Date.now()).toBeGreaterThan(29 * 24 * 60 * 60 * 1000);
    expect(database.wallets.get(wallet.accountId)?.balance).toBe(50);
    expect(database.accounts.get(wallet.accountId)?.deleted_at).toBeTruthy();

    const staleSession = await app.request(
      "/wallet/me",
      { headers: { Authorization: `Bearer ${wallet.token}` } },
      environment(database),
    );
    expect(staleSession.status).toBe(401);
    const sameIdentity = await provision(
      database,
      "f".repeat(64),
      "923e4567-e89b-42d3-a456-426614174000",
    );
    expect(sameIdentity.status).toBe(410);
  });

  it("removes published previews and collaboration checkpoints when cloud deletion is requested", async () => {
    const database = new MemoryD1Database();
    const created = await provision(
      database,
      "b".repeat(64),
      "b23e4567-e89b-42d3-a456-426614174000",
    );
    const wallet = await created.json() as WalletResponse;
    const sessionId = "abcdefghijklmnopqrstuvwx";
    database.previews.set("abcdefgh", {
      id: "abcdefgh",
      account_id: wallet.accountId,
      project_name: "Sample project",
      object_key: "previews/abcdefgh/index.html",
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 60_000).toISOString(),
      size_bytes: 2048,
      view_count: 3,
    });
    database.collaborations.set(sessionId, {
      id: sessionId,
      account_id: wallet.accountId,
      project_name: "Shared project",
      object_key: `collaboration/${sessionId}/initial.json`,
      created_at: new Date().toISOString(),
      last_activity_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 60_000).toISOString(),
      view_only: 0,
      ended_at: null,
    });
    database.checkpoints.set("checkpoint-1", {
      id: "checkpoint-1",
      session_id: sessionId,
      object_key: `collaboration/${sessionId}/versions/checkpoint-1.json`,
      created_at: new Date().toISOString(),
      size_bytes: 1024,
    });
    const assets = {
      delete: async (key: string) => {
        database.deletedAssetKeys.push(key);
      },
    } as unknown as R2Bucket;
    const collaboration = {
      idFromName: (id: string) => id,
      get: (id: string) => ({
        fetch: async () => {
          database.erasedCollaborationIds.push(id);
          return Response.json({ erased: true });
        },
      }),
    } as unknown as DurableObjectNamespace;
    const request = app.request(
      "/account/data",
      {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${wallet.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ confirmation: "DELETE" }),
      },
      environment(database, { ASSETS: assets, COLLABORATION: collaboration }),
    );

    const response = await request;
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ deleted: true, cloudContentRemoved: true });
    expect(database.deletedAssetKeys).toEqual([
      "previews/abcdefgh/index.html",
      `collaboration/${sessionId}/initial.json`,
      `collaboration/${sessionId}/versions/checkpoint-1.json`,
    ]);
    expect(database.erasedCollaborationIds).toEqual([sessionId]);
    expect(database.previews.size).toBe(0);
    expect(database.collaborations.size).toBe(0);
    expect(database.checkpoints.size).toBe(0);
  });

  it("reports when cloud content cleanup needs a scheduled retry", async () => {
    const database = new MemoryD1Database();
    const created = await provision(
      database,
      "c".repeat(64),
      "c23e4567-e89b-42d3-a456-426614174000",
    );
    const wallet = await created.json() as WalletResponse;
    database.previews.set("abcdefgh", {
      id: "abcdefgh",
      account_id: wallet.accountId,
      project_name: "Sample project",
      object_key: "previews/abcdefgh/index.html",
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 60_000).toISOString(),
      size_bytes: 2048,
      view_count: 3,
    });
    const assets = {
      delete: async () => {
        throw new Error("storage unavailable");
      },
    } as unknown as R2Bucket;
    const response = await app.request(
      "/account/data",
      {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${wallet.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ confirmation: "DELETE" }),
      },
      environment(database, { ASSETS: assets }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ deleted: true, cloudContentRemoved: false });
    expect(database.accounts.get(wallet.accountId)?.deleted_at).toBeTruthy();
    expect(database.previews.has("abcdefgh")).toBe(true);

    await runScheduledTasks(environment(database, {
      ASSETS: { delete: async () => undefined } as unknown as R2Bucket,
    }));

    expect(database.previews.has("abcdefgh")).toBe(false);
    expect(database.wallets.has(wallet.accountId)).toBe(true);
  });

  it("retries pending cloud-content deletion before hard-deleting the account", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-20T12:00:00.000Z"));
    const database = new MemoryD1Database();
    const created = await provision(
      database,
      "a".repeat(64),
      "a23e4567-e89b-42d3-a456-426614174000",
    );
    const wallet = await created.json() as WalletResponse;
    const account = database.accounts.get(wallet.accountId);
    if (!account) throw new Error("Test account was not provisioned.");
    account.email = "owner@example.com";
    account.deleted_at = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();
    database.dailyGrants.set(wallet.accountId, {
      granted_at: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString(),
      amount: 20,
    });
    database.ipActivity.set(`hash:${wallet.accountId}`, {
      ip_hash: "hash",
      account_id: wallet.accountId,
      last_seen_at: new Date().toISOString(),
    });
    database.dailyIpGrants.set("hash", {
      account_id: wallet.accountId,
      granted_at: new Date().toISOString(),
    });

    await runScheduledTasks(environment(database));

    expect(database.wallets.has(wallet.accountId)).toBe(false);
    expect([...database.ledger.values()].some((entry) => entry.account_id === wallet.accountId)).toBe(false);
    expect(database.dailyGrants.has(wallet.accountId)).toBe(false);
    expect([...database.ipActivity.values()].some((entry) => entry.account_id === wallet.accountId)).toBe(false);
    expect(database.dailyIpGrants.has("hash")).toBe(false);
    expect(database.accounts.has(wallet.accountId)).toBe(false);
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
    expect([...database.ledger.values()].filter((entry) => entry.reason === "daily_refill")).toHaveLength(1);

    const repeatedClaim = await claim();
    expect(repeatedClaim.status).toBe(409);
    expect(await repeatedClaim.json()).toMatchObject({
      error: { code: "DAILY_ALREADY_CLAIMED" },
      balance: 100,
    });
    expect([...database.ledger.values()].filter((entry) => entry.reason === "daily_refill")).toHaveLength(1);
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

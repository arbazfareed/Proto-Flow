import { createRemoteJWKSet, jwtVerify } from "jose";
import type { Context, Hono } from "hono";
import type { AuthClaims, WorkerEnv } from "./env";
import { errorResponse } from "./errors";

type AdminApp = Hono<{ Bindings: WorkerEnv; Variables: { auth: AuthClaims } }>;
type AdminContext = Context<{ Bindings: WorkerEnv; Variables: { auth: AuthClaims } }>;
type AdminIdentity = { email: string };
type AdminHandler = (context: AdminContext, identity: AdminIdentity) => Response | Promise<Response>;

interface LedgerRow {
  id: string;
  delta: number;
  reason: string;
  metadata_json: string;
  created_at: string;
}

const MAX_BODY_BYTES = 16 * 1024;
const MAX_ACCOUNT_QUERY_LENGTH = 160;
const MAX_ADJUSTMENT = 10_000;
const MAX_WALLET_BALANCE = 100;
const MAX_BULK_IDS = 50;
const SAFE_METADATA_KEYS = new Set(["inputTokens", "promptTokens", "completionTokens", "outputTokens", "assetCount"]);
const remoteJwks = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function normalizeTeamDomain(value: string): string | null {
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      !url.hostname.endsWith(".cloudflareaccess.com") ||
      url.pathname !== "/" ||
      url.search ||
      url.hash ||
      url.username ||
      url.password
    ) return null;
    return url.origin;
  } catch {
    return null;
  }
}

function getRemoteJwks(teamDomain: string): ReturnType<typeof createRemoteJWKSet> {
  let jwks = remoteJwks.get(teamDomain);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`${teamDomain}/cdn-cgi/access/certs`));
    remoteJwks.set(teamDomain, jwks);
  }
  return jwks;
}

async function getAdminIdentity(context: AdminContext): Promise<AdminIdentity | Response> {
  const teamDomainSetting = context.env.ADMIN_ACCESS_TEAM_DOMAIN?.trim() ?? "";
  const audience = context.env.ADMIN_ACCESS_AUD?.trim() ?? "";
  const allowedEmails = new Set(
    (context.env.ADMIN_ALLOWED_EMAILS ?? "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );
  const teamDomain = normalizeTeamDomain(teamDomainSetting);
  if (!teamDomain || !audience || allowedEmails.size === 0) {
    return errorResponse(context, 503, "ADMIN_NOT_CONFIGURED", "Cloudflare Access admin settings are not configured.");
  }

  const token = context.req.header("Cf-Access-Jwt-Assertion");
  if (!token || token.length > 8192) {
    return errorResponse(context, 401, "ADMIN_ACCESS_REQUIRED", "A valid Cloudflare Access identity is required.");
  }
  try {
    const { payload } = await jwtVerify(token, getRemoteJwks(teamDomain), {
      issuer: teamDomain,
      audience,
      algorithms: ["RS256"],
    });
    const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
    if (!email || !allowedEmails.has(email)) {
      return errorResponse(context, 403, "ADMIN_NOT_ALLOWED", "This identity is not on the admin allowlist.");
    }
    return { email };
  } catch (error) {
    console.warn("Admin Access token validation failed.", {
      message: error instanceof Error ? error.message : "Invalid Access token.",
    });
    return errorResponse(context, 401, "ADMIN_ACCESS_REQUIRED", "A valid Cloudflare Access identity is required.");
  }
}

function withAdmin(handler: AdminHandler) {
  return async (context: AdminContext) => {
    const identity = await getAdminIdentity(context);
    if (identity instanceof Response) return identity;
    try {
      return await handler(context, identity);
    } catch (error) {
      console.error("Admin operation failed.", {
        path: context.req.path,
        method: context.req.method,
        message: error instanceof Error ? error.message : "Unknown admin operation error.",
      });
      return errorResponse(context, 503, "ADMIN_OPERATION_FAILED", "The admin operation could not be completed.");
    }
  };
}

async function readJson(context: AdminContext): Promise<Record<string, unknown> | null> {
  const contentLength = Number(context.req.header("Content-Length") ?? 0);
  if (contentLength > MAX_BODY_BYTES) return null;
  try {
    const text = await context.req.text();
    if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) return null;
    const value: unknown = JSON.parse(text);
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function safeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

function safeMetadata(metadataJson: string): Record<string, number> {
  let value: unknown;
  try {
    value = JSON.parse(metadataJson);
  } catch {
    return {};
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const safe: Record<string, number> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (SAFE_METADATA_KEYS.has(key) && safeInteger(item) && item >= 0) safe[key] = item;
  }
  return safe;
}

function encodeCursor(createdAt: string, id: string): string {
  const encoded = btoa(JSON.stringify([createdAt, id]));
  return encoded.replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function decodeCursor(value: string | undefined): { createdAt: string; id: string } | null | false {
  if (!value) return null;
  if (!/^[A-Za-z\d_-]{1,256}$/.test(value)) return false;
  try {
    const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
    const parsed: unknown = JSON.parse(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "=")));
    if (
      !Array.isArray(parsed) || parsed.length !== 2 || typeof parsed[0] !== "string" ||
      !Number.isFinite(Date.parse(parsed[0])) || typeof parsed[1] !== "string" || !parsed[1]
    ) return false;
    return { createdAt: parsed[0], id: parsed[1] };
  } catch {
    return false;
  }
}

function parseDetails(value: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function costRate(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export function registerAdminRoutes(app: AdminApp): void {
  app.get("/admin/me", withAdmin((_context, identity) =>
    Response.json({ email: identity.email }),
  ));

  app.get("/admin/accounts", withAdmin(async (context) => {
    const rawQuery = (context.req.query("q") ?? "").trim();
    if (rawQuery.length > MAX_ACCOUNT_QUERY_LENGTH) {
      return errorResponse(context, 400, "BAD_REQUEST", "Search text is too long.");
    }
    const rawLimit = context.req.query("limit") ?? "50";
    const limit = /^\d{1,2}$/.test(rawLimit) ? Number(rawLimit) : Number.NaN;
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
      return errorResponse(context, 400, "BAD_REQUEST", "Account page size must be between 1 and 50.");
    }
    const cursor = decodeCursor(context.req.query("cursor"));
    if (cursor === false) return errorResponse(context, 400, "BAD_REQUEST", "The account cursor is invalid.");

    const predicates = ["a.merged_into IS NULL", "a.deleted_at IS NULL"];
    const bindings: Array<string | number> = [];
    if (rawQuery) {
      predicates.push("(instr(lower(a.id), lower(?)) > 0 OR instr(lower(a.device_fingerprint), lower(?)) > 0 OR instr(lower(COALESCE(a.email, '')), lower(?)) > 0)");
      bindings.push(rawQuery, rawQuery, rawQuery);
    }
    if (cursor) {
      predicates.push("(a.created_at < ? OR (a.created_at = ? AND a.id < ?))");
      bindings.push(cursor.createdAt, cursor.createdAt, cursor.id);
    }
    const result = await context.env.DB
      .prepare(
        `SELECT a.id, a.device_fingerprint, a.email, a.created_at,
                COALESCE(w.balance, 0) AS balance,
                COALESCE(w.lifetime_granted, 0) AS lifetime_granted,
                COALESCE(w.lifetime_spent, 0) AS lifetime_spent,
                (SELECT COUNT(*) FROM abuse_flags AS f
                 WHERE f.account_id = a.id AND f.cleared_at IS NULL AND f.expires_at > ?) AS active_flag_count
         FROM accounts AS a LEFT JOIN wallets AS w ON w.account_id = a.id
         WHERE ${predicates.join(" AND ")}
         ORDER BY a.created_at DESC, a.id DESC LIMIT ?`,
      )
      .bind(Math.floor(Date.now() / 1000), ...bindings, limit + 1)
      .all<{
        id: string;
        device_fingerprint: string;
        email: string | null;
        created_at: string;
        balance: number;
        lifetime_granted: number;
        lifetime_spent: number;
        active_flag_count: number;
      }>();
    if (!result.success) throw new Error("Could not read admin account list.");
    const hasMore = result.results.length > limit;
    const accounts = result.results.slice(0, limit);
    const last = accounts.at(-1);
    return context.json({
      accounts: accounts.map((row) => ({
        id: row.id,
        deviceIdHash: row.device_fingerprint,
        email: row.email,
        createdAt: row.created_at,
        balance: row.balance,
        lifetimeGranted: row.lifetime_granted,
        lifetimeSpent: row.lifetime_spent,
        activeFlagCount: row.active_flag_count,
      })),
      nextCursor: hasMore && last ? encodeCursor(last.created_at, last.id) : null,
    });
  }));

  app.get("/admin/accounts/:id", withAdmin(async (context) => {
    const accountId = context.req.param("id");
    const account = await context.env.DB
      .prepare(
        `SELECT a.id, a.device_fingerprint, a.email, a.created_at, a.last_seen_at,
                w.balance, w.lifetime_granted, w.lifetime_spent
         FROM accounts AS a LEFT JOIN wallets AS w ON w.account_id = a.id
         WHERE a.id = ? AND a.merged_into IS NULL AND a.deleted_at IS NULL`,
      )
      .bind(accountId)
      .first<{
        id: string;
        device_fingerprint: string;
        email: string | null;
        created_at: string;
        last_seen_at: string;
        balance: number | null;
        lifetime_granted: number | null;
        lifetime_spent: number | null;
      }>();
    if (!account) return errorResponse(context, 404, "NOT_FOUND", "The account was not found.");
    const [ledger, flags] = await Promise.all([
      context.env.DB
        .prepare("SELECT id, delta, reason, metadata_json, created_at FROM ledger WHERE account_id = ? ORDER BY created_at DESC, id DESC LIMIT 50")
        .bind(accountId)
        .all<LedgerRow>(),
      context.env.DB
        .prepare("SELECT id, reason, mode, flagged_at, expires_at, cleared_at FROM abuse_flags WHERE account_id = ? ORDER BY flagged_at DESC LIMIT 100")
        .bind(accountId)
        .all<{ id: string; reason: string; mode: string; flagged_at: number; expires_at: number; cleared_at: number | null }>(),
    ]);
    return context.json({
      account: {
        id: account.id,
        deviceIdHash: account.device_fingerprint,
        email: account.email,
        createdAt: account.created_at,
        lastSeenAt: account.last_seen_at,
      },
      wallet: {
        balance: account.balance ?? 0,
        lifetimeGranted: account.lifetime_granted ?? 0,
        lifetimeSpent: account.lifetime_spent ?? 0,
      },
      ledger: ledger.results.map((entry) => ({
        id: entry.id,
        delta: entry.delta,
        reason: entry.reason,
        metadata: safeMetadata(entry.metadata_json),
        createdAt: entry.created_at,
      })),
      flags: flags.results.map((flag) => ({
        id: flag.id,
        reason: flag.reason,
        mode: flag.mode,
        flaggedAt: flag.flagged_at,
        expiresAt: flag.expires_at,
        clearedAt: flag.cleared_at,
      })),
    });
  }));

  app.post("/admin/accounts/:id/adjust", withAdmin(async (context, identity) => {
    const body = await readJson(context);
    if (!body || !safeInteger(body.delta) || body.delta === 0 || Math.abs(body.delta) > MAX_ADJUSTMENT) {
      return errorResponse(context, 400, "BAD_REQUEST", "Provide a non-zero integer adjustment within 10,000 credits.");
    }
    if (typeof body.reason !== "string" || !body.reason.trim() || body.reason.trim().length > 200) {
      return errorResponse(context, 400, "BAD_REQUEST", "A reason of 1–200 characters is required.");
    }
    const accountId = context.req.param("id");
    const delta = body.delta;
    const reason = body.reason.trim();
    const now = new Date().toISOString();
    const results = await context.env.DB.batch([
      context.env.DB
        .prepare(
          `UPDATE wallets SET balance = balance + ?,
             lifetime_granted = lifetime_granted + CASE WHEN ? > 0 THEN ? ELSE 0 END,
             lifetime_spent = lifetime_spent + CASE WHEN ? < 0 THEN -? ELSE 0 END,
             updated_at = ?
             WHERE account_id = ?
               AND EXISTS (SELECT 1 FROM accounts WHERE id = ? AND merged_into IS NULL AND deleted_at IS NULL)
               AND balance + ? >= 0 AND balance + ? <= ?`,
        )
          .bind(delta, delta, delta, delta, delta, now, accountId, accountId, delta, delta, MAX_WALLET_BALANCE),
      context.env.DB
        .prepare(
          `INSERT INTO ledger (id, account_id, delta, reason, metadata_json, created_at)
           SELECT ?, ?, ?, 'admin_adjust', '{}', ? WHERE changes() = 1`,
        )
        .bind(crypto.randomUUID(), accountId, delta, now),
      context.env.DB
        .prepare(
          `INSERT INTO admin_audit (id, actor_email, action, target_account_id, details_json, created_at)
           SELECT ?, ?, 'credit_adjust', ?, ?, ? WHERE changes() = 1`,
        )
        .bind(crypto.randomUUID(), identity.email, accountId, JSON.stringify({ delta, reason }), now),
    ]);
    if ((results[0]?.meta?.changes ?? 0) !== 1) {
      return errorResponse(context, 409, "ADJUSTMENT_REJECTED", "The account is missing or the adjustment would exceed wallet limits.");
    }
    const updated = await context.env.DB
      .prepare("SELECT balance FROM wallets WHERE account_id = ?")
      .bind(accountId)
      .first<{ balance: number }>();
    return context.json({ adjusted: true, balance: updated?.balance ?? null });
  }));

  app.get("/admin/flags", withAdmin(async (context) => {
    const includeCleared = context.req.query("includeCleared") === "true";
    const result = await context.env.DB
      .prepare(
        `SELECT f.id, f.scope, f.scope_key, f.account_id, f.reason, f.mode,
                f.flagged_at, f.expires_at, f.cleared_at,
                a.email, a.device_fingerprint
         FROM abuse_flags AS f LEFT JOIN accounts AS a ON a.id = f.account_id
         ${includeCleared ? "" : "WHERE f.cleared_at IS NULL AND f.expires_at > ?"}
         ORDER BY f.flagged_at DESC LIMIT 200`,
      )
      .bind(...(includeCleared ? [] : [Math.floor(Date.now() / 1000)]))
      .all<{
        id: string; scope: string; scope_key: string; account_id: string | null; reason: string;
        mode: string; flagged_at: number; expires_at: number; cleared_at: number | null;
        email: string | null; device_fingerprint: string | null;
      }>();
    return context.json({ flags: result.results.map((row) => ({
      id: row.id,
      scope: row.scope,
      scopeKey: row.scope_key,
      accountId: row.account_id,
      email: row.email,
      deviceIdHash: row.device_fingerprint,
      reason: row.reason,
      mode: row.mode,
      flaggedAt: row.flagged_at,
      expiresAt: row.expires_at,
      clearedAt: row.cleared_at,
    })) });
  }));

  app.post("/admin/flags/unflag", withAdmin(async (context, identity) => {
    const body = await readJson(context);
    if (!body || !Array.isArray(body.ids) || body.ids.length < 1 || body.ids.length > MAX_BULK_IDS ||
        !body.ids.every((id) => typeof id === "string" && id.length <= 128)) {
      return errorResponse(context, 400, "BAD_REQUEST", "Provide 1–50 flag IDs to clear.");
    }
    const now = Math.floor(Date.now() / 1000);
    const statements: D1PreparedStatement[] = [];
    for (const id of [...new Set(body.ids as string[])]) {
      statements.push(
        context.env.DB.prepare("UPDATE abuse_flags SET cleared_at = ? WHERE id = ? AND cleared_at IS NULL").bind(now, id),
        context.env.DB.prepare(
          `INSERT INTO admin_audit (id, actor_email, action, target_account_id, details_json)
           SELECT ?, ?, 'flag_cleared', account_id, ? FROM abuse_flags WHERE id = ? AND cleared_at = ? AND changes() = 1`,
        ).bind(crypto.randomUUID(), identity.email, JSON.stringify({ flagId: id }), id, now),
      );
    }
    let cleared = 0;
    for (let offset = 0; offset < statements.length; offset += 80) {
      const result = await context.env.DB.batch(statements.slice(offset, offset + 80));
      if (result.some((row) => !row.success)) throw new Error("Bulk flag clearing did not complete.");
      cleared += result.reduce((count, row, index) => index % 2 === 0 ? count + (row.meta?.changes ?? 0) : count, 0);
    }
    return context.json({ cleared });
  }));

  app.post("/admin/accounts/:id/soft-ban", withAdmin(async (context, identity) => {
    const body = await readJson(context);
    if (!body || typeof body.reason !== "string" || !body.reason.trim() || body.reason.trim().length > 200) {
      return errorResponse(context, 400, "BAD_REQUEST", "A reason of 1–200 characters is required.");
    }
    const durationHours = body.durationHours === undefined ? 24 : body.durationHours;
    if (!safeInteger(durationHours) || durationHours < 1 || durationHours > 24 * 30) {
      return errorResponse(context, 400, "BAD_REQUEST", "Soft-ban duration must be between 1 and 720 hours.");
    }
    const accountId = context.req.param("id");
    const now = Math.floor(Date.now() / 1000);
    const flagId = crypto.randomUUID();
    const reason = body.reason.trim();
    const account = await context.env.DB
      .prepare("SELECT id FROM accounts WHERE id = ? AND merged_into IS NULL AND deleted_at IS NULL")
      .bind(accountId)
      .first<{ id: string }>();
    if (!account) return errorResponse(context, 404, "NOT_FOUND", "The account was not found.");
    const results = await context.env.DB.batch([
      context.env.DB.prepare(
        `INSERT INTO abuse_flags (id, scope, scope_key, account_id, reason, mode, flagged_at, expires_at)
         VALUES (?, 'account', ?, ?, ?, 'read_only', ?, ?)`,
      ).bind(flagId, accountId, accountId, `admin_soft_ban:${reason}`, now, now + durationHours * 3600),
      context.env.DB.prepare(
        `INSERT INTO admin_audit (id, actor_email, action, target_account_id, details_json)
         VALUES (?, ?, 'soft_ban', ?, ?)`,
      ).bind(crypto.randomUUID(), identity.email, accountId, JSON.stringify({ flagId, reason, durationHours })),
    ]);
    if (results.some((result) => !result.success)) throw new Error("Could not write soft-ban and audit event.");
    return context.json({ flagged: true, flagId, expiresAt: now + durationHours * 3600 });
  }));

  app.post("/admin/daily-grants/reissue", withAdmin(async (context, identity) => {
    const body = await readJson(context);
    if (!body || !Array.isArray(body.accountIds) || body.accountIds.length < 1 || body.accountIds.length > MAX_BULK_IDS ||
        !body.accountIds.every((id) => typeof id === "string" && id.length <= 128)) {
      return errorResponse(context, 400, "BAD_REQUEST", "Provide 1–50 account IDs to re-issue daily refills.");
    }
    if (typeof body.reason !== "string" || !body.reason.trim() || body.reason.trim().length > 200) {
      return errorResponse(context, 400, "BAD_REQUEST", "A reason of 1–200 characters is required.");
    }
    const now = new Date().toISOString();
    const accountIds = [...new Set(body.accountIds as string[])];
    const statements: D1PreparedStatement[] = [];
    for (const [index, accountId] of accountIds.entries()) {
      const grantId = crypto.randomUUID();
      const grantAt = new Date(Date.now() + index).toISOString();
      statements.push(
        context.env.DB.prepare(
          `INSERT OR IGNORE INTO daily_grants (account_id, granted_at, amount)
           SELECT ?, ?, MIN(20, 100 - balance) FROM wallets
           WHERE account_id = ? AND balance < 100
             AND EXISTS (SELECT 1 FROM accounts WHERE id = ? AND merged_into IS NULL AND deleted_at IS NULL)
             AND NOT EXISTS (SELECT 1 FROM daily_grants WHERE account_id = ? AND granted_at = ?)`,
        ).bind(accountId, grantAt, accountId, accountId, accountId, grantAt),
        context.env.DB.prepare(
          `UPDATE wallets SET balance = balance + (SELECT amount FROM daily_grants WHERE account_id = ? AND granted_at = ?),
             lifetime_granted = lifetime_granted + (SELECT amount FROM daily_grants WHERE account_id = ? AND granted_at = ?), updated_at = ?
           WHERE account_id = ? AND changes() = 1`,
        ).bind(accountId, grantAt, accountId, grantAt, now, accountId),
        context.env.DB.prepare(
          `INSERT INTO ledger (id, account_id, delta, reason, metadata_json, created_at)
           SELECT ?, ?, amount, 'daily_refill', '{}', ? FROM daily_grants WHERE account_id = ? AND granted_at = ? AND changes() = 1`,
        ).bind(grantId, accountId, now, accountId, grantAt),
        context.env.DB.prepare(
          `INSERT INTO admin_audit (id, actor_email, action, target_account_id, details_json, created_at)
           SELECT ?, ?, 'daily_refill_reissued', ?, ?, ? WHERE changes() = 1`,
        ).bind(crypto.randomUUID(), identity.email, accountId, JSON.stringify({ reason: body.reason.trim(), grantId }), now),
      );
    }
    let reissued = 0;
    for (let offset = 0; offset < statements.length; offset += 80) {
      const results = await context.env.DB.batch(statements.slice(offset, offset + 80));
      if (results.some((result) => !result.success)) throw new Error("Bulk daily refill reissue did not complete.");
      reissued += results.reduce((count, result, index) => index % 4 === 0 ? count + (result.meta?.changes ?? 0) : count, 0);
    }
    return context.json({ reissued, requested: accountIds.length });
  }));

  app.get("/admin/audit", withAdmin(async (context) => {
    const rawLimit = context.req.query("limit") ?? "50";
    const limit = /^\d{1,2}$/.test(rawLimit) ? Number(rawLimit) : Number.NaN;
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
      return errorResponse(context, 400, "BAD_REQUEST", "Audit page size must be between 1 and 50.");
    }
    const cursor = decodeCursor(context.req.query("cursor"));
    if (cursor === false) return errorResponse(context, 400, "BAD_REQUEST", "The audit cursor is invalid.");
    const conditions: string[] = [];
    const parameters: Array<string | number> = [];
    if (cursor) {
      conditions.push("(created_at < ? OR (created_at = ? AND id < ?))");
      parameters.push(cursor.createdAt, cursor.createdAt, cursor.id);
    }
    const result = await context.env.DB
      .prepare(
        `SELECT id, actor_email, action, target_account_id, details_json, created_at
         FROM admin_audit ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""}
         ORDER BY created_at DESC, id DESC LIMIT ?`,
      )
      .bind(...parameters, limit + 1)
      .all<{ id: string; actor_email: string; action: string; target_account_id: string | null; details_json: string; created_at: string }>();
    const hasMore = result.results.length > limit;
    const rows = result.results.slice(0, limit);
    const last = rows.at(-1);
    return context.json({
      entries: rows.map((row) => ({
        id: row.id,
        actorEmail: row.actor_email,
        action: row.action,
        targetAccountId: row.target_account_id,
        details: parseDetails(row.details_json),
        createdAt: row.created_at,
      })),
      nextCursor: hasMore && last ? encodeCursor(last.created_at, last.id) : null,
    });
  }));

  app.get("/admin/metrics", withAdmin(async (context) => {
    const rawDays = context.req.query("days") ?? "30";
    const days = /^\d{1,2}$/.test(rawDays) ? Number(rawDays) : Number.NaN;
    if (!Number.isInteger(days) || days < 1 || days > 90) {
      return errorResponse(context, 400, "BAD_REQUEST", "Metrics range must be between 1 and 90 days.");
    }
    const todayUtc = new Date();
    const firstDay = new Date(Date.UTC(
      todayUtc.getUTCFullYear(),
      todayUtc.getUTCMonth(),
      todayUtc.getUTCDate() - (days - 1),
    ));
    const since = firstDay.toISOString();
    const [signups, usage, credits] = await Promise.all([
      context.env.DB.prepare("SELECT date(created_at) AS day, COUNT(*) AS count FROM accounts WHERE created_at >= ? AND merged_into IS NULL GROUP BY date(created_at)")
        .bind(since).all<{ day: string; count: number }>(),
      context.env.DB.prepare(
        `SELECT date(created_at) AS day, event_type, COUNT(*) AS count,
                SUM(COALESCE(json_extract(metadata_json, '$.inputTokens'), 0)) AS input_tokens,
                SUM(COALESCE(json_extract(metadata_json, '$.outputTokens'), 0)) AS output_tokens,
                SUM(COALESCE(json_extract(metadata_json, '$.assetBytes'), 0)) AS asset_bytes
         FROM usage_events WHERE created_at >= ? GROUP BY date(created_at), event_type`,
      ).bind(since).all<{ day: string; event_type: string; count: number; input_tokens: number; output_tokens: number; asset_bytes: number }>(),
      context.env.DB.prepare(
        `SELECT date(created_at) AS day,
                SUM(CASE WHEN delta > 0 THEN delta ELSE 0 END) AS granted,
                SUM(CASE WHEN delta < 0 THEN -delta ELSE 0 END) AS spent,
                COUNT(*) AS entries
         FROM ledger WHERE created_at >= ? GROUP BY date(created_at)`,
      ).bind(since).all<{ day: string; granted: number; spent: number; entries: number }>(),
    ]);
    const byDay = new Map<string, {
      signups: number; aiCalls: number; publishCalls: number; codeExports: number;
      creditsGranted: number; creditsSpent: number; inputTokens: number; outputTokens: number;
      assetBytes: number; ledgerEntries: number;
    }>();
    const getDay = (day: string) => {
      let value = byDay.get(day);
      if (!value) {
        value = { signups: 0, aiCalls: 0, publishCalls: 0, codeExports: 0, creditsGranted: 0, creditsSpent: 0, inputTokens: 0, outputTokens: 0, assetBytes: 0, ledgerEntries: 0 };
        byDay.set(day, value);
      }
      return value;
    };
    for (const row of signups.results) getDay(row.day).signups = row.count;
    for (const row of usage.results) {
      const day = getDay(row.day);
      if (row.event_type === "ai_generate") day.aiCalls = row.count;
      if (row.event_type === "cloud_publish") day.publishCalls = row.count;
      if (row.event_type === "code_export") day.codeExports = row.count;
      if (row.event_type === "ai_generate") {
        day.inputTokens = row.input_tokens ?? 0;
        day.outputTokens = row.output_tokens ?? 0;
      }
      if (row.event_type === "cloud_publish") day.assetBytes = row.asset_bytes ?? 0;
    }
    for (const row of credits.results) {
      const day = getDay(row.day);
      day.creditsGranted = row.granted ?? 0;
      day.creditsSpent = row.spent ?? 0;
      day.ledgerEntries = row.entries ?? 0;
    }

    const inputRate = costRate(context.env.GEMINI_INPUT_USD_PER_MILLION, 0.1);
    const outputRate = costRate(context.env.GEMINI_OUTPUT_USD_PER_MILLION, 0.4);
    const r2Rate = costRate(context.env.R2_STORAGE_USD_PER_GB_MONTH, 0.015);
    const d1ReadRate = costRate(context.env.D1_READ_USD_PER_MILLION, 0.001);
    const d1WriteRate = costRate(context.env.D1_WRITE_USD_PER_MILLION, 1.0);
    const daily = Array.from({ length: days }, (_, offset) => {
      const day = new Date(firstDay.getTime() + offset * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const value = getDay(day);
      const estimatedGeminiUsd = value.inputTokens / 1_000_000 * inputRate + value.outputTokens / 1_000_000 * outputRate;
      const estimatedR2Usd = value.assetBytes / (1024 ** 3) * r2Rate / 30;
      const estimatedReads = value.signups * 4 + (value.aiCalls + value.publishCalls + value.codeExports) * 4 + value.ledgerEntries * 2;
      const estimatedWrites = value.signups * 3 + value.aiCalls + value.publishCalls + value.codeExports + value.ledgerEntries;
      const estimatedD1Usd = estimatedReads / 1_000_000 * d1ReadRate + estimatedWrites / 1_000_000 * d1WriteRate;
      return { day, ...value, estimatedGeminiUsd, estimatedR2Usd, estimatedD1Usd, estimatedTotalUsd: estimatedGeminiUsd + estimatedR2Usd + estimatedD1Usd };
    });
    return context.json({ days, estimatesAreApproximate: true, daily });
  }));
}

export async function recordUsageEvent(
  env: WorkerEnv,
  accountId: string,
  eventType: "ai_generate" | "cloud_publish" | "code_export",
  metadata: Record<string, number>,
): Promise<void> {
  const safe = Object.fromEntries(Object.entries(metadata).filter(([key]) => SAFE_METADATA_KEYS.has(key) || key === "assetBytes")
    .filter(([, value]) => safeInteger(value) && value >= 0));
  try {
    await env.DB.prepare("INSERT INTO usage_events (id, account_id, event_type, metadata_json) VALUES (?, ?, ?, ?)")
      .bind(crypto.randomUUID(), accountId, eventType, JSON.stringify(safe))
      .run();
  } catch (error) {
    console.error("Usage event could not be recorded.", {
      eventType,
      message: error instanceof Error ? error.message : "Unknown database error.",
    });
  }
}

async function deliverAlert(env: WorkerEnv, key: string, subject: string, message: string): Promise<void> {
  if (!env.ADMIN_ALERT_EMAIL && !env.ADMIN_ALERT_WEBHOOK_URL) return;
  const cacheKey = `admin-alert:${key}`;
  if (await env.CACHE.get(cacheKey)) return;
  let delivered = false;
  if (env.ADMIN_ALERT_WEBHOOK_URL) {
    try {
      const webhook = new URL(env.ADMIN_ALERT_WEBHOOK_URL);
      if (webhook.protocol !== "https:") throw new Error("Alert webhook must use HTTPS.");
      const response = await fetch(webhook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject, message, occurredAt: new Date().toISOString() }),
      });
      delivered ||= response.ok;
    } catch (error) {
      console.error("Admin alert webhook delivery failed.", { message: error instanceof Error ? error.message : "Unknown error." });
    }
  }
  if (env.ADMIN_ALERT_EMAIL && env.RESEND_API_KEY && env.AUTH_EMAIL_FROM) {
    try {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: env.AUTH_EMAIL_FROM, to: [env.ADMIN_ALERT_EMAIL], subject, text: message }),
      });
      delivered ||= response.ok;
    } catch (error) {
      console.error("Admin alert email delivery failed.", { message: error instanceof Error ? error.message : "Unknown error." });
    }
  }
  if (delivered) await env.CACHE.put(cacheKey, "sent", { expirationTtl: 48 * 60 * 60 });
}

export async function runOperationalAlerts(env: WorkerEnv): Promise<void> {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const dayStart = `${today}T00:00:00.000Z`;
  const sinceHour = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
  try {
    const [todaySignups, baseline, dailyAi, heavySpenders] = await Promise.all([
      env.DB.prepare("SELECT COUNT(*) AS count FROM accounts WHERE created_at >= ? AND merged_into IS NULL")
        .bind(dayStart).first<{ count: number }>(),
      env.DB.prepare(
        `SELECT AVG(daily_count) AS average FROM (
           SELECT date(created_at) AS day, COUNT(*) AS daily_count FROM accounts
           WHERE created_at >= ? AND created_at < ? AND merged_into IS NULL GROUP BY date(created_at)
         )`,
      ).bind(new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString(), dayStart)
        .first<{ average: number | null }>(),
      env.DB.prepare(
        `SELECT SUM(COALESCE(json_extract(metadata_json, '$.inputTokens'), 0)) AS input_tokens,
                SUM(COALESCE(json_extract(metadata_json, '$.outputTokens'), 0)) AS output_tokens,
                COUNT(*) AS calls FROM usage_events WHERE event_type = 'ai_generate' AND created_at >= ?`,
      ).bind(dayStart).first<{ input_tokens: number | null; output_tokens: number | null; calls: number }>(),
      env.DB.prepare(
        `SELECT account_id, SUM(-delta) AS spent FROM ledger
         WHERE delta < 0 AND created_at >= ? GROUP BY account_id HAVING SUM(-delta) >= 500`,
      ).bind(sinceHour).all<{ account_id: string; spent: number }>(),
    ]);
    const signupCount = todaySignups?.count ?? 0;
    const average = baseline?.average ?? 0;
    if (signupCount >= Math.max(10, Math.floor(average * 10) + 1)) {
      await deliverAlert(env, `signup:${today}`, "ProtoFlow signup anomaly", `UTC-day signups: ${signupCount}; 30-day daily average: ${average.toFixed(1)}.`);
    }
    const aiInputRate = costRate(env.GEMINI_INPUT_USD_PER_MILLION, 0.1);
    const aiOutputRate = costRate(env.GEMINI_OUTPUT_USD_PER_MILLION, 0.4);
    const aiCost = (dailyAi?.input_tokens ?? 0) / 1_000_000 * aiInputRate +
      (dailyAi?.output_tokens ?? 0) / 1_000_000 * aiOutputRate;
    const threshold = costRate(env.ADMIN_AI_COST_THRESHOLD_USD, Number.POSITIVE_INFINITY);
    if (aiCost > threshold) {
      await deliverAlert(env, `ai-cost:${today}`, "ProtoFlow AI cost threshold exceeded", `Estimated AI cost today is $${aiCost.toFixed(4)} across ${dailyAi?.calls ?? 0} recorded requests.`);
    }
    for (const spender of heavySpenders.results) {
      const hourKey = sinceHour.slice(0, 13);
      await deliverAlert(env, `credit-drain:${spender.account_id}:${hourKey}`, "ProtoFlow high credit drain", `Account ${spender.account_id} spent ${spender.spent} credits within one hour.`);
    }
  } catch (error) {
    console.error("Operational anomaly checks failed.", {
      message: error instanceof Error ? error.message : "Unknown database error.",
    });
  }
}

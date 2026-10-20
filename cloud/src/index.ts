import { Hono } from "hono";
import { registerAccountAuthRoutes } from "./accountAuth";
import {
  activeAbuseFlag,
  enforceAbuseFlag,
  enforceRateLimit,
  hashWithSecret,
  recordAbuseFlag,
  verifyTurnstileToken,
} from "./abuse";
import { requireJwt, signJwt } from "./auth";
import type { AuthClaims, WorkerEnv } from "./env";
import { errorResponse } from "./errors";

type AppEnvironment = { Bindings: WorkerEnv; Variables: { auth: AuthClaims } };

export const app = new Hono<AppEnvironment>();

app.use("*", async (context, next) => {
  const now = Math.floor(Date.now() / 1000);
  const resetAt = Math.floor(now / 3600) * 3600 + 3600;
  context.header("X-RateLimit-Limit", "1000");
  context.header("X-RateLimit-Remaining", "1000");
  context.header("X-RateLimit-Reset", String(resetAt));

  const origin = context.req.header("Origin");
  const allowedOrigins = (context.env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  if (origin && !allowedOrigins.includes(origin)) {
    return errorResponse(
      context,
      403,
      "ORIGIN_NOT_ALLOWED",
      "This origin is not allowed to access the API.",
    );
  }

  if (origin) {
    context.header("Access-Control-Allow-Origin", origin);
    context.header("Vary", "Origin");
    context.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    context.header(
      "Access-Control-Allow-Headers",
      "Authorization, Content-Type, X-Turnstile-Token",
    );
    context.header(
      "Access-Control-Expose-Headers",
      "X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset, Retry-After",
    );
    context.header("Access-Control-Max-Age", "86400");
  }

  if (context.req.method === "OPTIONS") return context.body(null, 204);
  const clientIp = context.req.header("CF-Connecting-IP");
  if (clientIp && context.env.JWT_SECRET) {
    const ipHash = await hashWithSecret(`protoflow-wallet-ip:${clientIp}`, context.env.JWT_SECRET);
    const blocked = await enforceRateLimit(context, `ip:global:${ipHash}`, 1000, 60 * 60, "ip");
    if (blocked) return blocked;
  }
  await next();
});

app.onError((error, context) => {
  console.error("Unhandled Worker request error.", {
    message: error.message,
    path: context.req.path,
    method: context.req.method,
  });
  return errorResponse(context, 500, "INTERNAL_ERROR", "An unexpected server error occurred.");
});

app.notFound((context) =>
  errorResponse(context, 404, "NOT_FOUND", "The requested route does not exist."),
);

app.get("/health", (context) => context.json({ status: "ok" }));

interface AnonymousRequest {
  deviceId: string;
  installId: string;
}

interface AccountRow {
  id: string;
  device_fingerprint: string;
  install_id: string | null;
  merged_into: string | null;
}

interface WalletRow {
  balance: number;
  lifetime_granted: number;
  lifetime_spent: number;
}

interface LedgerRow {
  id: string;
  delta: number;
  reason: string;
  metadata_json: string;
  created_at: string;
}

interface WalletMeRow extends WalletRow {
  claimable: number;
  last_granted_at: string | null;
}

class IdentityConflictError extends Error {}

const STARTER_CREDITS = 50;
const DAILY_CREDITS = 20;
const MAX_WALLET_BALANCE = 100;
const MAX_CATCH_UP_CREDITS = 60;
const IP_ABUSE_IDENTITY_THRESHOLD = 5;
const DAILY_WINDOW_DAYS = 1;
const TOKEN_LIFETIME_SECONDS = 24 * 60 * 60;
const MAX_ACTION_BODY_BYTES = 64 * 1024;
const DEVICE_ID_PATTERN = /^[a-f\d]{64}$/i;
const INSTALL_ID_PATTERN =
  /^[a-f\d]{8}-[a-f\d]{4}-4[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i;
const METERED_ACTION_COSTS = {
  ai_interaction_generator: 1,
  cloud_preview_publish: 2,
  react_tailwind_code_export: 3,
} as const;

type MeteredActionType = keyof typeof METERED_ACTION_COSTS;

interface MeteredActionRequest {
  type: MeteredActionType;
  payload: Record<string, unknown>;
}

function isMeteredActionRequest(value: unknown): value is MeteredActionRequest {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const request = value as Partial<MeteredActionRequest>;
  const keys = Object.keys(value);
  return (
    keys.length === 2 &&
    keys.includes("type") &&
    keys.includes("payload") &&
    typeof request.type === "string" &&
    Object.hasOwn(METERED_ACTION_COSTS, request.type) &&
    typeof request.payload === "object" &&
    request.payload !== null &&
    !Array.isArray(request.payload)
  );
}

function isAnonymousRequest(value: unknown): value is AnonymousRequest {
  if (typeof value !== "object" || value === null) return false;
  const request = value as Partial<AnonymousRequest>;
  return (
    typeof request.deviceId === "string" &&
    DEVICE_ID_PATTERN.test(request.deviceId) &&
    typeof request.installId === "string" &&
    INSTALL_ID_PATTERN.test(request.installId)
  );
}

async function provisionAnonymousWallet(
  database: D1Database,
  deviceId: string,
  installId: string,
): Promise<{ account: AccountRow; wallet: WalletRow }> {
  const normalizedDeviceId = deviceId.toLowerCase();
  const normalizedInstallId = installId.toLowerCase();
  await database
    .prepare(
      `INSERT OR IGNORE INTO accounts (id, device_fingerprint, install_id)
       VALUES (?, ?, ?)`,
    )
    .bind(crypto.randomUUID(), normalizedDeviceId, normalizedInstallId)
    .run();

  const matchingAccounts = await database
    .prepare(
      `SELECT id, device_fingerprint, install_id, merged_into
       FROM accounts
       WHERE device_fingerprint = ? OR install_id = ?
       LIMIT 2`,
    )
    .bind(normalizedDeviceId, normalizedInstallId)
    .all<AccountRow>();

  if (!matchingAccounts.success || matchingAccounts.results.length === 0) {
    throw new Error("The anonymous account could not be read after provisioning.");
  }
  if (matchingAccounts.results.length > 1) throw new IdentityConflictError();

  let account = matchingAccounts.results[0];
  for (let depth = 0; account.merged_into && depth < 8; depth += 1) {
    const resolved = await database
      .prepare("SELECT id, device_fingerprint, install_id, merged_into FROM accounts WHERE id = ?")
      .bind(account.merged_into)
      .first<AccountRow>();
    if (!resolved) throw new Error("The merged wallet account could not be resolved.");
    account = resolved;
  }
  if (account.merged_into) throw new Error("The wallet account merge chain is invalid.");
  if (
    account.install_id === normalizedInstallId &&
    account.device_fingerprint !== normalizedDeviceId
  ) {
    await database
      .prepare("UPDATE accounts SET device_fingerprint = ? WHERE id = ?")
      .bind(normalizedDeviceId, account.id)
      .run();
    account.device_fingerprint = normalizedDeviceId;
  } else if (account.install_id === null) {
    await database
      .prepare("UPDATE accounts SET install_id = ? WHERE id = ? AND install_id IS NULL")
      .bind(normalizedInstallId, account.id)
      .run();
    account.install_id = normalizedInstallId;
  }

  await database
    .prepare("UPDATE accounts SET last_seen_at = ? WHERE id = ?")
    .bind(new Date().toISOString(), account.id)
    .run();

  await database.batch([
    database
      .prepare(
        `INSERT OR IGNORE INTO wallets (account_id, balance, lifetime_granted)
         VALUES (?, ?, ?)`,
      )
      .bind(account.id, STARTER_CREDITS, STARTER_CREDITS),
    database
      .prepare(
        `INSERT INTO ledger (id, account_id, delta, reason)
         SELECT ?, ?, ?, 'starter_grant'
         WHERE changes() = 1`,
      )
      .bind(crypto.randomUUID(), account.id, STARTER_CREDITS),
  ]);

  const wallet = await database
    .prepare(
      `SELECT balance, lifetime_granted, lifetime_spent
       FROM wallets
       WHERE account_id = ?`,
    )
    .bind(account.id)
    .first<WalletRow>();
  if (!wallet) throw new Error("The anonymous wallet could not be loaded.");

  return { account, wallet };
}

app.post("/auth/anonymous", async (context) => {
  const contentLength = Number(context.req.header("Content-Length") ?? 0);
  if (contentLength > 1024) {
    return errorResponse(context, 400, "BAD_REQUEST", "The request body is too large.");
  }

  let body: unknown;
  try {
    body = await context.req.json();
  } catch {
    return errorResponse(context, 400, "BAD_REQUEST", "A valid JSON request body is required.");
  }
  if (!isAnonymousRequest(body)) {
    return errorResponse(
      context,
      400,
      "BAD_REQUEST",
      "A SHA-256 deviceId and UUID installId are required.",
    );
  }

  const secret = context.env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    return errorResponse(
      context,
      503,
      "SERVICE_NOT_CONFIGURED",
      "JWT authentication is not configured.",
    );
  }

  try {
    const deviceHash = await hashWithSecret(`protoflow-device:${body.deviceId.toLowerCase()}`, secret);
    const deviceLimit = await enforceRateLimit(
      context,
      `device:anonymous:${deviceHash}`,
      10,
      60 * 60,
      "device",
    );
    if (deviceLimit) return deviceLimit;

    const clientIp = context.req.header("CF-Connecting-IP");
    const ipHash = clientIp
      ? await hashWithSecret(`protoflow-wallet-ip:${clientIp}`, secret)
      : null;
    if (ipHash) {
      const ipLimit = await enforceRateLimit(context, `ip:anonymous:${ipHash}`, 100, 60 * 60, "ip");
      if (ipLimit) return ipLimit;
      const signups = await context.env.DB
        .prepare(
          "SELECT COUNT(*) AS count FROM abuse_signups WHERE ip_hash = ? AND created_at > ?",
        )
        .bind(ipHash, Math.floor(Date.now() / 1000) - 24 * 60 * 60)
        .first<{ count: number }>();
      if ((signups?.count ?? 0) >= 5) {
        await recordAbuseFlag(context, "ip", ipHash, null, "multiple_accounts_per_ip");
      }
      const ipFlag = await activeAbuseFlag(context, null, ipHash);
      if (ipFlag) {
        const challenge = await enforceAbuseFlag(context, null);
        if (challenge) return challenge;
      }
    }

    const { account, wallet } = await provisionAnonymousWallet(
      context.env.DB,
      body.deviceId,
      body.installId,
    );
    if (ipHash) {
      const now = Math.floor(Date.now() / 1000);
      await context.env.DB
        .prepare("INSERT OR IGNORE INTO abuse_signups (account_id, ip_hash, created_at) VALUES (?, ?, ?)")
        .bind(account.id, ipHash, now)
        .run();
      const signups = await context.env.DB
        .prepare(
          "SELECT COUNT(*) AS count FROM abuse_signups WHERE ip_hash = ? AND created_at > ?",
        )
        .bind(ipHash, now - 24 * 60 * 60)
        .first<{ count: number }>();
      if ((signups?.count ?? 0) >= 5) {
        await recordAbuseFlag(context, "ip", ipHash, account.id, "multiple_accounts_per_ip");
      }
    }
    const now = Math.floor(Date.now() / 1000);
    const expiresAt = now + TOKEN_LIFETIME_SECONDS;
    const token = await signJwt(
      {
        accountId: account.id,
        deviceId: body.deviceId.toLowerCase(),
        iat: now,
        exp: expiresAt,
      },
      secret,
    );
    return context.json({
      accountId: account.id,
      token,
      tokenExpiresAt: new Date(expiresAt * 1000).toISOString(),
      balance: wallet.balance,
      lifetimeGranted: wallet.lifetime_granted,
      lifetimeSpent: wallet.lifetime_spent,
    });
  } catch (error) {
    if (error instanceof IdentityConflictError) {
      return errorResponse(
        context,
        409,
        "IDENTITY_CONFLICT",
        "This device identity conflicts with an existing account. Contact support to recover access.",
      );
    }
    console.error("Anonymous wallet provisioning failed.", {
      message: error instanceof Error ? error.message : "Unknown database error.",
    });
    return errorResponse(
      context,
      503,
      "DATABASE_UNAVAILABLE",
      "The wallet service is temporarily unavailable.",
    );
  }
});

async function loadWallet(
  database: D1Database,
  accountId: string,
  now: string,
): Promise<{ wallet: WalletMeRow; recentLedger: LedgerRow[] }> {
  const wallet = await database
    .prepare(
      `SELECT balance, lifetime_granted, lifetime_spent,
         (SELECT MAX(granted_at) FROM daily_grants WHERE account_id = ?) AS last_granted_at,
         CASE
           WHEN balance < ? AND NOT EXISTS (
             SELECT 1 FROM daily_grants
             WHERE account_id = ? AND julianday(granted_at) > julianday(?) - ?
           ) THEN 1
           ELSE 0
         END AS claimable
       FROM wallets
       WHERE account_id = ?`,
    )
    .bind(accountId, MAX_WALLET_BALANCE, accountId, now, DAILY_WINDOW_DAYS, accountId)
    .first<WalletMeRow>();
  if (!wallet) throw new Error("The requested wallet does not exist.");

  const ledgerResult = await database
    .prepare(
      `SELECT id, delta, reason, metadata_json, created_at
       FROM ledger
       WHERE account_id = ?
       ORDER BY created_at DESC, id DESC
       LIMIT 20`,
    )
    .bind(accountId)
    .all<LedgerRow>();
  if (!ledgerResult.success) throw new Error("Could not read wallet ledger entries.");

  return { wallet, recentLedger: ledgerResult.results };
}

async function hashClientIp(ipAddress: string, secret: string): Promise<string> {
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

function nextClaimAt(lastGrantedAt: string | null): string | null {
  if (!lastGrantedAt) return null;
  return new Date(Date.parse(lastGrantedAt) + 24 * 60 * 60 * 1000).toISOString();
}

app.get("/wallet/me", requireJwt, async (context) => {
  try {
    const now = new Date().toISOString();
    const { wallet, recentLedger } = await loadWallet(
      context.env.DB,
      context.get("auth").accountId,
      now,
    );
    const account = await context.env.DB
      .prepare("SELECT email FROM accounts WHERE id = ? AND merged_into IS NULL")
      .bind(context.get("auth").accountId)
      .first<{ email: string | null }>();
    return context.json({
      accountId: context.get("auth").accountId,
      email: account?.email ?? null,
      balance: wallet.balance,
      lifetimeGranted: wallet.lifetime_granted,
      lifetimeSpent: wallet.lifetime_spent,
      recentLedger,
      claimable: wallet.claimable === 1,
      nextClaimAt: nextClaimAt(wallet.last_granted_at),
      syncedAt: Date.now(),
    });
  } catch (error) {
    if (error instanceof Error && error.message === "The requested wallet does not exist.") {
      return errorResponse(context, 404, "WALLET_NOT_FOUND", error.message);
    }
    console.error("Wallet read failed.", {
      accountId: context.get("auth").accountId,
      message: error instanceof Error ? error.message : "Unknown database error.",
    });
    return errorResponse(
      context,
      503,
      "DATABASE_UNAVAILABLE",
      "The wallet service is temporarily unavailable.",
    );
  }
});

app.post("/wallet/claim-daily", requireJwt, async (context) => {
  const accountId = context.get("auth").accountId;
  const now = new Date().toISOString();
  const grantId = crypto.randomUUID();
  const clientIp = context.req.header("CF-Connecting-IP");
  const ipHash = clientIp
    ? await hashClientIp(clientIp, context.env.JWT_SECRET ?? "")
    : null;

  try {
    let suspiciousIp = false;
    if (ipHash) {
      await context.env.DB.batch([
        context.env.DB
          .prepare("DELETE FROM wallet_ip_activity WHERE julianday(last_seen_at) < julianday(?) - 30")
          .bind(now),
        context.env.DB
          .prepare("DELETE FROM daily_ip_grants WHERE julianday(granted_at) < julianday(?) - 30")
          .bind(now),
        context.env.DB
          .prepare(
            `INSERT INTO wallet_ip_activity (ip_hash, account_id, last_seen_at)
             VALUES (?, ?, ?)
             ON CONFLICT (ip_hash, account_id)
             DO UPDATE SET last_seen_at = excluded.last_seen_at`,
          )
          .bind(ipHash, accountId, now),
      ]);
      const activity = await context.env.DB
        .prepare(
          `SELECT COUNT(*) AS identity_count
           FROM wallet_ip_activity
           WHERE ip_hash = ? AND julianday(last_seen_at) > julianday(?) - ?`,
        )
        .bind(ipHash, now, DAILY_WINDOW_DAYS)
        .first<{ identity_count: number }>();
      suspiciousIp = (activity?.identity_count ?? 0) >= IP_ABUSE_IDENTITY_THRESHOLD;
    }

    if (suspiciousIp && context.env.TURNSTILE_SECRET_KEY) {
      const turnstileToken = context.req.header("X-Turnstile-Token");
      if (!turnstileToken) {
        return context.json(
          {
            error: {
              code: "TURNSTILE_REQUIRED",
              message: "Complete the anti-abuse verification before claiming a daily refill.",
            },
          },
          403,
        );
      }
      try {
        if (!(await verifyTurnstileToken(
          turnstileToken,
          context.env.TURNSTILE_SECRET_KEY,
          clientIp,
        ))) {
          return errorResponse(
            context,
            403,
            "TURNSTILE_INVALID",
            "The anti-abuse verification could not be confirmed.",
          );
        }
      } catch (error) {
        console.error("Turnstile verification failed.", {
          message: error instanceof Error ? error.message : "Unknown verification error.",
        });
        return errorResponse(
          context,
          503,
          "TURNSTILE_UNAVAILABLE",
          "Anti-abuse verification is temporarily unavailable.",
        );
      }
    }

    const results = await context.env.DB.batch([
      context.env.DB
        .prepare(
          `INSERT OR IGNORE INTO daily_grants (account_id, granted_at, amount)
           SELECT ?, ?, MIN(
             ? * CASE
               WHEN latest.last_granted_at IS NULL THEN 1
               ELSE MIN(?, MAX(1, CAST(julianday(?) - julianday(latest.last_granted_at) AS INTEGER)))
             END,
             ? - wallets.balance
           )
           FROM wallets
           LEFT JOIN (
             SELECT MAX(granted_at) AS last_granted_at
             FROM daily_grants
             WHERE account_id = ?
           ) AS latest ON 1 = 1
           WHERE wallets.account_id = ?
             AND wallets.balance < ?
             AND NOT EXISTS (
               SELECT 1 FROM daily_grants
               WHERE account_id = ? AND julianday(granted_at) > julianday(?) - ?
             )
             AND (
               ? IS NULL
               OR (
                 (SELECT COUNT(*) FROM wallet_ip_activity
                  WHERE ip_hash = ? AND julianday(last_seen_at) > julianday(?) - ?) < ?
                 OR (
                   NOT EXISTS (
                     SELECT 1 FROM daily_ip_grants
                     WHERE ip_hash = ? AND julianday(granted_at) > julianday(?) - ?
                   )
                   AND NOT EXISTS (
                     SELECT 1
                     FROM daily_grants AS ip_daily_grants
                     JOIN wallet_ip_activity AS activity
                       ON activity.account_id = ip_daily_grants.account_id
                     WHERE activity.ip_hash = ?
                       AND julianday(activity.last_seen_at) > julianday(?) - ?
                       AND julianday(ip_daily_grants.granted_at) > julianday(?) - ?
                   )
                 )
               )
             )`,
        )
        .bind(
          accountId,
          now,
          DAILY_CREDITS,
          MAX_CATCH_UP_CREDITS / DAILY_CREDITS,
          now,
          MAX_WALLET_BALANCE,
          accountId,
          accountId,
          MAX_WALLET_BALANCE,
          accountId,
          now,
          DAILY_WINDOW_DAYS,
          ipHash,
          ipHash,
          now,
          DAILY_WINDOW_DAYS,
          IP_ABUSE_IDENTITY_THRESHOLD,
          ipHash,
          now,
          DAILY_WINDOW_DAYS,
          ipHash,
          now,
          DAILY_WINDOW_DAYS,
          now,
          DAILY_WINDOW_DAYS,
        ),
      context.env.DB
        .prepare(
          `UPDATE wallets
           SET balance = balance + (
                 SELECT amount FROM daily_grants WHERE account_id = ? AND granted_at = ?
               ),
               lifetime_granted = lifetime_granted + (
                 SELECT amount FROM daily_grants WHERE account_id = ? AND granted_at = ?
               ),
               updated_at = ?
           WHERE account_id = ?
             AND changes() = 1
             AND EXISTS (
               SELECT 1 FROM daily_grants WHERE account_id = ? AND granted_at = ?
             )`,
        )
        .bind(accountId, now, accountId, now, now, accountId, accountId, now),
      context.env.DB
        .prepare(
          `INSERT INTO ledger (id, account_id, delta, reason, metadata_json, created_at)
           SELECT ?, ?, amount, 'daily_grant', '{}', ?
           FROM daily_grants
           WHERE account_id = ? AND granted_at = ? AND changes() = 1`,
        )
        .bind(grantId, accountId, now, accountId, now),
      ...(ipHash
        ? [
            context.env.DB
              .prepare(
                `INSERT INTO daily_ip_grants (ip_hash, account_id, granted_at)
                 SELECT ?, ?, ?
                 WHERE changes() = 1
                   AND (SELECT COUNT(*) FROM wallet_ip_activity
                        WHERE ip_hash = ? AND julianday(last_seen_at) > julianday(?) - ?) >= ?
                 ON CONFLICT (ip_hash) DO UPDATE SET
                   account_id = excluded.account_id,
                   granted_at = excluded.granted_at`,
              )
              .bind(
                ipHash,
                accountId,
                now,
                ipHash,
                now,
                DAILY_WINDOW_DAYS,
                IP_ABUSE_IDENTITY_THRESHOLD,
              ),
          ]
        : []),
    ]);
    if (results.some((result) => !result.success)) {
      throw new Error("The daily grant transaction did not complete.");
    }

    const { wallet, recentLedger } = await loadWallet(context.env.DB, accountId, now);
    const grant = recentLedger.find((entry) => entry.id === grantId);
    const accountNextClaimAt = nextClaimAt(wallet.last_granted_at);
    if (!grant) {
      const hasRecentAccountGrant =
        accountNextClaimAt !== null && Date.parse(accountNextClaimAt) > Date.parse(now);
      const isWalletFull = wallet.balance >= MAX_WALLET_BALANCE;
      let ipNextClaimAt: string | null = null;
      if (ipHash && !hasRecentAccountGrant && !isWalletFull) {
        const ipGrant = await context.env.DB
          .prepare(
            `SELECT MAX(ip_daily_grants.granted_at) AS last_granted_at
             FROM daily_grants AS ip_daily_grants
             JOIN wallet_ip_activity AS activity
               ON activity.account_id = ip_daily_grants.account_id
             WHERE activity.ip_hash = ?
               AND julianday(activity.last_seen_at) > julianday(?) - ?
               AND julianday(ip_daily_grants.granted_at) > julianday(?) - ?`,
          )
          .bind(ipHash, now, DAILY_WINDOW_DAYS, now, DAILY_WINDOW_DAYS)
          .first<{ last_granted_at: string | null }>();
        ipNextClaimAt = nextClaimAt(ipGrant?.last_granted_at ?? null);
      }
      const ipLimited =
        ipNextClaimAt !== null && Date.parse(ipNextClaimAt) > Date.parse(now);
      const code = hasRecentAccountGrant
        ? "DAILY_ALREADY_CLAIMED"
        : isWalletFull
          ? "WALLET_FULL"
          : ipLimited
            ? "DAILY_IP_LIMIT"
            : "DAILY_ALREADY_CLAIMED";
      const message =
        code === "WALLET_FULL"
          ? "Your wallet is at the daily refill balance cap."
          : code === "DAILY_IP_LIMIT"
            ? "A daily refill was already claimed from this network. Try again after the cooldown."
            : "A daily refill was already claimed recently.";
      return context.json(
        {
          error: { code, message },
          nextClaimAt: hasRecentAccountGrant ? accountNextClaimAt : ipNextClaimAt ?? accountNextClaimAt,
          balance: wallet.balance,
        },
        409,
      );
    }
    return context.json({
      accountId,
      claimed: true,
      granted: grant.delta,
      balance: wallet.balance,
      lifetimeGranted: wallet.lifetime_granted,
      lifetimeSpent: wallet.lifetime_spent,
      recentLedger,
      claimable: wallet.claimable === 1,
      nextClaimAt: nextClaimAt(wallet.last_granted_at),
      syncedAt: Date.now(),
    });
  } catch (error) {
    if (error instanceof Error && error.message === "The requested wallet does not exist.") {
      return errorResponse(context, 404, "WALLET_NOT_FOUND", error.message);
    }
    console.error("Daily wallet claim failed.", {
      accountId,
      message: error instanceof Error ? error.message : "Unknown database error.",
    });
    return errorResponse(
      context,
      503,
      "DATABASE_UNAVAILABLE",
      "The wallet service is temporarily unavailable.",
    );
  }
});

app.post("/action/run", requireJwt, async (context) => {
  const contentLength = Number(context.req.header("Content-Length") ?? 0);
  if (contentLength > MAX_ACTION_BODY_BYTES) {
    return errorResponse(context, 400, "INVALID_PAYLOAD", "The action payload is too large.");
  }

  let rawBody: string;
  try {
    rawBody = await context.req.text();
  } catch {
    return errorResponse(context, 400, "INVALID_PAYLOAD", "A valid JSON request body is required.");
  }
  if (new TextEncoder().encode(rawBody).byteLength > MAX_ACTION_BODY_BYTES) {
    return errorResponse(context, 400, "INVALID_PAYLOAD", "The action payload is too large.");
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return errorResponse(context, 400, "INVALID_PAYLOAD", "A valid JSON request body is required.");
  }
  if (!isMeteredActionRequest(body)) {
    return errorResponse(
      context,
      400,
      "INVALID_PAYLOAD",
      "Provide a supported action type and an object payload. Costs are determined by the server.",
    );
  }

  const accountId = context.get("auth").accountId;
  const deviceId = context.get("auth").deviceId;
  const cost = METERED_ACTION_COSTS[body.type];
  try {
    const actionLimit = body.type === "ai_interaction_generator" ? 30 : 10;
    const deviceHash = await hashWithSecret(`protoflow-device:${deviceId}`, context.env.JWT_SECRET!);
    const deviceLimit = await enforceRateLimit(
      context,
      `device:action:${body.type}:${deviceHash}`,
      actionLimit,
      60,
      "device",
    );
    if (deviceLimit) return deviceLimit;

    const clientIp = context.req.header("CF-Connecting-IP");
    if (clientIp) {
      const ipHash = await hashWithSecret(
        `protoflow-wallet-ip:${clientIp}`,
        context.env.JWT_SECRET!,
      );
      const ipLimit = await enforceRateLimit(
        context,
        `ip:action:${body.type}:${ipHash}`,
        500,
        60 * 60,
        "ip",
      );
      if (ipLimit) return ipLimit;
    }

    if (body.type === "ai_interaction_generator" && typeof body.payload.prompt === "string") {
      const promptHash = await hashWithSecret(
        `${accountId}:${JSON.stringify(body.payload.prompt)}`,
        context.env.JWT_SECRET!,
      );
      const repeatedPrompt = await enforceRateLimit(
        context,
        `prompt:${promptHash}`,
        20,
        60,
        accountId,
      );
      if (repeatedPrompt) {
        await recordAbuseFlag(context, "account", accountId, accountId, "repeated_identical_ai_prompt");
        return repeatedPrompt;
      }
    }

    const recentSpend = await context.env.DB
      .prepare(
        `SELECT COALESCE(SUM(-delta), 0) AS spent
         FROM ledger
         WHERE account_id = ? AND delta < 0
           AND julianday(created_at) > julianday(?) - (1.0 / 24)`,
      )
      .bind(accountId, new Date().toISOString())
      .first<{ spent: number }>();
    if ((recentSpend?.spent ?? 0) >= 100) {
      await recordAbuseFlag(context, "account", accountId, accountId, "rapid_credit_drain");
      const abuseResponse = await enforceAbuseFlag(context, accountId);
      if (abuseResponse) return abuseResponse;
    }

    const wallet = await context.env.DB
      .prepare("SELECT balance FROM wallets WHERE account_id = ?")
      .bind(accountId)
      .first<{ balance: number }>();
    if (!wallet) {
      return errorResponse(context, 404, "WALLET_NOT_FOUND", "The requested wallet does not exist.");
    }
    if (wallet.balance < cost) {
      return context.json(
        {
          error: {
            code: "INSUFFICIENT_BALANCE",
            message: `This action requires ${cost} credit${cost === 1 ? "" : "s"}.`,
          },
          balance: wallet.balance,
          required: cost,
        },
        402,
      );
    }

    return errorResponse(
      context,
      501,
      "ACTION_NOT_IMPLEMENTED",
      "This cloud action is not available yet. No credits were deducted.",
    );
  } catch (error) {
    console.error("Metered action dispatch failed.", {
      accountId,
      actionType: body.type,
      message: error instanceof Error ? error.message : "Unknown database error.",
    });
    return errorResponse(
      context,
      503,
      "DATABASE_UNAVAILABLE",
      "The wallet service is temporarily unavailable.",
    );
  }
});

registerAccountAuthRoutes(app);

app.all("/admin/*", requireJwt, (context) =>
  errorResponse(
    context,
    501,
    "ADMIN_NOT_IMPLEMENTED",
    "Administrative operations are scheduled for Task PF-T310.",
  ),
);

async function sendAbuseDigest(env: WorkerEnv): Promise<void> {
  if (!env.ABUSE_DIGEST_EMAIL || !env.RESEND_API_KEY || !env.AUTH_EMAIL_FROM) return;
  try {
    const since = Math.floor(Date.now() / 1000) - 7 * 24 * 60 * 60;
    const result = await env.DB
      .prepare(
        `SELECT scope, reason, mode, COUNT(*) AS count
         FROM abuse_flags
         WHERE flagged_at >= ?
         GROUP BY scope, reason, mode
         ORDER BY count DESC, reason`,
      )
      .bind(since)
      .all<{ scope: string; reason: string; mode: string; count: number }>();
    if (!result.success) throw new Error("Could not read the weekly abuse summary.");
    const summary = result.results.length
      ? result.results.map(({ scope, reason, mode, count }) =>
          `${count} ${scope} flag(s): ${reason} (${mode})`,
        ).join("\n")
      : "No abuse flags were recorded during this period.";
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: env.AUTH_EMAIL_FROM,
        to: [env.ABUSE_DIGEST_EMAIL],
        subject: "ProtoFlow weekly abuse-prevention digest",
        text: `Abuse-prevention summary for the last 7 days:\n\n${summary}`,
      }),
    });
    if (!response.ok) {
      throw new Error(`The abuse digest email service returned ${response.status}.`);
    }
    console.info("Weekly abuse digest sent.", { recipientConfigured: true, groups: result.results.length });
  } catch (error) {
    console.error("Weekly abuse digest delivery failed.", {
      message: error instanceof Error ? error.message : "Unknown digest error.",
    });
  }
}

async function runScheduledTasks(env: WorkerEnv): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  try {
    const results = await env.DB.batch([
      env.DB
        .prepare("DELETE FROM abuse_signups WHERE created_at < ?")
        .bind(now - 30 * 24 * 60 * 60),
      env.DB
        .prepare("DELETE FROM abuse_flags WHERE flagged_at < ?")
        .bind(now - 90 * 24 * 60 * 60),
    ]);
    if (results.some((result) => !result.success)) {
      throw new Error("Abuse-record retention cleanup did not complete.");
    }
  } catch (error) {
    console.error("Abuse-record retention cleanup failed.", {
      message: error instanceof Error ? error.message : "Unknown cleanup error.",
    });
  }
  await sendAbuseDigest(env);
}

export default {
  fetch: (request: Request, env: WorkerEnv, executionContext: ExecutionContext) =>
    app.fetch(request, env, executionContext),
  scheduled: (_event: ScheduledController, env: WorkerEnv, executionContext: ExecutionContext) => {
    executionContext.waitUntil(runScheduledTasks(env));
  },
};

import type { Context } from "hono";
import type { AuthClaims, WorkerEnv } from "./env";
import { errorResponse } from "./errors";

type AppEnvironment = { Bindings: WorkerEnv; Variables: { auth: AuthClaims } };
type AppContext = Context<AppEnvironment>;

export interface RateLimitResult {
  limit: number;
  remaining: number;
  resetAt: number;
  allowed: boolean;
}

export interface AbuseFlag {
  id: string;
  scope: "account" | "ip";
  scope_key: string;
  mode: "challenge" | "read_only";
  reason: string;
}

export async function hashWithSecret(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function consumeRateLimit(
  context: AppContext,
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  const now = Math.floor(Date.now() / 1000);
  const windowStart = Math.floor(now / windowSeconds) * windowSeconds;
  const resetAt = windowStart + windowSeconds;
  const windowKey = `rl:${key}:${windowStart}`;
  const elapsed = now - windowStart;
  const [existing, previousValue] = await Promise.all([
    context.env.CACHE.get(windowKey),
    context.env.CACHE.get(`rl:${key}:${windowStart - windowSeconds}`),
  ]);
  const current = existing === null ? 0 : Number(existing);
  const previous = previousValue === null ? 0 : Number(previousValue);
  if (
    !Number.isSafeInteger(current) ||
    current < 0 ||
    !Number.isSafeInteger(previous) ||
    previous < 0
  ) {
    throw new Error("The rate-limit counter in KV is invalid.");
  }
  const weightedCount = current + previous * ((windowSeconds - elapsed) / windowSeconds);
  const allowed = weightedCount < limit;
  const count = allowed ? current + 1 : current;
  if (allowed) {
    await context.env.CACHE.put(windowKey, String(count), {
      expirationTtl: windowSeconds * 2 + 60,
    });
  }
  const countAfterRequest = weightedCount + (allowed ? 1 : 0);
  const result = {
    limit,
    remaining: Math.max(0, Math.floor(limit - countAfterRequest)),
    resetAt,
    allowed,
  };
  context.header("X-RateLimit-Limit", String(limit));
  context.header("X-RateLimit-Remaining", String(result.remaining));
  context.header("X-RateLimit-Reset", String(resetAt));
  return result;
}

export async function enforceRateLimit(
  context: AppContext,
  key: string,
  limit: number,
  windowSeconds: number,
  subject: string,
): Promise<Response | null> {
  try {
    const result = await consumeRateLimit(context, key, limit, windowSeconds);
    return result.allowed ? null : rateLimitedResponse(context, result, subject);
  } catch (error) {
    console.error("Rate-limit service failed.", {
      path: context.req.path,
      subject,
      message: error instanceof Error ? error.message : "Unknown KV error.",
    });
    return errorResponse(
      context,
      503,
      "RATE_LIMIT_UNAVAILABLE",
      "Abuse protection is temporarily unavailable. Please try again shortly.",
    );
  }
}

export function rateLimitedResponse(context: AppContext, result: RateLimitResult, subject: string) {
  console.warn("Rate limit exceeded.", {
    path: context.req.path,
    method: context.req.method,
    subject,
    limit: result.limit,
    resetAt: result.resetAt,
  });
  context.header("Retry-After", String(Math.max(1, result.resetAt - Math.floor(Date.now() / 1000))));
  return errorResponse(context, 429, "RATE_LIMITED", "Too many requests. Please wait and try again.");
}

export async function activeAbuseFlag(
  context: AppContext,
  accountId: string | null,
  ipHash: string | null,
): Promise<AbuseFlag | null> {
  const now = Math.floor(Date.now() / 1000);
  const flag = await context.env.DB
    .prepare(
      `SELECT id, scope, scope_key, mode, reason
       FROM abuse_flags
       WHERE cleared_at IS NULL AND expires_at > ?
         AND ((scope = 'account' AND scope_key = ?)
           OR (scope = 'ip' AND scope_key = ?))
       ORDER BY CASE mode WHEN 'read_only' THEN 0 ELSE 1 END, flagged_at DESC
       LIMIT 1`,
    )
    .bind(now, accountId ?? "", ipHash ?? "")
    .first<AbuseFlag>();
  return flag ?? null;
}

export async function recordAbuseFlag(
  context: AppContext,
  scope: "account" | "ip",
  scopeKey: string,
  accountId: string | null,
  reason: string,
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const active = await context.env.DB
    .prepare(
      `SELECT id, mode FROM abuse_flags
       WHERE scope = ? AND scope_key = ? AND reason = ?
         AND cleared_at IS NULL AND expires_at > ? LIMIT 1`,
    )
    .bind(scope, scopeKey, reason, now)
    .first<{ id: string; mode: AbuseFlag["mode"] }>();
  if (active) {
    if (scope === "account" && active.mode === "challenge") {
      const recentFlags = await context.env.DB
        .prepare(
          `SELECT COUNT(*) AS count FROM abuse_flags
           WHERE scope = 'account' AND scope_key = ? AND flagged_at > ?`,
        )
        .bind(scopeKey, now - 30 * 24 * 60 * 60)
        .first<{ count: number }>();
      if ((recentFlags?.count ?? 0) >= 2) {
        await context.env.DB
          .prepare("UPDATE abuse_flags SET mode = 'read_only', expires_at = ? WHERE id = ?")
          .bind(now + 24 * 60 * 60, active.id)
          .run();
        console.warn("Abuse flag escalated to read-only.", { accountId, reason });
      }
    }
    return;
  }

  let mode: AbuseFlag["mode"] = "challenge";
  if (scope === "account") {
    const previous = await context.env.DB
      .prepare(
        `SELECT COUNT(*) AS count FROM abuse_flags
         WHERE scope = 'account' AND scope_key = ? AND flagged_at > ?`,
      )
      .bind(scopeKey, now - 30 * 24 * 60 * 60)
      .first<{ count: number }>();
    if ((previous?.count ?? 0) >= 2) mode = "read_only";
  }
  await context.env.DB
    .prepare(
      `INSERT INTO abuse_flags
       (id, scope, scope_key, account_id, reason, mode, flagged_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      crypto.randomUUID(),
      scope,
      scopeKey,
      accountId,
      reason,
      mode,
      now,
      now + (mode === "read_only" ? 24 * 60 * 60 : 7 * 24 * 60 * 60),
    )
    .run();
  console.warn("Abuse flag recorded.", { scope, accountId, reason, mode });
}

export async function enforceAbuseFlag(context: AppContext, accountId: string | null) {
  const clientIp = context.req.header("CF-Connecting-IP");
  const ipHash =
    clientIp && context.env.JWT_SECRET
      ? await hashWithSecret(`protoflow-wallet-ip:${clientIp}`, context.env.JWT_SECRET)
      : null;
  const flag = await activeAbuseFlag(context, accountId, ipHash);
  if (!flag) return null;
  if (flag.mode === "read_only" && context.req.method !== "GET" && context.req.path !== "/auth/sign-out") {
    return errorResponse(context, 403, "READ_ONLY", "This account is temporarily read-only while abuse safeguards are active.");
  }
  if (flag.mode === "read_only") return null;

  const verificationKey = `turnstile-ok:${accountId ?? "anonymous"}:${ipHash ?? "unknown"}`;
  if (await context.env.CACHE.get(verificationKey)) return null;

  const token = context.req.header("X-Turnstile-Token");
  if (token && context.env.TURNSTILE_SECRET_KEY) {
    const clientIp = context.req.header("CF-Connecting-IP");
    let verified: boolean;
    try {
      verified = await verifyTurnstileToken(token, context.env.TURNSTILE_SECRET_KEY, clientIp);
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
    if (!verified) {
      return errorResponse(context, 403, "TURNSTILE_INVALID", "The anti-abuse verification could not be confirmed.");
    }
    await context.env.CACHE.put(verificationKey, "verified", { expirationTtl: 60 * 60 });
    return null;
  }
  if (!context.env.TURNSTILE_SECRET_KEY) {
    return errorResponse(context, 403, "ABUSE_REVIEW_REQUIRED", "This request requires manual abuse review.");
  }
  return errorResponse(context, 403, "TURNSTILE_REQUIRED", "Complete the anti-abuse verification to continue.");
}

export async function verifyTurnstileToken(
  token: string,
  secret: string,
  clientIp?: string,
): Promise<boolean> {
  const body = new URLSearchParams({ secret, response: token });
  if (clientIp) body.set("remoteip", clientIp);
  const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!response.ok) throw new Error("Turnstile verification is unavailable.");
  const result: unknown = await response.json();
  return (
    typeof result === "object" &&
    result !== null &&
    !Array.isArray(result) &&
    "success" in result &&
    result.success === true
  );
}

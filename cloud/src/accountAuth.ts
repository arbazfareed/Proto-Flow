import type { Hono } from "hono";
import type { Context } from "hono";
import { enforceRateLimit, hashWithSecret } from "./abuse";
import { requireJwt, signJwt } from "./auth";
import type { AuthClaims, WorkerEnv } from "./env";
import { errorResponse } from "./errors";

interface AccountRow {
  id: string;
  email: string | null;
  google_sub: string | null;
  merged_into: string | null;
  deleted_at?: string | null;
}

async function hmacHex(value: string, secret: string): Promise<string> {
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

interface MagicLinkData {
  accountId: string;
  email: string;
  expiresAt: number;
}

interface OAuthState {
  accountId: string;
  deviceId: string;
  codeVerifier: string;
  redirectUri: string;
  expiresAt: number;
}

interface OAuthTicket {
  accountId: string;
  deviceId: string;
  googleSub: string;
  email: string;
  expiresAt: number;
}

type AccountAuthEnvironment = { Bindings: WorkerEnv; Variables: { auth: AuthClaims } };
type AccountAuthApp = Hono<AccountAuthEnvironment>;
type AccountAuthContext = Context<AccountAuthEnvironment>;

const MAGIC_LINK_TTL_SECONDS = 15 * 60;
const OAUTH_STATE_TTL_SECONDS = 10 * 60;
const EMAIL_LIMIT = 3;
const EMAIL_WINDOW_SECONDS = 60 * 60;
const MAX_JSON_BODY_BYTES = 4096;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const EMAIL_TOKEN_PATTERN = /^[A-Za-z\d_-]{40,64}$/;
const STATE_PATTERN = /^[A-Za-z\d_-]{40,64}$/;
const TICKET_PATTERN = /^[A-Za-z\d_-]{40,64}$/;
const CALLBACK_SCHEME = "protoflow:";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readJson(context: AccountAuthContext): Promise<unknown | null> {
  const contentLength = Number(context.req.header("Content-Length") ?? 0);
  if (contentLength > MAX_JSON_BODY_BYTES) return null;
  try {
    const text = await context.req.text();
    if (new TextEncoder().encode(text).byteLength > MAX_JSON_BODY_BYTES) return null;
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function randomToken(byteLength = 32): string {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function createJwt(
  env: WorkerEnv,
  accountId: string,
  deviceId: string,
): Promise<{ token: string; tokenExpiresAt: string }> {
  const secret = env.JWT_SECRET;
  if (!secret || secret.length < 32) throw new Error("JWT authentication is not configured.");
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + 24 * 60 * 60;
  return {
    token: await signJwt({ accountId, deviceId, iat: now, exp: expiresAt }, secret),
    tokenExpiresAt: new Date(expiresAt * 1000).toISOString(),
  };
}

function validCallbackUri(value: unknown, env: WorkerEnv, endpoint: "verify" | "google-callback"): value is string {
  if (typeof value !== "string" || value.length > 2048) return false;
  if (value.startsWith(`${CALLBACK_SCHEME}//auth/${endpoint}`)) {
    try {
      const url = new URL(value);
      return url.protocol === CALLBACK_SCHEME && url.hostname === "auth" &&
        url.pathname === `/${endpoint}` && !url.username && !url.password;
    } catch {
      return false;
    }
  }
  try {
    const url = new URL(value);
    const origins = (env.ALLOWED_ORIGINS ?? "").split(",").map((origin) => origin.trim());
    return (
      (url.protocol === "https:" || url.protocol === "http:") &&
      origins.includes(url.origin) &&
      !url.username &&
      !url.password &&
      url.search === "" &&
      url.hash === ""
    );
  } catch {
    return false;
  }
}

function addQuery(uri: string, key: string, value: string): string {
  const url = new URL(uri);
  url.searchParams.set(key, value);
  return url.toString();
}

async function isActiveAccount(database: D1Database, accountId: string): Promise<boolean> {
  const row = await database
    .prepare("SELECT id FROM accounts WHERE id = ? AND merged_into IS NULL AND deleted_at IS NULL")
    .bind(accountId)
    .first<{ id: string }>();
  return Boolean(row);
}

async function resolveAccount(database: D1Database, accountId: string): Promise<AccountRow | null> {
  let currentId = accountId;
  for (let depth = 0; depth < 8; depth += 1) {
    const account = await database
      .prepare("SELECT id, email, google_sub, merged_into, deleted_at FROM accounts WHERE id = ?")
      .bind(currentId)
      .first<AccountRow>();
    if (!account || account.deleted_at) return null;
    if (!account.merged_into) return account;
    currentId = account.merged_into;
  }
  throw new Error("The wallet account merge chain is invalid.");
}

async function consumeMagicLink(
  database: D1Database,
  tokenHash: string,
  now: number,
): Promise<{ account_id: string; email: string } | null> {
  return database
    .prepare(
      `UPDATE auth_magic_links
       SET consumed_at = ?
       WHERE token_hash = ? AND consumed_at IS NULL AND expires_at > ?
       RETURNING account_id, email`,
    )
    .bind(now, tokenHash, now)
    .first<{ account_id: string; email: string }>();
}

async function mergeWallets(database: D1Database, targetId: string, sourceId: string): Promise<void> {
  if (targetId === sourceId) return;
  const source = await database
    .prepare("SELECT id, merged_into, deleted_at FROM accounts WHERE id = ?")
    .bind(sourceId)
    .first<{ id: string; merged_into: string | null; deleted_at: string | null }>();
  const target = await database
    .prepare("SELECT id, merged_into, deleted_at FROM accounts WHERE id = ?")
    .bind(targetId)
    .first<{ id: string; merged_into: string | null; deleted_at: string | null }>();
  if (
    !source || source.merged_into || source.deleted_at ||
    !target || target.merged_into || target.deleted_at
  ) {
    throw new Error("One of the wallet accounts is unavailable for merging.");
  }

  const results = await database.batch([
    database
      .prepare(
        `INSERT INTO ledger (id, account_id, delta, reason, metadata_json)
         SELECT ?, ?, -(target.balance + source.balance - 100), 'account_merge_cap', '{}'
         FROM wallets AS target
         JOIN wallets AS source ON source.account_id = ?
         WHERE target.account_id = ? AND target.balance + source.balance > 100`,
      )
      .bind(crypto.randomUUID(), targetId, sourceId, targetId),
    database
      .prepare(
        `UPDATE wallets
         SET balance = MIN(100, balance + (SELECT balance FROM wallets WHERE account_id = ?)),
             lifetime_granted = lifetime_granted + (SELECT lifetime_granted FROM wallets WHERE account_id = ?),
             lifetime_spent = lifetime_spent + (SELECT lifetime_spent FROM wallets WHERE account_id = ?)
               + MAX(0, balance + (SELECT balance FROM wallets WHERE account_id = ?) - 100)
         WHERE account_id = ?`,
      )
      .bind(sourceId, sourceId, sourceId, sourceId, targetId),
    database
      .prepare("UPDATE ledger SET account_id = ? WHERE account_id = ?")
      .bind(targetId, sourceId),
    database
      .prepare(
        `INSERT OR IGNORE INTO daily_grants (account_id, granted_at, amount)
         SELECT ?, granted_at, amount FROM daily_grants WHERE account_id = ?`,
      )
      .bind(targetId, sourceId),
    database.prepare("DELETE FROM daily_grants WHERE account_id = ?").bind(sourceId),
    database
      .prepare(
        `INSERT OR IGNORE INTO wallet_ip_activity (ip_hash, account_id, last_seen_at)
         SELECT ip_hash, ?, last_seen_at FROM wallet_ip_activity WHERE account_id = ?`,
      )
      .bind(targetId, sourceId),
    database.prepare("DELETE FROM wallet_ip_activity WHERE account_id = ?").bind(sourceId),
    database
      .prepare(
        `UPDATE daily_ip_grants SET account_id = ?
         WHERE account_id = ? AND NOT EXISTS (
           SELECT 1 FROM daily_ip_grants AS existing
           WHERE existing.ip_hash = daily_ip_grants.ip_hash AND existing.account_id = ?
         )`,
      )
      .bind(targetId, sourceId, targetId),
    database
      .prepare(
        `UPDATE wallets SET balance = 0, lifetime_granted = 0, lifetime_spent = 0
         WHERE account_id = ?`,
      )
      .bind(sourceId),
    database
      .prepare(
        "UPDATE accounts SET merged_into = ?, email = NULL, google_sub = NULL WHERE id = ?",
      )
      .bind(targetId, sourceId),
  ]);
  if (results.some((result) => !result.success)) {
    throw new Error("The wallet merge transaction did not complete.");
  }
}

async function linkAccount(
  database: D1Database,
  targetId: string,
  email: string,
  googleSub?: string,
): Promise<void> {
  const target = await database
    .prepare("SELECT id, email, google_sub, merged_into, deleted_at FROM accounts WHERE id = ?")
    .bind(targetId)
    .first<AccountRow>();
  if (!target || target.merged_into || target.deleted_at) throw new Error("The active wallet account was not found.");
  if ((target.email && target.email.toLowerCase() !== email.toLowerCase()) ||
      (googleSub && target.google_sub && target.google_sub !== googleSub)) {
    throw new Error("This wallet is already linked to a different sign-in identity.");
  }

  const owners = new Set<string>();
  const emailOwner = await database
    .prepare("SELECT id FROM accounts WHERE email = ? COLLATE NOCASE AND merged_into IS NULL")
    .bind(email)
    .first<{ id: string }>();
  if (emailOwner) owners.add(emailOwner.id);
  if (googleSub) {
    const googleOwner = await database
      .prepare("SELECT id FROM accounts WHERE google_sub = ? AND merged_into IS NULL")
      .bind(googleSub)
      .first<{ id: string }>();
    if (googleOwner) owners.add(googleOwner.id);
  }
  for (const ownerId of owners) await mergeWallets(database, targetId, ownerId);

  await database
    .prepare(
      `UPDATE accounts
       SET email = ?, google_sub = COALESCE(?, google_sub), last_seen_at = ?
       WHERE id = ? AND merged_into IS NULL`,
    )
    .bind(email, googleSub ?? null, new Date().toISOString(), targetId)
    .run();
}

async function walletSummary(database: D1Database, accountId: string) {
  return database
    .prepare("SELECT balance, lifetime_granted, lifetime_spent FROM wallets WHERE account_id = ?")
    .bind(accountId)
    .first<{ balance: number; lifetime_granted: number; lifetime_spent: number }>();
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

export function registerAccountAuthRoutes(app: AccountAuthApp): void {
  app.post("/auth/email/start", requireJwt, async (context) => {
    const auth = context.get("auth");
    const body = await readJson(context);
    if (
      !isRecord(body) ||
      typeof body.email !== "string" ||
      body.email.length > 254 ||
      !EMAIL_PATTERN.test(body.email) ||
      body.accountId !== auth.accountId ||
      !validCallbackUri(body.callbackUri, context.env, "verify")
    ) {
      return errorResponse(context, 400, "BAD_REQUEST", "Provide a valid email, active account, and allowed callback URL.");
    }
    if (!context.env.RESEND_API_KEY || !context.env.AUTH_EMAIL_FROM) {
      return errorResponse(context, 503, "SERVICE_NOT_CONFIGURED", "Email sign-in is not configured.");
    }

    const email = body.email.trim().toLowerCase();
    const now = Math.floor(Date.now() / 1000);
    try {
      if (!(await isActiveAccount(context.env.DB, auth.accountId))) {
        return errorResponse(context, 401, "INVALID_TOKEN", "The wallet session is no longer active.");
      }
      const emailHash = await hmacHex(email, context.env.JWT_SECRET!);
      const emailLimit = await enforceRateLimit(
        context,
        `email:start:${emailHash}`,
        EMAIL_LIMIT,
        EMAIL_WINDOW_SECONDS,
        "email",
      );
      if (emailLimit) return emailLimit;
      const clientIp = context.req.header("CF-Connecting-IP");
      if (clientIp) {
        const ipHash = await hashWithSecret(
          `protoflow-wallet-ip:${clientIp}`,
          context.env.JWT_SECRET!,
        );
        const ipLimit = await enforceRateLimit(
          context,
          `ip:email:${ipHash}`,
          100,
          60 * 60,
          "ip",
        );
        if (ipLimit) return ipLimit;
      }
      const limit = await context.env.DB
        .prepare(
          `INSERT INTO auth_email_rate_limits (email_hash, window_start, count)
           VALUES (?, ?, 1)
           ON CONFLICT (email_hash) DO UPDATE SET
             count = CASE WHEN window_start <= ? THEN 1 ELSE count + 1 END,
             window_start = CASE WHEN window_start <= ? THEN ? ELSE window_start END
           WHERE window_start <= ? OR count < ?
           RETURNING count`,
        )
        .bind(
          emailHash,
          now,
          now - EMAIL_WINDOW_SECONDS,
          now - EMAIL_WINDOW_SECONDS,
          now,
          now - EMAIL_WINDOW_SECONDS,
          EMAIL_LIMIT,
        )
        .first<{ count: number }>();
      if (!limit) {
        return errorResponse(context, 429, "RATE_LIMITED", "Too many sign-in links requested. Try again in an hour.");
      }

      const token = randomToken();
      const tokenHash = await sha256Hex(token);
      const expiresAt = now + MAGIC_LINK_TTL_SECONDS;
      const callback = addQuery(body.callbackUri, "token", token);
      const message = {
        from: context.env.AUTH_EMAIL_FROM,
        to: [email],
        subject: "Your ProtoFlow sign-in link",
        text: `Use this one-time link to sign in to ProtoFlow. It expires in 15 minutes: ${callback}`,
        html: `<p>Use this one-time link to sign in to ProtoFlow. It expires in 15 minutes.</p><p><a href="${escapeHtml(callback)}">Sign in to ProtoFlow</a></p>`,
      };
      await context.env.DB
        .prepare(
          "INSERT INTO auth_magic_links (token_hash, account_id, email, expires_at) VALUES (?, ?, ?, ?)",
        )
        .bind(tokenHash, auth.accountId, email, expiresAt)
        .run();
      await context.env.CACHE.put(
        `magic:${tokenHash}`,
        JSON.stringify({ accountId: auth.accountId, email, expiresAt } satisfies MagicLinkData),
        { expirationTtl: MAGIC_LINK_TTL_SECONDS },
      );
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${context.env.RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(message),
      });
      if (!response.ok) {
        console.error("Sign-in email delivery failed.", { status: response.status });
        return errorResponse(context, 503, "SERVICE_NOT_CONFIGURED", "Could not send the sign-in email. Try again later.");
      }
      return context.json({ sent: true, expiresIn: MAGIC_LINK_TTL_SECONDS });
    } catch (error) {
      console.error("Sign-in email request failed.", {
        accountId: auth.accountId,
        message: error instanceof Error ? error.message : "Unknown authentication error.",
      });
      return errorResponse(context, 503, "DATABASE_UNAVAILABLE", "Sign-in is temporarily unavailable.");
    }
  });

  app.post("/auth/email/verify", requireJwt, async (context) => {
    const auth = context.get("auth");
    const body = await readJson(context);
    if (!isRecord(body) || typeof body.token !== "string" || !EMAIL_TOKEN_PATTERN.test(body.token)) {
      return errorResponse(context, 400, "BAD_REQUEST", "A valid sign-in token is required.");
    }
    try {
      const tokenHash = await sha256Hex(body.token);
      const cacheKey = `magic:${tokenHash}`;
      const cached = await context.env.CACHE.get<MagicLinkData>(cacheKey, "json");
      if (!cached || cached.expiresAt <= Math.floor(Date.now() / 1000)) {
        return errorResponse(context, 400, "INVALID_TOKEN", "The sign-in link is invalid or expired.");
      }
      const now = Math.floor(Date.now() / 1000);
      const consumed = await consumeMagicLink(context.env.DB, tokenHash, now);
      if (!consumed || consumed.account_id !== cached.accountId || consumed.email !== cached.email) {
        return errorResponse(context, 400, "INVALID_TOKEN", "The sign-in link is invalid or has already been used.");
      }
      await context.env.CACHE.delete(cacheKey);
      if (!(await isActiveAccount(context.env.DB, auth.accountId))) {
        return errorResponse(context, 401, "INVALID_TOKEN", "The wallet session is no longer active.");
      }
      const originatedFrom = await resolveAccount(context.env.DB, consumed.account_id);
      if (!originatedFrom) {
        return errorResponse(context, 400, "INVALID_TOKEN", "The wallet account for this sign-in link no longer exists.");
      }
      if (originatedFrom.id !== auth.accountId) {
        await mergeWallets(context.env.DB, auth.accountId, originatedFrom.id);
      }
      await linkAccount(context.env.DB, auth.accountId, consumed.email);
      const summary = await walletSummary(context.env.DB, auth.accountId);
      if (!summary) throw new Error("The linked wallet could not be loaded.");
      const session = await createJwt(context.env, auth.accountId, auth.deviceId);
      return context.json({
        accountId: auth.accountId,
        email: consumed.email,
        token: session.token,
        tokenExpiresAt: session.tokenExpiresAt,
        ...summary,
      });
    } catch (error) {
      if (error instanceof Error && error.message.includes("already linked")) {
        return errorResponse(context, 409, "IDENTITY_CONFLICT", error.message);
      }
      console.error("Sign-in link verification failed.", {
        accountId: auth.accountId,
        message: error instanceof Error ? error.message : "Unknown authentication error.",
      });
      return errorResponse(context, 503, "DATABASE_UNAVAILABLE", "Sign-in verification is temporarily unavailable.");
    }
  });

  app.post("/auth/google/start", requireJwt, async (context) => {
    const auth = context.get("auth");
    const body = await readJson(context);
    if (!isRecord(body) || !validCallbackUri(body.callbackUri, context.env, "google-callback")) {
      return errorResponse(context, 400, "BAD_REQUEST", "Provide an allowed Google OAuth callback URL.");
    }
    const { GOOGLE_CLIENT_ID: clientId, GOOGLE_REDIRECT_URI: redirectUri } = context.env;
    if (!clientId || !redirectUri) {
      return errorResponse(context, 503, "SERVICE_NOT_CONFIGURED", "Google sign-in is not configured.");
    }
    if (!(await isActiveAccount(context.env.DB, auth.accountId))) {
      return errorResponse(context, 401, "INVALID_TOKEN", "The wallet session is no longer active.");
    }

    const state = randomToken();
    const stateHash = await sha256Hex(state);
    const verifier = randomToken(48);
    const challengeBytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
    const challenge = btoa(String.fromCharCode(...new Uint8Array(challengeBytes)))
      .replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
    const expiresAt = Math.floor(Date.now() / 1000) + OAUTH_STATE_TTL_SECONDS;
    const oauthState: OAuthState = {
      accountId: auth.accountId,
      deviceId: auth.deviceId,
      codeVerifier: verifier,
      redirectUri: body.callbackUri,
      expiresAt,
    };

    try {
      await context.env.DB
        .prepare(
          `INSERT INTO auth_oauth_states
           (state_hash, account_id, device_id, code_verifier, redirect_uri, expires_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .bind(stateHash, auth.accountId, auth.deviceId, verifier, body.callbackUri, expiresAt)
        .run();
      await context.env.CACHE.put(`oauth:${stateHash}`, JSON.stringify(oauthState), {
        expirationTtl: OAUTH_STATE_TTL_SECONDS,
      });
    } catch (error) {
      console.error("Google OAuth start failed.", {
        accountId: auth.accountId,
        message: error instanceof Error ? error.message : "Unknown authentication error.",
      });
      return errorResponse(context, 503, "DATABASE_UNAVAILABLE", "Google sign-in is temporarily unavailable.");
    }

    const authorize = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    authorize.search = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: "openid email",
      state,
      code_challenge: challenge,
      code_challenge_method: "S256",
      prompt: "select_account",
    }).toString();
    return context.json({ authorizationUrl: authorize.toString() });
  });

  app.get("/auth/google/callback", async (context) => {
    const code = context.req.query("code");
    const state = context.req.query("state");
    const providerError = context.req.query("error");
    if (providerError) {
      return context.text("Google sign-in was cancelled. Return to ProtoFlow and try again.", 400);
    }
    if (!code || !state || !STATE_PATTERN.test(state)) {
      return errorResponse(context, 400, "BAD_REQUEST", "The Google OAuth callback is invalid.");
    }
    const { GOOGLE_CLIENT_ID: clientId, GOOGLE_CLIENT_SECRET: clientSecret, GOOGLE_REDIRECT_URI: redirectUri } = context.env;
    if (!clientId || !clientSecret || !redirectUri) {
      return errorResponse(context, 503, "SERVICE_NOT_CONFIGURED", "Google sign-in is not configured.");
    }

    try {
      const stateHash = await sha256Hex(state);
      const oauthState = await context.env.CACHE.get<OAuthState>(`oauth:${stateHash}`, "json");
      const now = Math.floor(Date.now() / 1000);
      const consumed = await context.env.DB
        .prepare(
          `UPDATE auth_oauth_states SET consumed_at = ?
           WHERE state_hash = ? AND consumed_at IS NULL AND expires_at > ?
           RETURNING account_id, device_id, code_verifier, redirect_uri, expires_at`,
        )
        .bind(now, stateHash, now)
        .first<{
          account_id: string;
          device_id: string;
          code_verifier: string;
          redirect_uri: string;
          expires_at: number;
        }>();
      if (!oauthState || !consumed || oauthState.expiresAt <= now) {
        return errorResponse(context, 400, "INVALID_TOKEN", "The Google sign-in request expired or was already used.");
      }
      if (
        oauthState.accountId !== consumed.account_id ||
        oauthState.deviceId !== consumed.device_id ||
        oauthState.codeVerifier !== consumed.code_verifier ||
        oauthState.redirectUri !== consumed.redirect_uri
      ) {
        return errorResponse(context, 400, "INVALID_TOKEN", "The Google sign-in request could not be verified.");
      }
      await context.env.CACHE.delete(`oauth:${stateHash}`);
      const tokensResponse = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: redirectUri,
          grant_type: "authorization_code",
          code_verifier: consumed.code_verifier,
        }),
      });
      if (!tokensResponse.ok) {
        return errorResponse(context, 400, "INVALID_TOKEN", "Google could not verify this sign-in response.");
      }
      const tokens: unknown = await tokensResponse.json();
      if (!isRecord(tokens) || typeof tokens.access_token !== "string") {
        return errorResponse(context, 400, "INVALID_TOKEN", "Google returned an invalid sign-in response.");
      }
      const profileResponse = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });
      if (!profileResponse.ok) {
        return errorResponse(context, 400, "INVALID_TOKEN", "Google could not verify the account profile.");
      }
      const profile: unknown = await profileResponse.json();
      if (
        !isRecord(profile) ||
        typeof profile.sub !== "string" ||
        typeof profile.email !== "string" ||
        profile.email_verified !== true
      ) {
        return errorResponse(context, 400, "INVALID_TOKEN", "Google did not return a verified email address.");
      }
      const ticket = randomToken();
      const ticketHash = await sha256Hex(ticket);
      const oauthTicket: OAuthTicket = {
        accountId: consumed.account_id,
        deviceId: consumed.device_id,
        googleSub: profile.sub,
        email: profile.email.toLowerCase(),
        expiresAt: now + OAUTH_STATE_TTL_SECONDS,
      };
      await context.env.DB
        .prepare(
          `INSERT INTO auth_oauth_tickets
           (ticket_hash, account_id, device_id, google_sub, email, expires_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          ticketHash,
          oauthTicket.accountId,
          oauthTicket.deviceId,
          oauthTicket.googleSub,
          oauthTicket.email,
          oauthTicket.expiresAt,
        )
        .run();
      await context.env.CACHE.put(`google-ticket:${ticketHash}`, JSON.stringify(oauthTicket), {
        expirationTtl: OAUTH_STATE_TTL_SECONDS,
      });
      const callbackUri = addQuery(consumed.redirect_uri, "ticket", ticket);
      return new Response(null, { status: 302, headers: { Location: callbackUri } });
    } catch (error) {
      console.error("Google OAuth callback failed.", {
        message: error instanceof Error ? error.message : "Unknown provider error.",
      });
      return errorResponse(context, 503, "DATABASE_UNAVAILABLE", "Google sign-in is temporarily unavailable.");
    }
  });

  app.post("/auth/google/verify", requireJwt, async (context) => {
    const auth = context.get("auth");
    const body = await readJson(context);
    if (!isRecord(body) || typeof body.ticket !== "string" || !TICKET_PATTERN.test(body.ticket)) {
      return errorResponse(context, 400, "BAD_REQUEST", "A valid Google sign-in ticket is required.");
    }
    try {
      const ticketHash = await sha256Hex(body.ticket);
      const key = `google-ticket:${ticketHash}`;
      const ticket = await context.env.CACHE.get<OAuthTicket>(key, "json");
      const now = Math.floor(Date.now() / 1000);
      const consumed = await context.env.DB
        .prepare(
          `UPDATE auth_oauth_tickets SET consumed_at = ?
           WHERE ticket_hash = ? AND consumed_at IS NULL AND expires_at > ?
           RETURNING account_id, device_id, google_sub, email, expires_at`,
        )
        .bind(now, ticketHash, now)
        .first<{
          account_id: string;
          device_id: string;
          google_sub: string;
          email: string;
          expires_at: number;
        }>();
      await context.env.CACHE.delete(key);
      if (
        !ticket ||
        !consumed ||
        ticket.expiresAt <= now ||
        ticket.accountId !== auth.accountId ||
        ticket.deviceId !== auth.deviceId ||
        ticket.accountId !== consumed.account_id ||
        ticket.deviceId !== consumed.device_id ||
        ticket.googleSub !== consumed.google_sub ||
        ticket.email !== consumed.email
      ) {
        return errorResponse(context, 400, "INVALID_TOKEN", "The Google sign-in ticket is invalid or expired.");
      }
      await linkAccount(context.env.DB, auth.accountId, ticket.email, ticket.googleSub);
      const summary = await walletSummary(context.env.DB, auth.accountId);
      if (!summary) throw new Error("The linked wallet could not be loaded.");
      const session = await createJwt(context.env, auth.accountId, auth.deviceId);
      return context.json({
        accountId: auth.accountId,
        email: ticket.email,
        token: session.token,
        tokenExpiresAt: session.tokenExpiresAt,
        ...summary,
      });
    } catch (error) {
      if (error instanceof Error && error.message.includes("already linked")) {
        return errorResponse(context, 409, "IDENTITY_CONFLICT", error.message);
      }
      console.error("Google sign-in verification failed.", {
        accountId: auth.accountId,
        message: error instanceof Error ? error.message : "Unknown authentication error.",
      });
      return errorResponse(context, 503, "DATABASE_UNAVAILABLE", "Google sign-in verification is temporarily unavailable.");
    }
  });

  app.post("/auth/sign-out", requireJwt, async (context) => {
    const auth = context.get("auth");
    try {
      await context.env.DB
        .prepare("UPDATE accounts SET email = NULL, google_sub = NULL WHERE id = ? AND merged_into IS NULL")
        .bind(auth.accountId)
        .run();
      return context.json({ signedOut: true, accountId: auth.accountId });
    } catch (error) {
      console.error("Account sign-out failed.", {
        accountId: auth.accountId,
        message: error instanceof Error ? error.message : "Unknown authentication error.",
      });
      return errorResponse(context, 503, "DATABASE_UNAVAILABLE", "Sign-out is temporarily unavailable.");
    }
  });
}

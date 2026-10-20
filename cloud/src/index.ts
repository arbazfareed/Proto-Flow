import { Hono } from "hono";
import { requireJwt, signJwt } from "./auth";
import type { WorkerEnv } from "./env";
import { errorResponse } from "./errors";

type AppEnvironment = { Bindings: WorkerEnv };

export const app = new Hono<AppEnvironment>();

app.use("*", async (context, next) => {
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
    context.header("Access-Control-Allow-Headers", "Authorization, Content-Type");
    context.header("Access-Control-Max-Age", "86400");
  }

  if (context.req.method === "OPTIONS") return context.body(null, 204);
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
}

interface WalletRow {
  balance: number;
  lifetime_granted: number;
  lifetime_spent: number;
}

class IdentityConflictError extends Error {}

const STARTER_CREDITS = 50;
const TOKEN_LIFETIME_SECONDS = 24 * 60 * 60;
const DEVICE_ID_PATTERN = /^[a-f\d]{64}$/i;
const INSTALL_ID_PATTERN =
  /^[a-f\d]{8}-[a-f\d]{4}-4[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i;

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
      `SELECT id, device_fingerprint, install_id
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

  const account = matchingAccounts.results[0];
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
    const { account, wallet } = await provisionAnonymousWallet(
      context.env.DB,
      body.deviceId,
      body.installId,
    );
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

app.get("/wallet/me", requireJwt, (context) =>
  errorResponse(
    context,
    501,
    "WALLET_NOT_IMPLEMENTED",
    "Wallet reads are scheduled for a later task.",
  ),
);

app.post("/wallet/claim-daily", requireJwt, (context) =>
  errorResponse(
    context,
    501,
    "WALLET_NOT_IMPLEMENTED",
    "Daily wallet grants are scheduled for a later task.",
  ),
);

app.post("/action/run", requireJwt, (context) =>
  errorResponse(
    context,
    501,
    "ACTION_NOT_IMPLEMENTED",
    "Metered actions are scheduled for a later task.",
  ),
);

app.post("/auth/email/start", (context) =>
  errorResponse(
    context,
    501,
    "AUTH_NOT_IMPLEMENTED",
    "Email sign-in is scheduled for Task PF-T307.",
  ),
);

app.post("/auth/email/verify", (context) =>
  errorResponse(
    context,
    501,
    "AUTH_NOT_IMPLEMENTED",
    "Email sign-in is scheduled for Task PF-T307.",
  ),
);

app.all("/admin/*", requireJwt, (context) =>
  errorResponse(
    context,
    501,
    "ADMIN_NOT_IMPLEMENTED",
    "Administrative operations are scheduled for Task PF-T310.",
  ),
);

export default app;

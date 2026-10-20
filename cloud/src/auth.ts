import type { MiddlewareHandler } from "hono";
import { enforceAbuseFlag } from "./abuse";
import { errorResponse } from "./errors";
import type { AuthClaims, WorkerEnv } from "./env";

function decodeBase64Url(segment: string): Uint8Array | null {
  if (!/^[\da-z_-]+$/i.test(segment)) return null;
  const base64 = segment.replaceAll("-", "+").replaceAll("_", "/");
  try {
    const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return encodeBase64Url(bytes) === segment ? bytes : null;
  } catch {
    return null;
  }
}

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

export async function signJwt(claims: AuthClaims, secret: string): Promise<string> {
  const encodedHeader = encodeBase64Url(
    new TextEncoder().encode(JSON.stringify({ alg: "HS256", typ: "JWT" })),
  );
  const encodedClaims = encodeBase64Url(new TextEncoder().encode(JSON.stringify(claims)));
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${encodedHeader}.${encodedClaims}`),
  );
  return `${encodedHeader}.${encodedClaims}.${encodeBase64Url(new Uint8Array(signature))}`;
}

function decodeClaims(segment: string): AuthClaims | null {
  const bytes = decodeBase64Url(segment);
  if (!bytes) return null;
  try {
    const payload: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (typeof payload !== "object" || payload === null) return null;
    const claims = payload as Partial<AuthClaims>;
    if (
      typeof claims.accountId !== "string" ||
      !claims.accountId ||
      typeof claims.deviceId !== "string" ||
      !claims.deviceId ||
      typeof claims.iat !== "number" ||
      !Number.isSafeInteger(claims.iat) ||
      typeof claims.exp !== "number" ||
      !Number.isSafeInteger(claims.exp)
    ) {
      return null;
    }
    return claims as AuthClaims;
  } catch {
    return null;
  }
}

async function verifyJwt(token: string, secret: string): Promise<AuthClaims | null> {
  if (token.length > 8192) return null;
  const [encodedHeader, encodedClaims, encodedSignature, extra] = token.split(".");
  if (!encodedHeader || !encodedClaims || !encodedSignature || extra !== undefined) {
    return null;
  }
  const headerBytes = decodeBase64Url(encodedHeader);
  const signature = decodeBase64Url(encodedSignature);
  if (!headerBytes || !signature) return null;

  try {
    const header: unknown = JSON.parse(new TextDecoder().decode(headerBytes));
    if (
      typeof header !== "object" ||
      header === null ||
      !("alg" in header) ||
      header.alg !== "HS256" ||
      ("typ" in header && header.typ !== "JWT")
    ) {
      return null;
    }
    const claims = decodeClaims(encodedClaims);
    if (!claims) return null;

    const now = Math.floor(Date.now() / 1000);
    if (
      claims.exp <= now ||
      claims.iat > now + 60 ||
      claims.exp <= claims.iat ||
      claims.exp - claims.iat > 7 * 24 * 60 * 60
    ) {
      return null;
    }

    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"],
    );
    const valid = await crypto.subtle.verify(
      "HMAC",
      key,
      new Uint8Array(signature),
      new TextEncoder().encode(`${encodedHeader}.${encodedClaims}`),
    );
    return valid ? claims : null;
  } catch {
    return null;
  }
}

export const requireJwt: MiddlewareHandler<{ Bindings: WorkerEnv; Variables: { auth: AuthClaims } }> =
  async (context, next) => {
    const secret = context.env.JWT_SECRET;
    if (!secret || secret.length < 32) {
      return errorResponse(
        context,
        503,
        "SERVICE_NOT_CONFIGURED",
        "JWT authentication is not configured.",
      );
    }

    const authorization = context.req.header("Authorization");
    if (!authorization?.startsWith("Bearer ")) {
      return errorResponse(
        context,
        401,
        "MISSING_TOKEN",
        "A Bearer token is required.",
      );
    }

    const claims = await verifyJwt(authorization.slice(7), secret);
    if (!claims) {
      return errorResponse(context, 401, "INVALID_TOKEN", "The Bearer token is invalid.");
    }

    try {
      const account = await context.env.DB
        .prepare("SELECT id FROM accounts WHERE id = ? AND merged_into IS NULL AND deleted_at IS NULL")
        .bind(claims.accountId)
        .first<{ id: string }>();
      if (!account) {
        return errorResponse(context, 401, "INVALID_TOKEN", "The wallet session is no longer active.");
      }
      // Privacy controls must remain available to a valid account even if cloud actions are read-only.
      if (!context.req.path.startsWith("/account/")) {
        const abuseResponse = await enforceAbuseFlag(context, claims.accountId);
        if (abuseResponse) return abuseResponse;
      }
    } catch (error) {
      console.error("Could not verify wallet account status.", {
        message: error instanceof Error ? error.message : "Unknown database error.",
      });
      return errorResponse(
        context,
        503,
        "DATABASE_UNAVAILABLE",
        "The wallet service is temporarily unavailable.",
      );
    }

    context.set("auth", claims);
    await next();
  };

import type { MiddlewareHandler } from "hono";
import { errorResponse } from "./errors";
import type { AuthClaims, WorkerEnv } from "./env";

function decodeBase64Url(segment: string): Uint8Array | null {
  if (!/^[\da-z_-]+$/i.test(segment)) return null;
  const base64 = segment.replaceAll("-", "+").replaceAll("_", "/");
  try {
    const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
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

    context.set("auth", claims);
    await next();
  };

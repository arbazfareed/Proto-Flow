import type { Context } from "hono";

export type ErrorCode =
  | "ADMIN_NOT_IMPLEMENTED"
  | "ACTION_NOT_IMPLEMENTED"
  | "AUTH_NOT_IMPLEMENTED"
  | "BAD_REQUEST"
  | "DAILY_ALREADY_CLAIMED"
  | "DAILY_IP_LIMIT"
  | "DATABASE_UNAVAILABLE"
  | "INSUFFICIENT_BALANCE"
  | "IDENTITY_CONFLICT"
  | "INVALID_PAYLOAD"
  | "INTERNAL_ERROR"
  | "INVALID_TOKEN"
  | "METHOD_NOT_ALLOWED"
  | "MISSING_TOKEN"
  | "NOT_FOUND"
  | "ORIGIN_NOT_ALLOWED"
  | "SERVICE_NOT_CONFIGURED"
  | "TURNSTILE_INVALID"
  | "TURNSTILE_REQUIRED"
  | "TURNSTILE_UNAVAILABLE"
  | "RATE_LIMITED"
  | "WALLET_FULL"
  | "WALLET_NOT_FOUND"
  | "WALLET_NOT_IMPLEMENTED";

export function errorResponse(
  context: Context,
  status: 400 | 401 | 402 | 403 | 404 | 405 | 409 | 429 | 500 | 501 | 503,
  code: ErrorCode,
  message: string,
) {
  return context.json({ error: { code, message } }, status);
}

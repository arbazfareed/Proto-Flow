import type { Context } from "hono";

export type ErrorCode =
  | "ADMIN_NOT_IMPLEMENTED"
  | "ACTION_NOT_IMPLEMENTED"
  | "AUTH_NOT_IMPLEMENTED"
  | "BAD_REQUEST"
  | "DATABASE_UNAVAILABLE"
  | "IDENTITY_CONFLICT"
  | "INTERNAL_ERROR"
  | "INVALID_TOKEN"
  | "METHOD_NOT_ALLOWED"
  | "MISSING_TOKEN"
  | "NOT_FOUND"
  | "ORIGIN_NOT_ALLOWED"
  | "SERVICE_NOT_CONFIGURED"
  | "WALLET_NOT_IMPLEMENTED";

export function errorResponse(
  context: Context,
  status: 400 | 401 | 403 | 404 | 405 | 409 | 500 | 501 | 503,
  code: ErrorCode,
  message: string,
) {
  return context.json({ error: { code, message } }, status);
}

export interface AdminAccount {
  id: string;
  deviceIdHash: string;
  email: string | null;
  createdAt: string;
  balance: number;
  lifetimeGranted: number;
  lifetimeSpent: number;
  activeFlagCount: number;
}

export interface LedgerItem {
  id: string;
  delta: number;
  reason: string;
  metadata: Record<string, number>;
  createdAt: string;
}

export interface AbuseFlag {
  id: string;
  scope: "account" | "ip";
  scopeKey: string;
  accountId: string | null;
  email: string | null;
  deviceIdHash: string | null;
  reason: string;
  mode: "challenge" | "read_only";
  flaggedAt: number;
  expiresAt: number;
  clearedAt: number | null;
}

export interface AuditEntry {
  id: string;
  actorEmail: string;
  action: string;
  targetAccountId: string | null;
  details: Record<string, unknown>;
  createdAt: string;
}

export interface DailyMetric {
  day: string;
  signups: number;
  aiCalls: number;
  publishCalls: number;
  codeExports: number;
  creditsGranted: number;
  creditsSpent: number;
  inputTokens: number;
  outputTokens: number;
  assetBytes: number;
  ledgerEntries: number;
  estimatedGeminiUsd: number;
  estimatedR2Usd: number;
  estimatedD1Usd: number;
  estimatedTotalUsd: number;
}

export class AdminApiError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) {
    super(message);
    this.name = "AdminApiError";
  }
}

function baseUrl(): string {
  const configured = import.meta.env.VITE_ADMIN_API_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  if (import.meta.env.DEV) return "http://127.0.0.1:8790";
  throw new Error("Admin API URL is not configured for this deployment.");
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${baseUrl()}${path}`, {
      ...init,
      credentials: "include",
      headers: {
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...init.headers,
      },
    });
  } catch {
    throw new AdminApiError("Cannot reach the admin API. Verify the API URL and Access configuration.", 0);
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new AdminApiError(
      response.status === 401 || response.redirected
        ? "Cloudflare Access session is required. Sign in through the protected admin hostname and retry."
        : `The admin API returned an unexpected response (${response.status}).`,
      response.status,
    );
  }
  if (!response.ok) {
    const error = typeof payload === "object" && payload !== null && "error" in payload
      ? (payload as { error?: { message?: string; code?: string } }).error
      : undefined;
    throw new AdminApiError(
      error?.message ?? `Admin request failed (${response.status}).`,
      response.status,
      error?.code,
    );
  }
  return payload as T;
}

export async function getAdminIdentity(): Promise<{ email: string }> {
  return request("/admin/me");
}

export async function getAccounts(query = "", cursor?: string): Promise<{ accounts: AdminAccount[]; nextCursor: string | null }> {
  const params = new URLSearchParams({ limit: "50" });
  if (query) params.set("q", query);
  if (cursor) params.set("cursor", cursor);
  return request(`/admin/accounts?${params}`);
}

export async function getAccount(id: string): Promise<{ account: { id: string; deviceIdHash: string; email: string | null; createdAt: string; lastSeenAt: string }; wallet: { balance: number; lifetimeGranted: number; lifetimeSpent: number }; ledger: LedgerItem[]; flags: Array<{ id: string; reason: string; mode: string; flaggedAt: number; expiresAt: number; clearedAt: number | null }> }> {
  return request(`/admin/accounts/${encodeURIComponent(id)}`);
}

export async function adjustCredits(id: string, delta: number, reason: string): Promise<{ adjusted: boolean; balance: number | null }> {
  return request(`/admin/accounts/${encodeURIComponent(id)}/adjust`, {
    method: "POST",
    body: JSON.stringify({ delta, reason }),
  });
}

export async function getFlags(includeCleared = false): Promise<{ flags: AbuseFlag[] }> {
  return request(`/admin/flags${includeCleared ? "?includeCleared=true" : ""}`);
}

export async function unflag(ids: string[]): Promise<{ cleared: number }> {
  return request("/admin/flags/unflag", { method: "POST", body: JSON.stringify({ ids }) });
}

export async function softBan(id: string, reason: string, durationHours: number): Promise<{ flagged: boolean; expiresAt: number }> {
  return request(`/admin/accounts/${encodeURIComponent(id)}/soft-ban`, {
    method: "POST",
    body: JSON.stringify({ reason, durationHours }),
  });
}

export async function reissueDailyGrants(accountIds: string[], reason: string): Promise<{ reissued: number; requested: number }> {
  return request("/admin/daily-grants/reissue", {
    method: "POST",
    body: JSON.stringify({ accountIds, reason }),
  });
}

export async function getMetrics(days = 30): Promise<{ days: number; estimatesAreApproximate: boolean; daily: DailyMetric[] }> {
  return request(`/admin/metrics?days=${days}`);
}

export async function getAudit(cursor?: string): Promise<{ entries: AuditEntry[]; nextCursor: string | null }> {
  const params = new URLSearchParams({ limit: "50" });
  if (cursor) params.set("cursor", cursor);
  return request(`/admin/audit?${params}`);
}

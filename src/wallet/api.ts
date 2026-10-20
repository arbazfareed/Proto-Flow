import { invoke, isTauri } from "@tauri-apps/api/core";

const INSTALL_ID_KEY = "protoflow.wallet.install-id";
const JWT_SESSION_KEY = "protoflow.wallet.jwt";
const CACHED_WALLET_KEY = "protoflow.wallet.cache";
const OFFLINE_GRACE_MS = 24 * 60 * 60 * 1000;

export interface WalletIdentity {
  deviceId: string;
  installId: string;
}

export interface WalletSnapshot {
  accountId: string;
  balance: number;
  lifetimeGranted: number;
  lifetimeSpent: number;
  syncedAt: number;
  recentLedger: LedgerEntry[];
  claimable: boolean;
  nextClaimAt: string | null;
}

export interface LedgerEntry {
  id: string;
  delta: number;
  reason: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

interface AnonymousWalletResponse {
  accountId: string;
  token: string;
  tokenExpiresAt: string;
  balance: number;
  lifetimeGranted: number;
  lifetimeSpent: number;
}

interface WalletResponse {
  accountId: string;
  balance: number;
  lifetimeGranted: number;
  lifetimeSpent: number;
  recentLedger: Array<{
    id: string;
    delta: number;
    reason: string;
    metadata_json: string;
    created_at: string;
  }>;
  claimable: boolean;
  nextClaimAt?: string | null;
  syncedAt: number;
}

interface DailyClaimResponse extends WalletResponse {
  claimed: boolean;
  granted: number;
}

export type MeteredActionType =
  | "ai_interaction_generator"
  | "cloud_preview_publish"
  | "react_tailwind_code_export";

export interface MeteredActionResponse<T = unknown> {
  result: T;
  wallet: WalletSnapshot;
}

interface CachedWallet extends Omit<WalletSnapshot, "recentLedger" | "claimable" | "nextClaimAt"> {
  recentLedger?: LedgerEntry[];
  claimable?: boolean;
  nextClaimAt?: string | null;
  lastSyncedAt?: number;
}

interface ApiErrorResponse {
  error?: { code?: string; message?: string };
  nextClaimAt?: string | null;
  balance?: number;
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && typeof value === "number" && value >= 0;
}

function isCachedLedgerEntry(value: unknown): value is LedgerEntry {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const entry = value as Partial<LedgerEntry>;
  return (
    typeof entry.id === "string" &&
    entry.id.length > 0 &&
    Number.isSafeInteger(entry.delta) &&
    typeof entry.delta === "number" &&
    entry.delta !== 0 &&
    typeof entry.reason === "string" &&
    typeof entry.createdAt === "string" &&
    Number.isFinite(Date.parse(entry.createdAt)) &&
    typeof entry.metadata === "object" &&
    entry.metadata !== null &&
    !Array.isArray(entry.metadata)
  );
}

export class WalletApiError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly code?: string,
    readonly retryAfterSeconds?: number,
    readonly nextClaimAt?: string | null,
    readonly balance?: number,
  ) {
    super(message);
    this.name = "WalletApiError";
  }
}

function apiBaseUrl(): string {
  const configured = import.meta.env.VITE_CLOUD_API_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  if (import.meta.env.DEV) return "http://127.0.0.1:8790";
  throw new WalletApiError(
    "The cloud wallet service has not been configured.",
    false,
    "SERVICE_NOT_CONFIGURED",
  );
}

async function createBrowserIdentity(): Promise<WalletIdentity> {
  let installId = localStorage.getItem(INSTALL_ID_KEY);
  if (!installId) {
    installId = crypto.randomUUID();
    localStorage.setItem(INSTALL_ID_KEY, installId);
  }
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(installId));
  const deviceId = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return { deviceId, installId };
}

let identityPromise: Promise<WalletIdentity> | null = null;

export function getWalletIdentity(): Promise<WalletIdentity> {
  if (!identityPromise) {
    identityPromise = isTauri()
      ? invoke<WalletIdentity>("get_wallet_identity")
      : createBrowserIdentity();
    identityPromise = identityPromise.catch((error: unknown) => {
      identityPromise = null;
      throw error;
    });
  }
  return identityPromise;
}

export async function getCachedToken(): Promise<string | null> {
  return isTauri()
    ? invoke<string | null>("get_wallet_jwt")
    : sessionStorage.getItem(JWT_SESSION_KEY);
}

export async function setCachedToken(token: string | null): Promise<void> {
  if (isTauri()) {
    if (token === null) {
      await invoke("clear_wallet_jwt");
    } else {
      await invoke("save_wallet_jwt", { token });
    }
  } else {
    if (token === null) {
      sessionStorage.removeItem(JWT_SESSION_KEY);
    } else {
      sessionStorage.setItem(JWT_SESSION_KEY, token);
    }
  }
}

export function getCachedWallet(): WalletSnapshot | null {
  const value = localStorage.getItem(CACHED_WALLET_KEY);
  if (!value) return null;
  let cached: CachedWallet;
  try {
    cached = JSON.parse(value) as CachedWallet;
  } catch {
    throw new Error("The locally cached wallet data is corrupted.");
  }
  if (
    typeof cached.accountId !== "string" ||
    cached.accountId.length === 0 ||
    !isNonNegativeSafeInteger(cached.balance) ||
    !isNonNegativeSafeInteger(cached.lifetimeGranted) ||
    !isNonNegativeSafeInteger(cached.lifetimeSpent) ||
    !isNonNegativeSafeInteger(cached.syncedAt) ||
    (cached.lastSyncedAt !== undefined && !isNonNegativeSafeInteger(cached.lastSyncedAt)) ||
    (cached.nextClaimAt !== undefined &&
      cached.nextClaimAt !== null &&
      (typeof cached.nextClaimAt !== "string" ||
        !Number.isFinite(Date.parse(cached.nextClaimAt)))) ||
    (cached.recentLedger !== undefined &&
      (!Array.isArray(cached.recentLedger) || !cached.recentLedger.every(isCachedLedgerEntry))) ||
    (cached.claimable !== undefined && typeof cached.claimable !== "boolean")
  ) {
    throw new Error("The locally cached wallet data is invalid.");
  }
  return {
    accountId: cached.accountId,
    balance: cached.balance,
    lifetimeGranted: cached.lifetimeGranted,
    lifetimeSpent: cached.lifetimeSpent,
    syncedAt: cached.lastSyncedAt ?? cached.syncedAt,
    recentLedger: cached.recentLedger ?? [],
    claimable: cached.claimable ?? false,
    nextClaimAt: cached.nextClaimAt ?? null,
  };
}

function tokenExpiration(token: string): number | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(
      atob(parts[1].replaceAll("-", "+").replaceAll("_", "/")),
    ) as { exp?: unknown };
    return typeof payload.exp === "number" && Number.isSafeInteger(payload.exp)
      ? payload.exp * 1000
      : null;
  } catch {
    return null;
  }
}

export function canUseOfflineWallet(
  cached: WalletSnapshot | null,
  now = Date.now(),
): cached is WalletSnapshot {
  return Boolean(
    cached &&
      cached.syncedAt <= now &&
      now - cached.syncedAt <= OFFLINE_GRACE_MS,
  );
}

export async function provisionAnonymousWallet(
  identity: WalletIdentity,
): Promise<{ snapshot: WalletSnapshot; token: string }> {
  const url = `${apiBaseUrl()}/auth/anonymous`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(identity),
    });
  } catch {
    throw new WalletApiError(
      "Could not reach the cloud wallet service.",
      true,
      "NETWORK_ERROR",
    );
  }

  if (!response.ok) {
    let payload: ApiErrorResponse = {};
    try {
      payload = (await response.json()) as ApiErrorResponse;
    } catch {
      if (response.status >= 500) {
        throw new WalletApiError("The cloud wallet service is temporarily unavailable.", true);
      }
    }
    throw new WalletApiError(
      payload.error?.message ?? `Wallet request failed (${response.status}).`,
      response.status >= 500,
      payload.error?.code,
    );
  }

  const result = (await response.json()) as AnonymousWalletResponse;
  const expiresAt = typeof result.token === "string" ? tokenExpiration(result.token) : null;
  if (
    typeof result.accountId !== "string" ||
    result.accountId.length === 0 ||
    typeof result.token !== "string" ||
    expiresAt === null ||
    expiresAt <= Date.now() ||
    !isNonNegativeSafeInteger(result.balance) ||
    !isNonNegativeSafeInteger(result.lifetimeGranted) ||
    !isNonNegativeSafeInteger(result.lifetimeSpent) ||
    typeof result.tokenExpiresAt !== "string" ||
    !Number.isFinite(Date.parse(result.tokenExpiresAt))
  ) {
    throw new Error("The cloud wallet service returned an invalid response.");
  }

  await setCachedToken(result.token);
  const snapshot = {
    accountId: result.accountId,
    balance: result.balance,
    lifetimeGranted: result.lifetimeGranted,
    lifetimeSpent: result.lifetimeSpent,
    syncedAt: Date.now(),
    recentLedger: [],
    claimable: false,
    nextClaimAt: null,
  };
  localStorage.setItem(CACHED_WALLET_KEY, JSON.stringify(snapshot));
  return { snapshot, token: result.token };
}

async function authenticatedRequest<T>(
  path: string,
  token: string,
  init: RequestInit = {},
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl()}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...init.headers,
      },
    });
  } catch {
    throw new WalletApiError(
      "Could not reach the cloud wallet service.",
      true,
      "NETWORK_ERROR",
    );
  }
  if (!response.ok) {
    let payload: ApiErrorResponse = {};
    try {
      payload = (await response.json()) as ApiErrorResponse;
    } catch {
      if (response.status >= 500) {
        throw new WalletApiError("The cloud wallet service is temporarily unavailable.", true);
      }
    }
    throw new WalletApiError(
      payload.error?.message ?? `Wallet request failed (${response.status}).`,
      response.status >= 500,
      payload.error?.code,
      response.status === 429
        ? Math.max(0, Number(response.headers.get("Retry-After")) || 0)
        : undefined,
      typeof payload.nextClaimAt === "string" &&
        Number.isFinite(Date.parse(payload.nextClaimAt))
        ? payload.nextClaimAt
        : null,
      isNonNegativeSafeInteger(payload.balance) ? payload.balance : undefined,
    );
  }
  return (await response.json()) as T;
}

function toSnapshot(response: WalletResponse): WalletSnapshot {
  if (
    typeof response.accountId !== "string" ||
    response.accountId.length === 0 ||
    !isNonNegativeSafeInteger(response.balance) ||
    !isNonNegativeSafeInteger(response.lifetimeGranted) ||
    !isNonNegativeSafeInteger(response.lifetimeSpent) ||
    !isNonNegativeSafeInteger(response.syncedAt) ||
    typeof response.claimable !== "boolean" ||
    (response.nextClaimAt !== undefined &&
      response.nextClaimAt !== null &&
      (typeof response.nextClaimAt !== "string" ||
        !Number.isFinite(Date.parse(response.nextClaimAt)))) ||
    !Array.isArray(response.recentLedger) ||
    response.recentLedger.length > 20
  ) {
    throw new Error("The cloud wallet service returned invalid wallet data.");
  }

  const recentLedger = response.recentLedger.map((entry) => {
    let metadata: unknown;
    try {
      metadata = JSON.parse(entry.metadata_json);
    } catch {
      throw new Error("The cloud wallet service returned invalid ledger metadata.");
    }
    if (
      typeof entry.id !== "string" ||
      !Number.isSafeInteger(entry.delta) ||
      entry.delta === 0 ||
      typeof entry.reason !== "string" ||
      typeof metadata !== "object" ||
      metadata === null ||
      Array.isArray(metadata) ||
      typeof entry.created_at !== "string" ||
      !Number.isFinite(Date.parse(entry.created_at))
    ) {
      throw new Error("The cloud wallet service returned an invalid ledger entry.");
    }
    return {
      id: entry.id,
      delta: entry.delta,
      reason: entry.reason,
      metadata: metadata as Record<string, unknown>,
      createdAt: entry.created_at,
    };
  });
  return {
    accountId: response.accountId,
    balance: response.balance,
    lifetimeGranted: response.lifetimeGranted,
    lifetimeSpent: response.lifetimeSpent,
    syncedAt: response.syncedAt,
    recentLedger,
    claimable: response.claimable,
    nextClaimAt: response.nextClaimAt ?? null,
  };
}

export async function fetchWalletMe(token: string): Promise<WalletSnapshot> {
  const response = await authenticatedRequest<WalletResponse>("/wallet/me", token);
  return toSnapshot(response);
}

export async function claimDailyCredits(
  token: string,
  turnstileToken?: string,
): Promise<WalletSnapshot> {
  const response = await authenticatedRequest<DailyClaimResponse>(
    "/wallet/claim-daily",
    token,
    {
      method: "POST",
      ...(turnstileToken ? { headers: { "X-Turnstile-Token": turnstileToken } } : {}),
    },
  );
  if (
    typeof response.claimed !== "boolean" ||
    !Number.isSafeInteger(response.granted) ||
    response.granted < 0
  ) {
    throw new Error("The cloud wallet service returned an invalid daily claim response.");
  }
  return toSnapshot(response);
}

export async function runMeteredAction<T = unknown>(
  token: string,
  type: MeteredActionType,
  payload: Record<string, unknown>,
): Promise<MeteredActionResponse<T>> {
  let body: string;
  try {
    body = JSON.stringify({ type, payload });
  } catch {
    throw new WalletApiError("The action payload must contain valid JSON values.", false, "INVALID_PAYLOAD");
  }
  if (new TextEncoder().encode(body).byteLength > 64 * 1024) {
    throw new WalletApiError("The action payload is too large.", false, "INVALID_PAYLOAD");
  }

  const response = await authenticatedRequest<unknown>("/action/run", token, {
    method: "POST",
    body,
  });
  if (typeof response !== "object" || response === null || Array.isArray(response)) {
    throw new Error("The cloud action service returned an invalid response.");
  }

  const result = response as {
    success?: unknown;
    type?: unknown;
    result?: unknown;
    wallet?: unknown;
  };
  if (
    result.success !== true ||
    result.type !== type ||
    typeof result.wallet !== "object" ||
    result.wallet === null ||
    Array.isArray(result.wallet)
  ) {
    throw new Error("The cloud action service returned an invalid success response.");
  }

  return {
    result: result.result as T,
    wallet: toSnapshot(result.wallet as WalletResponse),
  };
}

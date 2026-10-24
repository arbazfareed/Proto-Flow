import { invoke, isTauri } from "@tauri-apps/api/core";

const INSTALL_ID_KEY = "protoflow.wallet.install-id";
const JWT_SESSION_KEY = "protoflow.wallet.jwt";
const CACHED_WALLET_KEY = "protoflow.wallet.cache";
const OFFLINE_GRACE_MS = 24 * 60 * 60 * 1000;
export const MAX_LARGE_ACTION_REQUEST_BYTES = 2 * 10 * 1024 * 1024 + 64 * 1024;

export interface PublishedPreview {
  id: string;
  projectName: string;
  url: string;
  createdAt: string;
  expiresAt: string;
  sizeBytes: number;
  viewCount: number;
}

export interface WalletIdentity {
  deviceId: string;
  installId: string;
}

export interface WalletSnapshot {
  accountId: string;
  email: string | null;
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

export interface LedgerPage {
  entries: LedgerEntry[];
  nextCursor: string | null;
}

export type LedgerReason =
  | "starter_grant"
  | "daily_refill"
  | "sign_in_bonus"
  | "account_merge_cap"
  | "action:ai_generate"
  | "action:collaboration"
  | "action:cloud_publish"
  | "action:code_export"
  | "admin_adjust";

export interface WalletDataExport {
  schemaVersion: 2;
  exportedAt: string;
  account: {
    id: string;
    deviceIdHash: string;
    email: string | null;
    createdAt: string;
  };
  wallet: {
    balance: number;
    lifetimeGranted: number;
    lifetimeSpent: number;
  };
  ledger: LedgerEntry[];
  cloudData: {
    publishedPreviews: Array<{
      id: string;
      projectName: string;
      createdAt: string;
      expiresAt: string;
      sizeBytes: number;
      viewCount: number;
    }>;
    collaborations: Array<{
      id: string;
      projectName: string;
      createdAt: string;
      lastActivityAt: string;
      expiresAt: string;
      viewOnly: boolean;
      endedAt: string | null;
      checkpoints: Array<{ createdAt: string; sizeBytes: number }>;
    }>;
  };
  diagnostics: {
    crashReportsEnabled: boolean;
    recentLogLines: string[];
  };
}

export interface WalletExportDiagnostics {
  crashReportsEnabled: boolean;
  recentLogLines: string[];
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
  email?: string | null;
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
  | "collaboration_session"
  | "cloud_preview_publish"
  | "react_tailwind_code_export";

export interface ReactCodeArchive {
  fileName: string;
  zipBase64: string;
  sizeBytes: number;
}

export interface CollaborationSession {
  id: string;
  projectName: string;
  createdAt: string;
  expiresAt: string;
  viewOnly: boolean;
}

export interface MeteredActionResponse<T = unknown> {
  result: T;
  wallet: WalletSnapshot;
}

interface CachedWallet extends Omit<WalletSnapshot, "email" | "recentLedger" | "claimable" | "nextClaimAt"> {
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

interface LinkedAccountResponse {
  accountId: string;
  email: string;
  token: string;
  tokenExpiresAt: string;
}

interface TurnstileApi {
  render(
    container: HTMLElement,
    options: {
      sitekey: string;
      size: "invisible";
      execution: "execute";
      appearance: "execute";
      callback: (token: string) => void;
      "error-callback": () => void;
      "expired-callback": () => void;
    },
  ): string;
  execute(widgetId: string): void;
  remove(widgetId: string): void;
}

let turnstileScript: Promise<TurnstileApi> | null = null;

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

async function loadTurnstile(): Promise<TurnstileApi> {
  const browserWindow = window as Window & { turnstile?: TurnstileApi };
  if (browserWindow.turnstile) return browserWindow.turnstile;
  if (!turnstileScript) {
    turnstileScript = new Promise<TurnstileApi>((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      script.async = true;
      script.defer = true;
      const timeout = window.setTimeout(() => {
        turnstileScript = null;
        reject(new Error("Turnstile script loading timed out."));
      }, 15_000);
      script.onload = () => {
        window.clearTimeout(timeout);
        if (browserWindow.turnstile) resolve(browserWindow.turnstile);
        else {
          turnstileScript = null;
          reject(new Error("Turnstile script loaded without its API."));
        }
      };
      script.onerror = () => {
        window.clearTimeout(timeout);
        turnstileScript = null;
        reject(new Error("Turnstile script could not be loaded."));
      };
      document.head.appendChild(script);
    });
  }
  return turnstileScript;
}

async function createTurnstileToken(): Promise<string> {
  const siteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY?.trim();
  if (!siteKey) {
    throw new WalletApiError(
      "Anti-abuse verification is required, but no Turnstile site key is configured.",
      false,
      "TURNSTILE_UNAVAILABLE",
    );
  }

  let api: TurnstileApi;
  try {
    api = await loadTurnstile();
  } catch {
    throw new WalletApiError(
      "Anti-abuse verification could not be loaded. Check your connection and try again.",
      true,
      "TURNSTILE_UNAVAILABLE",
    );
  }
  const container = document.createElement("div");
  container.style.position = "fixed";
  container.style.left = "-10000px";
  container.style.top = "0";
  document.body.appendChild(container);

  return new Promise<string>((resolve, reject) => {
    let widgetId: string | null = null;
    const timeout = window.setTimeout(() => {
      finish(new WalletApiError("Anti-abuse verification timed out. Try again.", true, "TURNSTILE_UNAVAILABLE"));
    }, 30_000);
    const finish = (error?: Error, token?: string) => {
      window.clearTimeout(timeout);
      if (widgetId) api.remove(widgetId);
      container.remove();
      if (error) reject(error);
      else if (token) resolve(token);
      else reject(new WalletApiError("Anti-abuse verification returned no token.", true, "TURNSTILE_UNAVAILABLE"));
    };

    try {
      widgetId = api.render(container, {
        sitekey: siteKey,
        size: "invisible",
        execution: "execute",
        appearance: "execute",
        callback: (token) => finish(undefined, token),
        "error-callback": () =>
          finish(new WalletApiError("Anti-abuse verification failed. Try again.", true, "TURNSTILE_UNAVAILABLE")),
        "expired-callback": () =>
          finish(new WalletApiError("Anti-abuse verification expired. Try again.", true, "TURNSTILE_UNAVAILABLE")),
      });
      api.execute(widgetId);
    } catch {
      finish(new WalletApiError("Anti-abuse verification could not start.", true, "TURNSTILE_UNAVAILABLE"));
    }
  });
}

async function fetchWithTurnstileRetry(url: string, init: RequestInit): Promise<Response> {
  const response = await fetch(url, init);
  if (response.status !== 403) return response;

  let requiresChallenge = false;
  try {
    const payload: unknown = await response.clone().json();
    requiresChallenge =
      typeof payload === "object" &&
      payload !== null &&
      "error" in payload &&
      typeof payload.error === "object" &&
      payload.error !== null &&
      "code" in payload.error &&
      payload.error.code === "TURNSTILE_REQUIRED";
  } catch {
    return response;
  }
  if (!requiresChallenge) return response;

  const token = await createTurnstileToken();
  const headers = new Headers(init.headers);
  headers.set("X-Turnstile-Token", token);
  return fetch(url, { ...init, headers });
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

export async function resetWalletIdentity(): Promise<WalletIdentity> {
  let identity: WalletIdentity;
  if (isTauri()) {
    identity = await invoke<WalletIdentity>("reset_wallet_identity");
  } else {
    await setCachedToken(null);
    const installId = crypto.randomUUID();
    localStorage.setItem(INSTALL_ID_KEY, installId);
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(installId));
    const deviceId = Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
    identity = { deviceId, installId };
  }
  localStorage.removeItem(CACHED_WALLET_KEY);
  identityPromise = Promise.resolve(identity);
  return identity;
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
    email: null,
    balance: cached.balance,
    lifetimeGranted: cached.lifetimeGranted,
    lifetimeSpent: cached.lifetimeSpent,
    syncedAt: cached.lastSyncedAt ?? cached.syncedAt,
    recentLedger: cached.recentLedger ?? [],
    claimable: cached.claimable ?? false,
    nextClaimAt: cached.nextClaimAt ?? null,
  };
}

export function tokenExpiration(token: string): number | null {
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

export async function checkCloudHealth(): Promise<boolean> {
  let url: string;
  try {
    url = `${apiBaseUrl()}/health`;
  } catch (error) {
    if (error instanceof WalletApiError && error.code === "SERVICE_NOT_CONFIGURED") return false;
    throw error;
  }
  let response: Response;
  try {
    response = await fetch(url, {
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    return false;
  }
  if (!response.ok) return false;
  let result: unknown;
  try {
    result = await response.json();
  } catch {
    return false;
  }
  return typeof result === "object" &&
    result !== null &&
    !Array.isArray(result) &&
    "status" in result &&
    result.status === "ok";
}

export async function provisionAnonymousWallet(
  identity: WalletIdentity,
): Promise<{ snapshot: WalletSnapshot; token: string }> {
  const url = `${apiBaseUrl()}/auth/anonymous`;
  let response: Response;
  try {
    response = await fetchWithTurnstileRetry(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(identity),
    });
  } catch (error) {
    if (error instanceof WalletApiError) throw error;
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
    email: null,
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
    response = await fetchWithTurnstileRetry(`${apiBaseUrl()}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...init.headers,
      },
    });
  } catch (error) {
    if (error instanceof WalletApiError) throw error;
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
    email: typeof response.email === "string" ? response.email : null,
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

export async function fetchLedgerPage(
  token: string,
  options: { limit?: number; cursor?: string | null; reason?: LedgerReason | null } = {},
): Promise<LedgerPage> {
  const limit = options.limit ?? 50;
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
    throw new RangeError("Ledger page size must be between 1 and 50.");
  }
  const query = new URLSearchParams({ limit: String(limit) });
  if (options.cursor) query.set("cursor", options.cursor);
  if (options.reason) query.set("reason", options.reason);
  const response = await authenticatedRequest<unknown>(`/wallet/ledger?${query}`, token);
  if (
    typeof response !== "object" || response === null || Array.isArray(response) ||
    !("entries" in response) || !Array.isArray(response.entries) ||
    !("nextCursor" in response) ||
    (response.nextCursor !== null && typeof response.nextCursor !== "string") ||
    response.entries.length > limit
  ) {
    throw new Error("The cloud wallet service returned invalid ledger history.");
  }
  const entries = response.entries.map((entry) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      throw new Error("The cloud wallet service returned an invalid ledger entry.");
    }
    const value = entry as Partial<LedgerEntry>;
    if (
      typeof value.id !== "string" || value.id.length === 0 ||
      !Number.isSafeInteger(value.delta) || value.delta === 0 ||
      typeof value.reason !== "string" ||
      typeof value.createdAt !== "string" || !Number.isFinite(Date.parse(value.createdAt)) ||
      typeof value.metadata !== "object" || value.metadata === null || Array.isArray(value.metadata)
    ) {
      throw new Error("The cloud wallet service returned an invalid ledger entry.");
    }
    return value as LedgerEntry;
  });
  return { entries, nextCursor: response.nextCursor as string | null };
}

export async function fetchAllLedgerEntries(
  token: string,
  reason?: LedgerReason | null,
): Promise<LedgerEntry[]> {
  const entries: LedgerEntry[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | null = null;
  do {
    const page = await fetchLedgerPage(token, { limit: 50, cursor, reason });
    entries.push(...page.entries);
    cursor = page.nextCursor;
    if (cursor && seenCursors.has(cursor)) {
      throw new Error("The cloud wallet service repeated a ledger cursor.");
    }
    if (cursor) seenCursors.add(cursor);
  } while (cursor);
  return entries;
}

export async function exportWalletData(
  token: string,
  diagnostics: WalletExportDiagnostics = { crashReportsEnabled: false, recentLogLines: [] },
): Promise<WalletDataExport> {
  const response = await authenticatedRequest<unknown>("/account/export", token);
  if (typeof response !== "object" || response === null || Array.isArray(response)) {
    throw new Error("The cloud wallet service returned an invalid data export.");
  }
  const result = response as Partial<WalletDataExport>;
  if (
    result.schemaVersion !== 2 ||
    typeof result.exportedAt !== "string" || !Number.isFinite(Date.parse(result.exportedAt)) ||
    typeof result.account !== "object" || result.account === null ||
    typeof result.wallet !== "object" || result.wallet === null ||
    !Array.isArray(result.ledger) ||
    typeof result.cloudData !== "object" || result.cloudData === null ||
    !Array.isArray(result.cloudData.publishedPreviews) ||
    !Array.isArray(result.cloudData.collaborations)
  ) {
    throw new Error("The cloud wallet service returned an invalid data export.");
  }
  const { account, wallet } = result;
  if (
    typeof account.id !== "string" || typeof account.deviceIdHash !== "string" ||
    !(account.email === null || typeof account.email === "string") ||
    typeof account.createdAt !== "string" || !Number.isFinite(Date.parse(account.createdAt)) ||
    !isNonNegativeSafeInteger(wallet.balance) ||
    !isNonNegativeSafeInteger(wallet.lifetimeGranted) ||
    !isNonNegativeSafeInteger(wallet.lifetimeSpent)
  ) {
    throw new Error("The cloud wallet service returned invalid account or wallet data.");
  }
  const ledger = result.ledger.map((entry) => {
    if (
      typeof entry !== "object" || entry === null || Array.isArray(entry) ||
      typeof entry.id !== "string" || !Number.isSafeInteger(entry.delta) || entry.delta === 0 ||
      typeof entry.reason !== "string" ||
      typeof entry.createdAt !== "string" || !Number.isFinite(Date.parse(entry.createdAt)) ||
      typeof entry.metadata !== "object" || entry.metadata === null || Array.isArray(entry.metadata)
    ) {
      throw new Error("The cloud wallet service returned an invalid ledger entry in the export.");
    }
    return entry;
  });
  const publishedPreviews = result.cloudData.publishedPreviews.map((preview) => {
    if (
      typeof preview !== "object" || preview === null || Array.isArray(preview) ||
      typeof preview.id !== "string" || typeof preview.projectName !== "string" ||
      typeof preview.createdAt !== "string" || !Number.isFinite(Date.parse(preview.createdAt)) ||
      typeof preview.expiresAt !== "string" || !Number.isFinite(Date.parse(preview.expiresAt)) ||
      !isNonNegativeSafeInteger(preview.sizeBytes) ||
      !isNonNegativeSafeInteger(preview.viewCount)
    ) {
      throw new Error("The cloud wallet service returned an invalid published-preview record.");
    }
    return preview;
  });
  const collaborations = result.cloudData.collaborations.map((collaboration) => {
    if (
      typeof collaboration !== "object" || collaboration === null || Array.isArray(collaboration) ||
      typeof collaboration.id !== "string" || typeof collaboration.projectName !== "string" ||
      typeof collaboration.createdAt !== "string" || !Number.isFinite(Date.parse(collaboration.createdAt)) ||
      typeof collaboration.lastActivityAt !== "string" || !Number.isFinite(Date.parse(collaboration.lastActivityAt)) ||
      typeof collaboration.expiresAt !== "string" || !Number.isFinite(Date.parse(collaboration.expiresAt)) ||
      typeof collaboration.viewOnly !== "boolean" ||
      !(collaboration.endedAt === null ||
        (typeof collaboration.endedAt === "string" && Number.isFinite(Date.parse(collaboration.endedAt)))) ||
      !Array.isArray(collaboration.checkpoints)
    ) {
      throw new Error("The cloud wallet service returned an invalid collaboration record.");
    }
    const checkpoints = collaboration.checkpoints.map((checkpoint) => {
      if (
        typeof checkpoint !== "object" || checkpoint === null || Array.isArray(checkpoint) ||
        typeof checkpoint.createdAt !== "string" || !Number.isFinite(Date.parse(checkpoint.createdAt)) ||
        !isNonNegativeSafeInteger(checkpoint.sizeBytes)
      ) {
        throw new Error("The cloud wallet service returned an invalid collaboration checkpoint.");
      }
      return checkpoint;
    });
    return { ...collaboration, checkpoints };
  });
  if (
    typeof diagnostics.crashReportsEnabled !== "boolean" ||
    !Array.isArray(diagnostics.recentLogLines) ||
    diagnostics.recentLogLines.some((line) => typeof line !== "string")
  ) {
    throw new Error("Local diagnostic history for the data export is invalid.");
  }
  return {
    schemaVersion: 2,
    exportedAt: result.exportedAt,
    account,
    wallet,
    ledger,
    cloudData: { publishedPreviews, collaborations },
    diagnostics: {
      crashReportsEnabled: diagnostics.crashReportsEnabled,
      recentLogLines: diagnostics.crashReportsEnabled ? [...diagnostics.recentLogLines] : [],
    },
  };
}

export async function deleteCloudWalletData(
  token: string,
): Promise<{ deletedAt: string; purgeAfter: string; cloudContentRemoved: boolean }> {
  const response = await authenticatedRequest<{
    deleted?: boolean;
    deletedAt?: string;
    purgeAfter?: string;
    cloudContentRemoved?: boolean;
  }>("/account/data", token, {
    method: "DELETE",
    body: JSON.stringify({ confirmation: "DELETE" }),
  });
  if (
    response.deleted !== true || typeof response.deletedAt !== "string" ||
    !Number.isFinite(Date.parse(response.deletedAt)) || typeof response.purgeAfter !== "string" ||
    !Number.isFinite(Date.parse(response.purgeAfter)) ||
    typeof response.cloudContentRemoved !== "boolean"
  ) {
    throw new Error("The cloud wallet service did not confirm data deletion.");
  }
  return {
    deletedAt: response.deletedAt,
    purgeAfter: response.purgeAfter,
    cloudContentRemoved: response.cloudContentRemoved,
  };
}

export async function startEmailSignIn(
  token: string,
  accountId: string,
  email: string,
  callbackUri: string,
): Promise<void> {
  await authenticatedRequest<{ sent: boolean; expiresIn: number }>("/auth/email/start", token, {
    method: "POST",
    body: JSON.stringify({ email, accountId, callbackUri }),
  });
}

export async function verifyEmailSignIn(
  token: string,
  magicToken: string,
): Promise<{ token: string; snapshot: WalletSnapshot }> {
  const linked = await authenticatedRequest<LinkedAccountResponse>("/auth/email/verify", token, {
    method: "POST",
    body: JSON.stringify({ token: magicToken }),
  });
  return completeAccountLink(linked);
}

export async function startGoogleSignIn(
  token: string,
  callbackUri: string,
): Promise<string> {
  const response = await authenticatedRequest<{ authorizationUrl: string }>("/auth/google/start", token, {
    method: "POST",
    body: JSON.stringify({ callbackUri }),
  });
  let authorizationUrl: URL;
  try {
    authorizationUrl = new URL(response.authorizationUrl);
  } catch {
    throw new Error("The cloud service returned an invalid Google sign-in URL.");
  }
  if (
    authorizationUrl.protocol !== "https:" ||
    authorizationUrl.hostname !== "accounts.google.com" ||
    authorizationUrl.pathname !== "/o/oauth2/v2/auth"
  ) {
    throw new Error("The cloud service returned an untrusted Google sign-in URL.");
  }
  return authorizationUrl.toString();
}

export async function verifyGoogleSignIn(
  token: string,
  ticket: string,
): Promise<{ token: string; snapshot: WalletSnapshot }> {
  const linked = await authenticatedRequest<LinkedAccountResponse>("/auth/google/verify", token, {
    method: "POST",
    body: JSON.stringify({ ticket }),
  });
  return completeAccountLink(linked);
}

async function completeAccountLink(
  linked: LinkedAccountResponse,
): Promise<{ token: string; snapshot: WalletSnapshot }> {
  if (typeof linked !== "object" || linked === null || Array.isArray(linked)) {
    throw new Error("The cloud service returned an invalid linked-account response.");
  }
  const expiresAt = typeof linked.token === "string" ? tokenExpiration(linked.token) : null;
  if (
    typeof linked.accountId !== "string" ||
    linked.accountId.length === 0 ||
    typeof linked.email !== "string" ||
    !EMAIL_PATTERN.test(linked.email) ||
    !linked.token ||
    expiresAt === null ||
    expiresAt <= Date.now() ||
    !Number.isFinite(Date.parse(linked.tokenExpiresAt))
  ) {
    throw new Error("The cloud service returned an invalid linked-account response.");
  }
  const snapshot = await fetchWalletMe(linked.token);
  if (snapshot.accountId !== linked.accountId || snapshot.email !== linked.email) {
    throw new Error("The cloud service returned inconsistent linked-account details.");
  }
  return { token: linked.token, snapshot };
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function signOutAccount(token: string): Promise<void> {
  const response = await authenticatedRequest<{ signedOut: boolean }>("/auth/sign-out", token, {
    method: "POST",
  });
  if (response.signedOut !== true) {
    throw new Error("The cloud service did not confirm sign-out.");
  }
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
  const maximumBytes =
    type === "cloud_preview_publish" ||
    type === "collaboration_session" ||
    type === "react_tailwind_code_export"
      ? MAX_LARGE_ACTION_REQUEST_BYTES
      : 64 * 1024;
  if (new TextEncoder().encode(body).byteLength > maximumBytes) {
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

  let actionResult = result.result;
  if (type === "react_tailwind_code_export") {
    if (
      typeof actionResult !== "object" ||
      actionResult === null ||
      Array.isArray(actionResult)
    ) {
      throw new Error("The cloud service returned an invalid React export archive.");
    }
    const archive = actionResult as Partial<ReactCodeArchive>;
    if (
      typeof archive.fileName !== "string" ||
      !/^[a-z0-9-]+-react-export\.zip$/.test(archive.fileName) ||
      typeof archive.zipBase64 !== "string" ||
      archive.zipBase64.length === 0 ||
      archive.zipBase64.length > 20 * 1024 * 1024 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(archive.zipBase64) ||
      !isNonNegativeSafeInteger(archive.sizeBytes) ||
      archive.sizeBytes > 15 * 1024 * 1024
    ) {
      throw new Error("The cloud service returned an invalid React export archive.");
    }
    actionResult = archive;
  }

  return {
    result: actionResult as T,
    wallet: toSnapshot(result.wallet as WalletResponse),
  };
}

function parsePublishedPreview(value: unknown): PublishedPreview {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("The cloud service returned invalid published preview data.");
  }
  const preview = value as Partial<PublishedPreview>;
  let url: URL | null = null;
  try {
    if (typeof preview.url === "string") url = new URL(preview.url);
  } catch {
    url = null;
  }
  if (
    typeof preview.id !== "string" ||
    !/^[A-Za-z0-9]{8}$/.test(preview.id) ||
    typeof preview.projectName !== "string" ||
    !preview.projectName ||
    !url ||
    !["https:", "http:"].includes(url.protocol) ||
    typeof preview.createdAt !== "string" ||
    !Number.isFinite(Date.parse(preview.createdAt)) ||
    typeof preview.expiresAt !== "string" ||
    !Number.isFinite(Date.parse(preview.expiresAt)) ||
    !isNonNegativeSafeInteger(preview.sizeBytes) ||
    preview.sizeBytes > 10 * 1024 * 1024 ||
    !isNonNegativeSafeInteger(preview.viewCount)
  ) {
    throw new Error("The cloud service returned invalid published preview data.");
  }
  return preview as PublishedPreview;
}

export async function fetchPublishedPreviews(token: string): Promise<PublishedPreview[]> {
  const response = await authenticatedRequest<unknown>("/previews", token);
  if (
    typeof response !== "object" ||
    response === null ||
    Array.isArray(response) ||
    !("previews" in response) ||
    !Array.isArray(response.previews) ||
    response.previews.length > 50
  ) {
    throw new Error("The cloud service returned invalid preview history.");
  }
  return response.previews.map(parsePublishedPreview);
}

export async function unpublishPreview(token: string, id: string): Promise<void> {
  if (!/^[A-Za-z0-9]{8}$/.test(id)) {
    throw new Error("The published preview ID is invalid.");
  }
  const response = await authenticatedRequest<unknown>(`/previews/${encodeURIComponent(id)}`, token, {
    method: "DELETE",
  });
  if (
    typeof response !== "object" ||
    response === null ||
    Array.isArray(response) ||
    !("success" in response) ||
    response.success !== true
  ) {
    throw new Error("The cloud service returned an invalid unpublish response.");
  }
}

export async function createCollaborationConnectTicket(
  token: string,
  sessionId: string,
  displayName: string,
): Promise<string> {
  if (!/^[A-Za-z0-9_-]{24}$/.test(sessionId) || !displayName.trim() || displayName.length > 40) {
    throw new Error("The collaboration session or display name is invalid.");
  }
  const response = await authenticatedRequest<unknown>(
    `/collaboration/${encodeURIComponent(sessionId)}/connect-ticket`,
    token,
    { method: "POST", body: JSON.stringify({ displayName: displayName.trim() }) },
  );
  if (
    typeof response !== "object" ||
    response === null ||
    Array.isArray(response) ||
    !("ticket" in response) ||
    typeof response.ticket !== "string" ||
    response.ticket.length < 40 ||
    response.ticket.length > 100
  ) {
    throw new Error("The collaboration service returned an invalid connection ticket.");
  }
  return response.ticket;
}

export function collaborationSocketUrl(sessionId: string, ticket: string): string {
  if (!/^[A-Za-z0-9_-]{24}$/.test(sessionId) || ticket.length < 40 || ticket.length > 100) {
    throw new Error("The collaboration connection details are invalid.");
  }
  const url = new URL(`${apiBaseUrl()}/collaboration/${encodeURIComponent(sessionId)}/socket`);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("ticket", ticket);
  return url.toString();
}

export async function updateCollaborationPermissions(
  token: string,
  sessionId: string,
  viewOnly: boolean,
): Promise<void> {
  if (!/^[A-Za-z0-9_-]{24}$/.test(sessionId)) {
    throw new Error("The collaboration session ID is invalid.");
  }
  const response = await authenticatedRequest<unknown>(
    `/collaboration/${encodeURIComponent(sessionId)}/permissions`,
    token,
    { method: "POST", body: JSON.stringify({ viewOnly }) },
  );
  if (
    typeof response !== "object" ||
    response === null ||
    Array.isArray(response) ||
    !("viewOnly" in response) ||
    response.viewOnly !== viewOnly
  ) {
    throw new Error("The collaboration service returned an invalid permission response.");
  }
}

export async function endCollaborationSession(token: string, sessionId: string): Promise<void> {
  if (!/^[A-Za-z0-9_-]{24}$/.test(sessionId)) {
    throw new Error("The collaboration session ID is invalid.");
  }
  const response = await authenticatedRequest<unknown>(
    `/collaboration/${encodeURIComponent(sessionId)}/end`,
    token,
    { method: "POST" },
  );
  if (
    typeof response !== "object" ||
    response === null ||
    Array.isArray(response) ||
    !("ended" in response) ||
    response.ended !== true
  ) {
    throw new Error("The collaboration service returned an invalid end-session response.");
  }
}

export async function submitInteractionFeedback(
  token: string,
  ruleId: string,
  feedback: "positive" | "negative",
): Promise<void> {
  const response = await authenticatedRequest<unknown>("/action/feedback", token, {
    method: "POST",
    body: JSON.stringify({ ruleId, feedback }),
  });
  if (
    typeof response !== "object" ||
    response === null ||
    Array.isArray(response) ||
    !("success" in response) ||
    response.success !== true
  ) {
    throw new Error("The cloud service returned an invalid feedback response.");
  }
}

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
}

interface AnonymousWalletResponse {
  accountId: string;
  token: string;
  tokenExpiresAt: string;
  balance: number;
  lifetimeGranted: number;
  lifetimeSpent: number;
}

interface CachedWallet extends WalletSnapshot {
  tokenExpiresAt: string;
}

interface ApiErrorResponse {
  error?: { code?: string; message?: string };
}

export class WalletApiError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "WalletApiError";
  }
}

function apiBaseUrl(): string {
  const configured = import.meta.env.VITE_CLOUD_API_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  if (import.meta.env.DEV) return "http://127.0.0.1:8790";
  throw new WalletApiError("The cloud wallet service has not been configured.", false);
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

async function storeToken(token: string): Promise<void> {
  if (isTauri()) {
    await invoke("save_wallet_jwt", { token });
  } else {
    sessionStorage.setItem(JWT_SESSION_KEY, token);
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
    !Number.isSafeInteger(cached.balance) ||
    !Number.isSafeInteger(cached.lifetimeGranted) ||
    !Number.isSafeInteger(cached.lifetimeSpent) ||
    !Number.isSafeInteger(cached.syncedAt) ||
    typeof cached.tokenExpiresAt !== "string"
  ) {
    throw new Error("The locally cached wallet data is invalid.");
  }
  return cached;
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
  token: string | null,
  cached: WalletSnapshot | null,
  now = Date.now(),
): cached is WalletSnapshot {
  const expiresAt = token ? tokenExpiration(token) : null;
  return Boolean(
    cached &&
      expiresAt &&
      expiresAt > now &&
      cached.syncedAt <= now &&
      now - cached.syncedAt <= OFFLINE_GRACE_MS,
  );
}

export async function provisionAnonymousWallet(
  identity: WalletIdentity,
): Promise<WalletSnapshot> {
  const url = `${apiBaseUrl()}/auth/anonymous`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(identity),
    });
  } catch {
    throw new WalletApiError("Could not reach the cloud wallet service.", true);
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
    );
  }

  const result = (await response.json()) as AnonymousWalletResponse;
  if (
    typeof result.accountId !== "string" ||
    typeof result.token !== "string" ||
    tokenExpiration(result.token) === null ||
    !Number.isSafeInteger(result.balance) ||
    !Number.isSafeInteger(result.lifetimeGranted) ||
    !Number.isSafeInteger(result.lifetimeSpent) ||
    typeof result.tokenExpiresAt !== "string"
  ) {
    throw new Error("The cloud wallet service returned an invalid response.");
  }

  await storeToken(result.token);
  const snapshot = {
    accountId: result.accountId,
    balance: result.balance,
    lifetimeGranted: result.lifetimeGranted,
    lifetimeSpent: result.lifetimeSpent,
    syncedAt: Date.now(),
  };
  localStorage.setItem(
    CACHED_WALLET_KEY,
    JSON.stringify({ ...snapshot, tokenExpiresAt: result.tokenExpiresAt }),
  );
  return snapshot;
}

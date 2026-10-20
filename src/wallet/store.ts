import { create } from "zustand";
import {
  canUseOfflineWallet,
  claimDailyCredits,
  fetchWalletMe,
  getCachedToken,
  getCachedWallet,
  getWalletIdentity,
  provisionAnonymousWallet,
  resetWalletIdentity as resetStoredWalletIdentity,
  signOutAccount,
  startEmailSignIn,
  startGoogleSignIn,
  setCachedToken,
  tokenExpiration,
  verifyEmailSignIn,
  verifyGoogleSignIn,
  WalletApiError,
  type LedgerEntry,
  type WalletSnapshot,
} from "./api";
import type { NetworkStatus } from "./network";

type WalletStatus = "loading" | "online" | "offline" | "error";

interface WalletState {
  status: WalletStatus;
  networkStatus: NetworkStatus;
  balance: number;
  lifetimeGranted: number;
  lifetimeSpent: number;
  jwt: string | null;
  accountId: string | null;
  email: string | null;
  recentLedger: LedgerEntry[];
  lastSyncedAt: number | null;
  claimable: boolean;
  nextClaimAt: string | null;
  error: string | null;
  setWallet: (snapshot: WalletSnapshot, jwt?: string | null) => void;
  setBalance: (balance: number) => void;
  appendLedger: (entry: LedgerEntry) => void;
  setJwt: (jwt: string | null) => Promise<void>;
  clear: () => Promise<void>;
  optimisticSpend: (amount: number) => boolean;
  sync: () => Promise<void>;
  initialize: () => Promise<number>;
  claimDaily: () => Promise<boolean>;
  resetIdentity: () => Promise<void>;
  startEmailSignIn: (email: string, callbackUri: string) => Promise<void>;
  verifyEmailSignIn: (token: string) => Promise<void>;
  startGoogleSignIn: (callbackUri: string) => Promise<string>;
  verifyGoogleSignIn: (ticket: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const CACHE_KEY = "protoflow.wallet.cache";
const MAX_LEDGER_ENTRIES = 20;

let syncPromise: Promise<void> | null = null;

function persistWallet(snapshot: WalletSnapshot): void {
  localStorage.setItem(
    CACHE_KEY,
    JSON.stringify({
      accountId: snapshot.accountId,
      balance: snapshot.balance,
      lifetimeGranted: snapshot.lifetimeGranted,
      lifetimeSpent: snapshot.lifetimeSpent,
      syncedAt: snapshot.syncedAt,
      recentLedger: snapshot.recentLedger,
      claimable: snapshot.claimable,
      nextClaimAt: snapshot.nextClaimAt,
      lastSyncedAt: snapshot.syncedAt,
    }),
  );
}

function toSnapshot(state: WalletState, syncedAt = state.lastSyncedAt ?? Date.now()): WalletSnapshot {
  return {
    accountId: state.accountId ?? "",
    email: state.email,
    balance: state.balance,
    lifetimeGranted: state.lifetimeGranted,
    lifetimeSpent: state.lifetimeSpent,
    syncedAt,
    recentLedger: state.recentLedger,
    claimable: state.claimable,
    nextClaimAt: state.nextClaimAt,
  };
}

function setSnapshot(snapshot: WalletSnapshot, jwt?: string | null): void {
  persistWallet(snapshot);
  useWalletStore.setState({
    status: "online",
    networkStatus: "online",
    balance: snapshot.balance,
    lifetimeGranted: snapshot.lifetimeGranted,
    lifetimeSpent: snapshot.lifetimeSpent,
    jwt: jwt === undefined ? useWalletStore.getState().jwt : jwt,
    accountId: snapshot.accountId,
    email: snapshot.email,
    recentLedger: snapshot.recentLedger.slice(0, MAX_LEDGER_ENTRIES),
    lastSyncedAt: snapshot.syncedAt,
    claimable: snapshot.claimable,
    nextClaimAt: snapshot.nextClaimAt,
    error: null,
  });
}

async function refreshToken(): Promise<string> {
  const identity = await getWalletIdentity();
  const { token, snapshot } = await provisionAnonymousWallet(identity);
  persistWallet(snapshot);
  useWalletStore.setState({
    networkStatus: "online",
    balance: snapshot.balance,
    lifetimeGranted: snapshot.lifetimeGranted,
    lifetimeSpent: snapshot.lifetimeSpent,
    accountId: snapshot.accountId,
    email: snapshot.email,
    recentLedger: snapshot.recentLedger,
    lastSyncedAt: snapshot.syncedAt,
    claimable: snapshot.claimable,
    nextClaimAt: snapshot.nextClaimAt,
    jwt: token,
    error: null,
  });
  return token;
}

async function loadCachedWallet(): Promise<void> {
  const cached = getCachedWallet();
  if (!cached || !canUseOfflineWallet(cached)) {
    throw new Error("The wallet is unavailable until the cloud service can be reached.");
  }
  useWalletStore.setState({
    status: "offline",
    balance: cached.balance,
    lifetimeGranted: cached.lifetimeGranted,
    lifetimeSpent: cached.lifetimeSpent,
    jwt: null,
    accountId: cached.accountId,
    email: null,
    recentLedger: cached.recentLedger.slice(0, MAX_LEDGER_ENTRIES),
    lastSyncedAt: cached.syncedAt,
    claimable: false,
    nextClaimAt: cached.nextClaimAt,
    error: null,
  });
}

async function syncWallet(): Promise<void> {
  const current = useWalletStore.getState();
  if (current.status !== "online" && current.status !== "offline") {
    useWalletStore.setState({ status: "loading", error: null });
  }

  try {
    let token = current.jwt ?? (await getCachedToken());
    let snapshot: WalletSnapshot;
    if (!token || tokenExpiresSoon(token)) token = await refreshToken();
    try {
      snapshot = await fetchWalletMe(token);
    } catch (error) {
      if (
        !(error instanceof WalletApiError) ||
        !["INVALID_TOKEN", "MISSING_TOKEN"].includes(error.code ?? "")
      ) {
        throw error;
      }
      token = await refreshToken();
      snapshot = await fetchWalletMe(token);
    }
    setSnapshot(snapshot, token);
  } catch (error) {
    if (
      error instanceof WalletApiError &&
      (error.retryable || error.code === "SERVICE_NOT_CONFIGURED")
    ) {
      useWalletStore.setState({ networkStatus: "offline" });
      try {
        await loadCachedWallet();
        useWalletStore.setState({
          error: "Sync paused — reconnect to use cloud features. Showing your last synced balance.",
        });
        return;
      } catch (offlineError) {
        useWalletStore.setState({
          status: "error",
          balance: 0,
          lifetimeGranted: 0,
          lifetimeSpent: 0,
          jwt: null,
          accountId: null,
          email: null,
          recentLedger: [],
          lastSyncedAt: null,
          claimable: false,
          nextClaimAt: null,
          error: offlineError instanceof Error ? offlineError.message : "Wallet sync failed.",
        });
        return;
      }
    }

    if (error instanceof WalletApiError && error.code === "WALLET_NOT_FOUND") {
      try {
        const token = await refreshToken();
        setSnapshot(await fetchWalletMe(token), token);
        return;
      } catch (refreshError) {
        error = refreshError;
      }
    }
    useWalletStore.setState({
      status: "error",
      error: error instanceof Error ? error.message : "Could not sync the wallet.",
    });
  }
}

export const useWalletStore = create<WalletState>((set, get) => ({
  status: "loading",
  networkStatus: "checking",
  balance: 0,
  lifetimeGranted: 0,
  lifetimeSpent: 0,
  jwt: null,
  accountId: null,
  email: null,
  recentLedger: [],
  lastSyncedAt: null,
  claimable: false,
  nextClaimAt: null,
  error: null,
  setWallet: (snapshot, jwt) => setSnapshot(snapshot, jwt),
  setBalance: (balance) => {
    if (!Number.isSafeInteger(balance) || balance < 0) {
      throw new RangeError("Wallet balance must be a non-negative integer.");
    }
    set({ balance });
    if (get().accountId && get().lastSyncedAt !== null) persistWallet(toSnapshot(get()));
  },
  appendLedger: (entry) => {
    set((state) => ({
      recentLedger: [entry, ...state.recentLedger.filter((item) => item.id !== entry.id)].slice(
        0,
        MAX_LEDGER_ENTRIES,
      ),
    }));
    if (get().accountId && get().lastSyncedAt !== null) persistWallet(toSnapshot(get()));
  },
  setJwt: async (jwt) => {
    await setCachedToken(jwt);
    set({ jwt });
  },
  clear: async () => {
    await setCachedToken(null);
    localStorage.removeItem(CACHE_KEY);
    set({
      status: "loading",
      balance: 0,
      lifetimeGranted: 0,
      lifetimeSpent: 0,
      jwt: null,
      accountId: null,
      email: null,
      recentLedger: [],
      lastSyncedAt: null,
      claimable: false,
      nextClaimAt: null,
      error: null,
    });
  },
  optimisticSpend: (amount) => {
    const state = get();
    if (
      !Number.isSafeInteger(amount) ||
      amount <= 0 ||
      state.status !== "online" ||
      state.balance < amount
    ) {
      return false;
    }
    set({
      balance: state.balance - amount,
      lifetimeSpent: state.lifetimeSpent + amount,
    });
    return true;
  },
  sync: () => {
    if (!syncPromise) {
      syncPromise = syncWallet().finally(() => {
        syncPromise = null;
      });
    }
    return syncPromise;
  },
  initialize: async () => {
    await get().sync();
    const wallet = get();
    if (wallet.status !== "online" || !wallet.claimable) return 0;
    const previousBalance = wallet.balance;
    const claimed = await get().claimDaily();
    return claimed ? Math.max(0, get().balance - previousBalance) : 0;
  },
  claimDaily: async () => {
    const state = get();
    if (!state.claimable || state.status !== "online" || !state.jwt) return false;
    try {
      const snapshot = await claimDailyCredits(state.jwt);
      setSnapshot(snapshot, state.jwt);
      return snapshot.balance > state.balance;
    } catch (error) {
      if (error instanceof WalletApiError && error.code === "INVALID_TOKEN") {
        await get().sync();
      } else if (
        error instanceof WalletApiError &&
        ["DAILY_ALREADY_CLAIMED", "DAILY_IP_LIMIT", "WALLET_FULL"].includes(error.code ?? "")
      ) {
        set({
          claimable: false,
          nextClaimAt: error.nextClaimAt ?? get().nextClaimAt,
          ...(error.balance === undefined ? {} : { balance: error.balance }),
          error: null,
        });
      } else {
        set({
          error: error instanceof Error ? error.message : "Could not claim daily credits.",
        });
      }
      return false;
    }
  },
  resetIdentity: async () => {
    set({ status: "loading", error: null });
    try {
      await resetStoredWalletIdentity();
      set({
        balance: 0,
        lifetimeGranted: 0,
        lifetimeSpent: 0,
        jwt: null,
        accountId: null,
        email: null,
        recentLedger: [],
        lastSyncedAt: null,
        claimable: false,
        nextClaimAt: null,
      });
      const token = await refreshToken();
      setSnapshot(await fetchWalletMe(token), token);
    } catch (error) {
      set({
        status: "error",
        error: error instanceof Error ? error.message : "Could not refresh the wallet session.",
      });
      throw error;
    }
  },
  startEmailSignIn: async (email, callbackUri) => {
    const { jwt, accountId, status, networkStatus } = get();
    if (!jwt || !accountId || status !== "online" || networkStatus !== "online") {
      throw new Error("Connect to the cloud before signing in.");
    }
    await startEmailSignIn(jwt, accountId, email, callbackUri);
  },
  verifyEmailSignIn: async (token) => {
    const currentToken = get().jwt;
    if (!currentToken) throw new Error("Your wallet session is unavailable. Reconnect and try again.");
    const linked = await verifyEmailSignIn(currentToken, token);
    await setCachedToken(linked.token);
    setSnapshot(linked.snapshot, linked.token);
  },
  startGoogleSignIn: async (callbackUri) => {
    const { jwt, status, networkStatus } = get();
    if (!jwt || status !== "online" || networkStatus !== "online") {
      throw new Error("Connect to the cloud before signing in.");
    }
    return startGoogleSignIn(jwt, callbackUri);
  },
  verifyGoogleSignIn: async (ticket) => {
    const currentToken = get().jwt;
    if (!currentToken) throw new Error("Your wallet session is unavailable. Reconnect and try again.");
    const linked = await verifyGoogleSignIn(currentToken, ticket);
    await setCachedToken(linked.token);
    setSnapshot(linked.snapshot, linked.token);
  },
  signOut: async () => {
    const token = get().jwt;
    if (!token) return;
    await signOutAccount(token);
    await setCachedToken(null);
    set({ jwt: null, email: null });
  },
}));

function tokenExpiresSoon(token: string, now = Date.now()): boolean {
  const expiresAt = tokenExpiration(token);
  return expiresAt !== null && expiresAt <= now + 60_000;
}

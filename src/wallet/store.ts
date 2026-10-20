import { create } from "zustand";
import {
  canUseOfflineWallet,
  getCachedToken,
  getCachedWallet,
  getWalletIdentity,
  provisionAnonymousWallet,
  WalletApiError,
  type WalletSnapshot,
} from "./api";

type WalletStatus = "loading" | "online" | "offline" | "error";

interface WalletState {
  status: WalletStatus;
  balance: number | null;
  accountId: string | null;
  error: string | null;
  initialize: () => Promise<void>;
  resetIdentity: () => Promise<void>;
}

let initializePromise: Promise<void> | null = null;

function updateSnapshot(snapshot: WalletSnapshot, status: WalletStatus) {
  useWalletStore.setState({
    status,
    balance: snapshot.balance,
    accountId: snapshot.accountId,
    error: null,
  });
}

async function issueWalletToken(): Promise<void> {
  const identity = await getWalletIdentity();
  const snapshot = await provisionAnonymousWallet(identity);
  updateSnapshot(snapshot, "online");
}

async function initializeWallet(): Promise<void> {
  let cached: WalletSnapshot | null = null;
  try {
    cached = getCachedWallet();
    if (cached) updateSnapshot(cached, "loading");
    await issueWalletToken();
  } catch (error) {
    const retryable = error instanceof WalletApiError && error.retryable;
    if (retryable) {
      try {
        const [token, currentCache] = await Promise.all([
          getCachedToken(),
          Promise.resolve(cached ?? getCachedWallet()),
        ]);
        if (canUseOfflineWallet(token, currentCache)) {
          updateSnapshot(currentCache, "offline");
          return;
        }
      } catch (offlineError) {
        useWalletStore.setState({
          status: "error",
          error:
            offlineError instanceof Error
              ? offlineError.message
              : "Could not load the cached wallet.",
        });
        return;
      }
    }
    useWalletStore.setState({
      status: "error",
      error: error instanceof Error ? error.message : "Could not initialize the wallet.",
    });
  }
}

export const useWalletStore = create<WalletState>((set) => ({
  status: "loading",
  balance: null,
  accountId: null,
  error: null,
  initialize: () => {
    if (!initializePromise) {
      initializePromise = initializeWallet().finally(() => {
        initializePromise = null;
      });
    }
    return initializePromise;
  },
  resetIdentity: async () => {
    set({ status: "loading", error: null });
    try {
      await issueWalletToken();
    } catch (error) {
      set({
        status: "error",
        error: error instanceof Error ? error.message : "Could not reset the wallet identity.",
      });
      throw error;
    }
  },
}));

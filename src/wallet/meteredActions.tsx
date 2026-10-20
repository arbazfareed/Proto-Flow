import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { CircleAlert, Coins, X } from "lucide-react";
import { runMeteredAction, WalletApiError, type MeteredActionType } from "./api";
import { useWalletStore } from "./store";

const CONFIRMATION_KEY_PREFIX = "protoflow.metered.skip-confirmation.";
const TELEMETRY_ENABLED_KEY = "protoflow.metered.telemetry.enabled";
const TELEMETRY_COUNTS_KEY = "protoflow.metered.telemetry.counts";

export const METERED_ACTIONS: Record<MeteredActionType, { name: string; cost: number }> = {
  ai_interaction_generator: { name: "AI interaction generator", cost: 1 },
  cloud_preview_publish: { name: "cloud preview publish", cost: 2 },
  react_tailwind_code_export: { name: "React/Tailwind code export", cost: 3 },
};

type ToastKind = "error" | "success";

interface MeteredToast {
  kind: ToastKind;
  message: string;
}

interface ConfirmationOptions {
  accountId: string;
  actionType: MeteredActionType;
  actionName: string;
  cost: number;
}

interface ConfirmationResult {
  confirmed: boolean;
  telemetryEnabled: boolean;
}

interface PendingConfirmation extends ConfirmationOptions {
  id: number;
  dontAskAgain: boolean;
  telemetryEnabled: boolean;
  resolve: (result: ConfirmationResult) => void;
}

interface MeteredActionContextValue {
  confirm: (options: ConfirmationOptions) => Promise<ConfirmationResult>;
  notify: (message: string, kind?: ToastKind) => void;
  promptForCredits: (required: number) => void;
  recordUsage: (actionType: MeteredActionType) => void;
}

export interface UseMeteredActionOptions {
  skipConfirmation?: boolean;
}

interface MeteredActionProviderProps {
  children: ReactNode;
}

function confirmationKey(accountId: string): string {
  return `${CONFIRMATION_KEY_PREFIX}${encodeURIComponent(accountId)}`;
}

export function confirmationWasSkipped(accountId: string, actionType: MeteredActionType): boolean {
  const stored = localStorage.getItem(confirmationKey(accountId));
  if (stored === null) return false;
  const actions: unknown = JSON.parse(stored);
  if (!Array.isArray(actions) || !actions.every((action) => typeof action === "string")) {
    throw new Error("Saved action confirmation preferences are invalid.");
  }
  return actions.includes(actionType);
}

export function saveConfirmationPreference(accountId: string, actionType: MeteredActionType): void {
  const stored = localStorage.getItem(confirmationKey(accountId));
  const actions: unknown = stored === null ? [] : JSON.parse(stored);
  if (!Array.isArray(actions) || !actions.every((action) => typeof action === "string")) {
    throw new Error("Saved action confirmation preferences are invalid.");
  }
  if (!actions.includes(actionType)) {
    localStorage.setItem(confirmationKey(accountId), JSON.stringify([...actions, actionType]));
  }
}

export function isUsageTelemetryEnabled(): boolean {
  return localStorage.getItem(TELEMETRY_ENABLED_KEY) === "true";
}

export function setUsageTelemetryEnabled(enabled: boolean): void {
  localStorage.setItem(TELEMETRY_ENABLED_KEY, String(enabled));
}

export function recordLocalActionUsage(actionType: MeteredActionType): void {
  if (!isUsageTelemetryEnabled()) return;
  const stored = localStorage.getItem(TELEMETRY_COUNTS_KEY);
  let counts: Partial<Record<MeteredActionType, number>> = {};
  if (stored !== null) {
    const parsed: unknown = JSON.parse(stored);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error("Saved local action usage data is invalid.");
    }
    counts = parsed as Partial<Record<MeteredActionType, number>>;
  }
  const count = counts[actionType] ?? 0;
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new Error("Saved local action usage data is invalid.");
  }
  localStorage.setItem(
    TELEMETRY_COUNTS_KEY,
    JSON.stringify({ ...counts, [actionType]: count + 1 }),
  );
}

function errorMessage(error: unknown): string {
  if (!(error instanceof WalletApiError)) {
    return error instanceof Error ? error.message : "The cloud action could not be completed.";
  }
  switch (error.code) {
    case "INSUFFICIENT_BALANCE":
      return "Your credit balance is too low. Claim daily credits or try again later.";
    case "RATE_LIMITED":
      return error.retryAfterSeconds
        ? `Too many requests. Try again in ${error.retryAfterSeconds} seconds.`
        : "Too many requests. Wait a moment and try again.";
    case "TURNSTILE_REQUIRED":
    case "TURNSTILE_INVALID":
    case "TURNSTILE_UNAVAILABLE":
      return error.message;
    case "ABUSE_REVIEW_REQUIRED":
    case "READ_ONLY":
      return error.message;
    case "RATE_LIMIT_UNAVAILABLE":
      return "Abuse protection is temporarily unavailable. No credits were deducted; try again shortly.";
    case "INVALID_PAYLOAD":
    case "BAD_REQUEST":
      return "The action details are invalid. Review them and try again.";
    case "ACTION_NOT_IMPLEMENTED":
      return "This cloud action is not available yet. No credits were deducted.";
    case "INVALID_TOKEN":
    case "MISSING_TOKEN":
      return "Your wallet session could not be refreshed. Refresh the wallet and try again.";
    case "NETWORK_ERROR":
      return "Cloud actions require an internet connection. No credits were deducted.";
    case "DATABASE_UNAVAILABLE":
    case "INTERNAL_ERROR":
      return "The cloud service is temporarily unavailable. No credits were deducted; try again later.";
    default:
      return "The cloud action failed. No credits were deducted; try again later.";
  }
}

const MeteredActionContext = createContext<MeteredActionContextValue | null>(null);

export function MeteredActionProvider({ children }: MeteredActionProviderProps) {
  const [pendingConfirmation, setPendingConfirmation] = useState<PendingConfirmation | null>(null);
  const [creditPrompt, setCreditPrompt] = useState<number | null>(null);
  const [toast, setToast] = useState<MeteredToast | null>(null);
  const [claiming, setClaiming] = useState(false);
  const confirmationQueue = useRef<PendingConfirmation[]>([]);
  const activeConfirmation = useRef<PendingConfirmation | null>(null);
  const confirmationId = useRef(0);
  const claimDaily = useWalletStore((state) => state.claimDaily);
  const claimable = useWalletStore((state) => state.claimable);
  const walletStatus = useWalletStore((state) => state.status);
  const networkStatus = useWalletStore((state) => state.networkStatus);

  const notify = useCallback((message: string, kind: ToastKind = "error") => {
    setToast({ message, kind });
  }, []);

  const confirm = useCallback((options: ConfirmationOptions) => {
    return new Promise<ConfirmationResult>((resolve) => {
      const confirmation: PendingConfirmation = {
        ...options,
        id: ++confirmationId.current,
        dontAskAgain: false,
        telemetryEnabled: isUsageTelemetryEnabled(),
        resolve,
      };
      if (!activeConfirmation.current) {
        activeConfirmation.current = confirmation;
        setPendingConfirmation(confirmation);
      } else {
        confirmationQueue.current.push(confirmation);
      }
    });
  }, []);

  const finishConfirmation = useCallback((confirmed: boolean) => {
    const current = activeConfirmation.current;
    if (!current) return;

    if (confirmed) {
      try {
        if (current.dontAskAgain) {
          saveConfirmationPreference(current.accountId, current.actionType);
        }
        setUsageTelemetryEnabled(current.telemetryEnabled);
      } catch (error) {
        notify(errorMessage(error));
        current.resolve({ confirmed: false, telemetryEnabled: false });
        activeConfirmation.current = null;
        const next = confirmationQueue.current.shift() ?? null;
        activeConfirmation.current = next;
        setPendingConfirmation(next);
        return;
      }
    }

    current.resolve({
      confirmed,
      telemetryEnabled: current.telemetryEnabled,
    });
    const next = confirmationQueue.current.shift() ?? null;
    activeConfirmation.current = next;
    setPendingConfirmation(next);
  }, [notify]);

  const updateActiveConfirmation = useCallback(
    (update: Partial<Pick<PendingConfirmation, "dontAskAgain" | "telemetryEnabled">>) => {
      const current = activeConfirmation.current;
      if (!current) return;
      const updated = { ...current, ...update };
      activeConfirmation.current = updated;
      setPendingConfirmation(updated);
    },
    [],
  );

  const promptForCredits = useCallback((required: number) => {
    setCreditPrompt(required);
  }, []);

  const recordUsage = useCallback((actionType: MeteredActionType) => {
    try {
      recordLocalActionUsage(actionType);
    } catch (error) {
      notify(`Action succeeded, but local usage telemetry could not be saved: ${errorMessage(error)}`);
    }
  }, [notify]);

  const contextValue = useMemo(
    () => ({ confirm, notify, promptForCredits, recordUsage }),
    [confirm, notify, promptForCredits, recordUsage],
  );

  const submitDailyClaim = async () => {
    setClaiming(true);
    try {
      const success = await claimDaily();
      if (success) {
        setCreditPrompt(null);
        notify("Daily credits claimed. Run the cloud action again when ready.", "success");
      } else if (useWalletStore.getState().error) {
        notify(useWalletStore.getState().error ?? "Daily credits could not be claimed.");
      } else {
        notify("Daily credits are not currently available to claim.");
      }
    } finally {
      setClaiming(false);
    }
  };

  return (
    <MeteredActionContext.Provider value={contextValue}>
      {children}
      {pendingConfirmation && (
        <div
          className="metered-overlay"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) finishConfirmation(false);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") finishConfirmation(false);
          }}
        >
          <section
            className="metered-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="metered-confirmation-title"
          >
            <button
              className="icon-button metered-dialog-close"
              aria-label="Cancel cloud action"
              onClick={() => finishConfirmation(false)}
            >
              <X size={16} />
            </button>
            <div className="dialog-icon"><Coins size={18} /></div>
            <span className="eyebrow">CLOUD ACTION</span>
            <h2 id="metered-confirmation-title">Use {pendingConfirmation.cost} credit{pendingConfirmation.cost === 1 ? "" : "s"}?</h2>
            <p>
              This will use {pendingConfirmation.cost} credit{pendingConfirmation.cost === 1 ? "" : "s"} for {pendingConfirmation.actionName}. Continue?
            </p>
            <label className="metered-option">
              <input
                type="checkbox"
                checked={pendingConfirmation.dontAskAgain}
                onChange={(event) => updateActiveConfirmation({ dontAskAgain: event.target.checked })}
              />
              Don&apos;t ask again for this action
            </label>
            <label className="metered-option">
              <input
                type="checkbox"
                checked={pendingConfirmation.telemetryEnabled}
                onChange={(event) => updateActiveConfirmation({ telemetryEnabled: event.target.checked })}
              />
              Record anonymous action usage locally (opt-in)
            </label>
            <div className="metered-dialog-actions">
              <button className="button button-quiet" onClick={() => finishConfirmation(false)}>Cancel</button>
              <button className="button button-primary" onClick={() => finishConfirmation(true)}>Confirm</button>
            </div>
          </section>
        </div>
      )}
      {creditPrompt !== null && (
        <div
          className="metered-overlay"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setCreditPrompt(null);
          }}
        >
          <section className="metered-dialog" role="dialog" aria-modal="true" aria-labelledby="metered-credit-title">
            <button
              className="icon-button metered-dialog-close"
              aria-label="Close credit prompt"
              onClick={() => setCreditPrompt(null)}
            >
              <X size={16} />
            </button>
            <div className="dialog-icon"><CircleAlert size={18} /></div>
            <span className="eyebrow">CREDITS NEEDED</span>
            <h2 id="metered-credit-title">Not enough credits</h2>
            <p>This action needs {creditPrompt} credits. Claim your daily refill, then run the action again.</p>
            {claimable && walletStatus === "online" && networkStatus === "online" ? (
              <button className="button button-primary metered-claim-button" disabled={claiming} onClick={() => void submitDailyClaim()}>
                {claiming ? "Claiming…" : "Claim Daily +20"}
              </button>
            ) : (
              <p className="metered-credit-note">
                {walletStatus === "offline" || networkStatus === "offline"
                  ? "Reconnect to the internet to claim credits or use cloud actions."
                  : "A daily refill is not currently available. Refresh your wallet to check again."}
              </p>
            )}
            <div className="metered-dialog-actions">
              <button className="button button-quiet" onClick={() => setCreditPrompt(null)}>Close</button>
            </div>
          </section>
        </div>
      )}
      {toast && (
        <div className={`toast metered-toast${toast.kind === "error" ? " toast-error" : ""}`} role={toast.kind === "error" ? "alert" : "status"} aria-live="polite">
          {toast.kind === "error" ? <CircleAlert size={15} /> : <Coins size={15} />}
          <span>{toast.message}</span>
          <button className="icon-button small-icon" aria-label="Dismiss notification" onClick={() => setToast(null)}>
            <X size={13} />
          </button>
        </div>
      )}
    </MeteredActionContext.Provider>
  );
}

export function useMeteredAction<T = unknown>(
  actionType: MeteredActionType,
  payload: Record<string, unknown>,
  options: UseMeteredActionOptions = {},
): { run: () => Promise<T | undefined>; isRunning: boolean; error: string | null } {
  const context = useContext(MeteredActionContext);
  if (!context) {
    throw new Error("useMeteredAction must be used within MeteredActionProvider.");
  }
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async (): Promise<T | undefined> => {
    if (isRunning) return undefined;
    setError(null);

    let requestPayload: Record<string, unknown>;
    try {
      const serializedPayload = JSON.stringify(payload);
      if (
        typeof serializedPayload !== "string" ||
        new TextEncoder().encode(serializedPayload).byteLength > 64 * 1024
      ) {
        throw new Error("The action payload is too large.");
      }
      const normalizedPayload: unknown = JSON.parse(serializedPayload);
      if (typeof normalizedPayload !== "object" || normalizedPayload === null || Array.isArray(normalizedPayload)) {
        throw new Error("The action payload must be a JSON object.");
      }
      requestPayload = normalizedPayload as Record<string, unknown>;
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "The action payload is invalid.";
      setError(message);
      context.notify(message);
      return undefined;
    }

    setIsRunning(true);
    try {
      const definition = METERED_ACTIONS[actionType];
      let wallet = useWalletStore.getState();
      if (
        wallet.status !== "online" ||
        wallet.networkStatus === "offline" ||
        !wallet.jwt ||
        !wallet.accountId
      ) {
        const message =
          wallet.status === "offline" || wallet.networkStatus === "offline"
            ? "Cloud actions require an internet connection. Reconnect and try again."
            : "Your wallet is not synced. Refresh it before using cloud actions.";
        setError(message);
        context.notify(message);
        return undefined;
      }

      if (definition.cost > 0 && wallet.balance < definition.cost) {
        context.promptForCredits(definition.cost);
        return undefined;
      }

      if (
        definition.cost > 0 &&
        !options.skipConfirmation &&
        !confirmationWasSkipped(wallet.accountId, actionType)
      ) {
        const confirmation = await context.confirm({
          accountId: wallet.accountId,
          actionType,
          actionName: definition.name,
          cost: definition.cost,
        });
        if (!confirmation.confirmed) return undefined;
      }

      wallet = useWalletStore.getState();
      if (wallet.status !== "online" || wallet.networkStatus === "offline" || !wallet.jwt) {
        const message = "Cloud actions require an internet connection. No credits were deducted.";
        setError(message);
        context.notify(message);
        return undefined;
      }
      if (definition.cost > 0 && wallet.balance < definition.cost) {
        context.promptForCredits(definition.cost);
        return undefined;
      }

      let response: Awaited<ReturnType<typeof runMeteredAction<T>>>;
      try {
        response = await runMeteredAction<T>(wallet.jwt, actionType, requestPayload);
      } catch (cause) {
        if (
          cause instanceof WalletApiError &&
          ["INVALID_TOKEN", "MISSING_TOKEN"].includes(cause.code ?? "")
        ) {
          await useWalletStore.getState().sync();
          wallet = useWalletStore.getState();
          if (wallet.status === "online" && wallet.networkStatus !== "offline" && wallet.jwt) {
            response = await runMeteredAction<T>(wallet.jwt, actionType, requestPayload);
          } else {
            throw cause;
          }
        } else {
          throw cause;
        }
      }

      if (definition.cost > 0) useWalletStore.getState().optimisticSpend(definition.cost);
      useWalletStore.getState().setWallet(response.wallet, wallet.jwt);
      context.recordUsage(actionType);
      context.notify(`${definition.name} completed.`, "success");
      return response.result;
    } catch (cause) {
      const message = errorMessage(cause);
      setError(message);
      if (cause instanceof WalletApiError && cause.code === "INSUFFICIENT_BALANCE") {
        context.promptForCredits(METERED_ACTIONS[actionType].cost);
      } else {
        context.notify(message);
      }
      return undefined;
    } finally {
      setIsRunning(false);
    }
  }, [actionType, context, isRunning, options.skipConfirmation, payload]);

  return { run, isRunning, error };
}

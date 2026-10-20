import { useState, type FormEvent } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-shell";
import { CircleAlert, Coins, RotateCcw, X } from "lucide-react";
import { useWalletStore } from "../wallet/store";

interface WalletDialogProps {
  onClose: () => void;
}

export function WalletDialog({ onClose }: WalletDialogProps) {
  const status = useWalletStore((state) => state.status);
  const networkStatus = useWalletStore((state) => state.networkStatus);
  const balance = useWalletStore((state) => state.balance);
  const email = useWalletStore((state) => state.email);
  const error = useWalletStore((state) => state.error);
  const resetIdentity = useWalletStore((state) => state.resetIdentity);
  const startEmailSignIn = useWalletStore((state) => state.startEmailSignIn);
  const startGoogleSignIn = useWalletStore((state) => state.startGoogleSignIn);
  const signOut = useWalletStore((state) => state.signOut);
  const [resetting, setResetting] = useState(false);
  const [emailAddress, setEmailAddress] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [authMessage, setAuthMessage] = useState("");
  const [authError, setAuthError] = useState("");

  const callbackUri = (endpoint: "verify" | "google-callback") =>
    isTauri()
      ? `protoflow://auth/${endpoint}`
      : `${window.location.origin}${window.location.pathname}`;

  const requestEmailLink = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setAuthBusy(true);
    setAuthError("");
    setAuthMessage("");
    try {
      await startEmailSignIn(emailAddress, callbackUri("verify"));
      setAuthMessage("Check your inbox for a one-time sign-in link. It expires in 15 minutes.");
    } catch (authFailure) {
      setAuthError(authFailure instanceof Error ? authFailure.message : "Could not send a sign-in link.");
    } finally {
      setAuthBusy(false);
    }
  };

  const signInWithGoogle = async () => {
    setAuthBusy(true);
    setAuthError("");
    setAuthMessage("");
    try {
      const authorizationUrl = await startGoogleSignIn(callbackUri("google-callback"));
      if (isTauri()) {
        await open(authorizationUrl);
        setAuthMessage("Finish signing in through the browser window that opened.");
      } else {
        window.location.assign(authorizationUrl);
      }
    } catch (authFailure) {
      setAuthError(authFailure instanceof Error ? authFailure.message : "Could not start Google sign-in.");
    } finally {
      setAuthBusy(false);
    }
  };

  const signOutAndKeepWallet = async () => {
    setAuthBusy(true);
    setAuthError("");
    setAuthMessage("");
    try {
      await signOut();
      setAuthMessage("Signed out. Your wallet balance remains on this device.");
    } catch (authFailure) {
      setAuthError(authFailure instanceof Error ? authFailure.message : "Could not sign out.");
    } finally {
      setAuthBusy(false);
    }
  };

  const reset = async () => {
    if (
      !window.confirm(
        "Reset this cloud identity? A new install identity and wallet will be created when the cloud is reachable. The current wallet will remain on the server and cannot be restored without sign-in.",
      )
    ) {
      return;
    }
    setResetting(true);
    try {
      await resetIdentity();
    } catch {
      // The wallet store exposes reset failures in the dialog.
    } finally {
      setResetting(false);
    }
  };

  return (
    <div className="overlay" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section
        className="dialog-card wallet-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="wallet-title"
      >
        <button className="icon-button dialog-close" aria-label="Close wallet" onClick={onClose}>
          <X size={17} />
        </button>
        <div className="dialog-icon"><Coins size={19} /></div>
        <span className="eyebrow">WALLET SETTINGS</span>
        <h2 id="wallet-title">
          {balance === null ? "Wallet status" : `${balance} credits`}
        </h2>
        <p>
          {(status === "offline" || networkStatus === "offline") &&
            "Offline grace period: showing your last synced balance. Cloud actions need a connection."}
          {status === "online" && networkStatus !== "offline" && "Wallet synced with the cloud."}
          {status === "loading" && "Connecting to your wallet…"}
          {status === "error" && (error ?? "Could not load wallet details.")}
        </p>
        <p className="wallet-menu-status">
          Cloud connection: {networkStatus === "online" ? "connected" : networkStatus === "offline" ? "unreachable" : "checking"}
        </p>
        {error && status !== "error" && (
          <p className="wallet-dialog-error" role="alert"><CircleAlert size={14} /> {error}</p>
        )}
        {status === "error" && (
          <p className="wallet-privacy-note">
            Connect to the cloud to manage account recovery. You can reset this identity to create a new wallet, but the existing server-side wallet will remain separate.
          </p>
        )}
        <div className="wallet-signin">
          <h3>{email ? "Account linked" : "Sync your wallet across devices"}</h3>
          {email ? (
            <>
              <p className="wallet-signin-email">{email}</p>
              <button className="button button-secondary" onClick={() => void signOutAndKeepWallet()} disabled={authBusy || status !== "online" || networkStatus !== "online"}>
                {authBusy ? "Signing out…" : "Sign out"}
              </button>
            </>
          ) : (
            <>
              <form className="wallet-signin-form" onSubmit={(event) => void requestEmailLink(event)}>
                <label htmlFor="wallet-signin-email">Email address</label>
                <input
                  id="wallet-signin-email"
                  type="email"
                  autoComplete="email"
                  required
                  maxLength={254}
                  value={emailAddress}
                  onChange={(event) => setEmailAddress(event.target.value)}
                  placeholder="you@example.com"
                  disabled={authBusy || status !== "online" || networkStatus !== "online"}
                />
                <button className="button button-primary" type="submit" disabled={authBusy || status !== "online" || networkStatus !== "online"}>
                  {authBusy ? "Sending…" : "Email me a sign-in link"}
                </button>
              </form>
              <button className="button button-secondary wallet-google-button" onClick={() => void signInWithGoogle()} disabled={authBusy || status !== "online" || networkStatus !== "online"}>
                Continue with Google
              </button>
            </>
          )}
          {authMessage && <p className="wallet-signin-message" role="status">{authMessage}</p>}
          {authError && <p className="wallet-dialog-error" role="alert"><CircleAlert size={14} /> {authError}</p>}
        </div>
        <p className="wallet-privacy-note">
          ProtoFlow uses a hashed device ID and random install ID to identify this wallet. Cloudflare also provides an IP address for refill-abuse limits; ProtoFlow stores only a keyed hash of it, not the raw address.
        </p>
        <div className="wallet-dialog-actions">
          <button className="button button-quiet" onClick={onClose}>Close</button>
          <button
            className="button button-secondary"
            onClick={() => void reset()}
            disabled={resetting || status === "loading"}
          >
            <RotateCcw size={14} /> {resetting ? "Resetting…" : "Reset cloud identity"}
          </button>
        </div>
      </section>
    </div>
  );
}

import { useState } from "react";
import { CircleAlert, Coins, RotateCcw, X } from "lucide-react";
import { useWalletStore } from "../wallet/store";

interface WalletDialogProps {
  onClose: () => void;
}

export function WalletDialog({ onClose }: WalletDialogProps) {
  const status = useWalletStore((state) => state.status);
  const balance = useWalletStore((state) => state.balance);
  const error = useWalletStore((state) => state.error);
  const resetIdentity = useWalletStore((state) => state.resetIdentity);
  const [resetting, setResetting] = useState(false);

  const reset = async () => {
    if (
      !window.confirm(
        "Refresh this device's wallet credentials? Your existing account and credit balance will be kept.",
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
          {status === "online" && "Wallet synced with the cloud."}
          {status === "offline" && "Offline grace period: showing your last synced balance. Cloud actions need a connection."}
          {status === "loading" && "Connecting to your wallet…"}
          {status === "error" && (error ?? "Could not load wallet details.")}
        </p>
        {error && status !== "error" && (
          <p className="wallet-dialog-error" role="alert"><CircleAlert size={14} /> {error}</p>
        )}
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
            <RotateCcw size={14} /> {resetting ? "Refreshing…" : "Reset identity"}
          </button>
        </div>
      </section>
    </div>
  );
}

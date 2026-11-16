import { useEffect, useState } from "react";
import { Download, X } from "lucide-react";
import type { Update } from "@tauri-apps/plugin-updater";
import { checkForUpdate } from "../updater/check";
import { installAvailableUpdate } from "../updater/install";
import { trackEvent } from "../diagnostics/observability";

type UpdateToastProps = {
  /** 0 is the automatic check at startup; each "Check for updates" click increases it. */
  requestId: number;
};

/** How long a check result ("up to date" / "check failed") stays before hiding itself. */
export const UPDATE_RESULT_VISIBLE_MS = 6_000;

type CheckResult = "failed" | "up-to-date" | null;

export function UpdateToast({ requestId }: UpdateToastProps) {
  const [update, setUpdate] = useState<Update | null>(null);
  const [installing, setInstalling] = useState(false);
  const [installError, setInstallError] = useState(false);
  const [checkResult, setCheckResult] = useState<CheckResult>(null);
  // Only a check the user asked for reports "failed" or "up to date". The automatic check at
  // startup stays silent unless an update is found, so an offline start shows nothing.
  const userRequested = requestId > 0;

  useEffect(() => {
    let active = true;
    setCheckResult(null);
    void checkForUpdate().then((availableUpdate) => {
      if (active && availableUpdate) setUpdate(availableUpdate);
      else if (availableUpdate) {
        void availableUpdate.close().catch((error) => {
          console.error("Could not release the unused Proto Flow update.", error);
        });
      } else if (active && userRequested) {
        setCheckResult("up-to-date");
      }
    }).catch((error: unknown) => {
      if (active && userRequested) setCheckResult("failed");
      console.error("Could not check for a Proto Flow update.", error);
    });
    return () => {
      active = false;
    };
  }, [requestId, userRequested]);

  useEffect(() => {
    if (!checkResult) return;
    const timer = window.setTimeout(() => setCheckResult(null), UPDATE_RESULT_VISIBLE_MS);
    return () => window.clearTimeout(timer);
  }, [checkResult]);

  const installUpdate = async () => {
    if (!update || installing) return;

    setInstalling(true);
    setInstallError(false);
    try {
      await installAvailableUpdate(update);
      trackEvent("app_updated");
    } catch (error) {
      console.error("Could not install the Proto Flow update.", error);
      setInstallError(true);
      setInstalling(false);
    }
  };

  if (!update) {
    if (!checkResult) return null;
    const failed = checkResult === "failed";
    return (
      <section className="update-toast" role={failed ? "alert" : "status"} aria-live={failed ? "assertive" : "polite"}>
        <button
          className="icon-button update-toast-dismiss"
          aria-label="Dismiss update message"
          onClick={() => setCheckResult(null)}
        >
          <X size={15} />
        </button>
        <strong>{failed ? "Update check failed" : "ProtoFlow is up to date"}</strong>
        <span>
          {failed
            ? "Nothing was changed. Check your internet connection and try again later."
            : "You already have the latest version."}
        </span>
      </section>
    );
  }

  const dismiss = () => {
    setUpdate(null);
    void update.close().catch((error) => {
      console.error("Could not release the dismissed Proto Flow update.", error);
    });
  };

  return (
    <section className="update-toast" role="status" aria-live="polite">
      <button
        className="icon-button update-toast-dismiss"
        aria-label="Dismiss update notification"
        onClick={dismiss}
        disabled={installing}
      >
        <X size={15} />
      </button>
      <strong>Proto Flow {update.version} is available</strong>
      <span>{installing ? "Downloading and installing…" : "A new version is ready to install."}</span>
      {installError && <span className="update-toast-error">Update could not be verified or installed. Please try again.</span>}
      <button className="button button-primary update-toast-install" onClick={() => void installUpdate()} disabled={installing}>
        <Download size={14} />
        {installing ? "Installing…" : "Install update"}
      </button>
    </section>
  );
}

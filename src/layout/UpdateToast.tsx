import { useEffect, useState } from "react";
import { Download, X } from "lucide-react";
import type { Update } from "@tauri-apps/plugin-updater";
import { checkForUpdate } from "../updater/check";
import { installAvailableUpdate } from "../updater/install";
import { trackEvent } from "../diagnostics/observability";

type UpdateToastProps = {
  requestId: number;
};

export function UpdateToast({ requestId }: UpdateToastProps) {
  const [update, setUpdate] = useState<Update | null>(null);
  const [installing, setInstalling] = useState(false);
  const [installError, setInstallError] = useState(false);
  const [checkError, setCheckError] = useState(false);

  useEffect(() => {
    let active = true;
    setCheckError(false);
    void checkForUpdate().then((availableUpdate) => {
      if (active && availableUpdate) setUpdate(availableUpdate);
      else if (availableUpdate) {
        void availableUpdate.close().catch((error) => {
          console.error("Could not release the unused Proto Flow update.", error);
        });
      }
    }).catch((error: unknown) => {
      if (active) setCheckError(true);
      console.error("Could not check for a Proto Flow update.", error);
    });
    return () => {
      active = false;
    };
  }, [requestId]);

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
    if (!checkError) return null;
    return (
      <section className="update-toast" role="alert" aria-live="assertive">
        <strong>Update check failed</strong>
        <span>No update was installed. Check your connection and try again.</span>
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

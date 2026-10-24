import { useEffect, useState } from "react";
import { Bug, Download, ShieldCheck, X } from "lucide-react";
import {
  exportDiagnosticLog,
  PRIVACY_SETTINGS_KEY,
  readPrivacySettings,
  writePrivacySettings,
  type PrivacySettings,
} from "./privacy";
import {
  configureObservability,
  getProviderStatus,
  recordDiagnostic,
} from "./observability";

interface PrivacySettingsDialogProps {
  firstLaunch?: boolean;
  onClose: () => void;
  onSaved?: () => void;
}

const DENIED_BY_DEFAULT: PrivacySettings = {
  crashReports: false,
  anonymousTelemetry: false,
};

export function PrivacySettingsDialog({
  firstLaunch = false,
  onClose,
  onSaved,
}: PrivacySettingsDialogProps) {
  const [settings, setSettings] = useState<PrivacySettings>(DENIED_BY_DEFAULT);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [isError, setIsError] = useState(false);
  const providerStatus = getProviderStatus();

  useEffect(() => {
    try {
      const saved = readPrivacySettings();
      if (saved) setSettings(saved);
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Unknown error.";
      setMessage(`Saved privacy settings could not be loaded: ${detail}`);
      setIsError(true);
    }
  }, []);

  const persistSettings = async (nextSettings: PrivacySettings) => {
    setSaving(true);
    setMessage("");
    setIsError(false);
    let previous: string | null = null;
    let previousCaptured = false;
    try {
      previous = localStorage.getItem(PRIVACY_SETTINGS_KEY);
      previousCaptured = true;
      writePrivacySettings(nextSettings);
      await configureObservability(nextSettings);
      recordDiagnostic("info", "Privacy preferences saved.");
      onSaved?.();
      if (!firstLaunch) onClose();
    } catch (error) {
      let rollbackFailure: string | null = null;
      if (previousCaptured) {
        try {
          if (previous === null) localStorage.removeItem(PRIVACY_SETTINGS_KEY);
          else localStorage.setItem(PRIVACY_SETTINGS_KEY, previous);
        } catch (rollbackError) {
          rollbackFailure = rollbackError instanceof Error
            ? rollbackError.message
            : "unknown rollback error";
        }
      }
      const detail = error instanceof Error ? error.message : "Unknown error.";
      setMessage(`Privacy preferences could not be saved: ${detail}${rollbackFailure ? ` (Settings rollback also failed: ${rollbackFailure})` : ""}`);
      setIsError(true);
    } finally {
      setSaving(false);
    }
  };

  const exportLogs = async () => {
    setMessage("");
    setIsError(false);
    try {
      await exportDiagnosticLog();
      setMessage("Sanitized diagnostic log exported.");
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Unknown error.";
      setMessage(`Diagnostic logs could not be exported: ${detail}`);
      setIsError(true);
    }
  };

  return (
    <div className="overlay privacy-settings-overlay" onMouseDown={(event) => {
      if (!firstLaunch && event.target === event.currentTarget) onClose();
    }}>
      <section
        className="dialog-card privacy-settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="privacy-settings-title"
      >
        {!firstLaunch && (
          <button className="icon-button dialog-close" aria-label="Close privacy settings" onClick={onClose}>
            <X size={17} />
          </button>
        )}
        <div className="dialog-icon"><ShieldCheck size={19} /></div>
        <span className="eyebrow">{firstLaunch ? "YOUR PRIVACY" : "SETTINGS"}</span>
        <h2 id="privacy-settings-title">
          {firstLaunch ? "Choose what you share" : "Privacy & diagnostics"}
        </h2>
        <p>
          Both options are independent and off by default. You can change them here at any time.
          Project content, file paths, project names, emails, and variable values are never included.
        </p>
        <p>
          Cloud wallet, publishing, and collaboration features are optional and send the data needed
          for those features to ProtoFlow’s Cloudflare services. AI actions disclose and send the
          selected prompt and context to the configured AI provider when used.
        </p>

        <label className="privacy-setting-option">
          <input
            type="checkbox"
            checked={settings.crashReports}
            onChange={(event) => setSettings((current) => ({
              ...current,
              crashReports: event.target.checked,
            }))}
          />
          <span>
            <strong><Bug size={14} /> Send sanitized crash reports</strong>
            <small>
              Sends error type, scrubbed message, app/runtime version, aggregate project counts,
              and the last 20 sanitized log lines to the configured GlitchTip-compatible service.
              {providerStatus.crashReporting === "not_configured" &&
                " No crash-report endpoint is configured, so reports remain local."}
            </small>
          </span>
        </label>

        <label className="privacy-setting-option">
          <input
            type="checkbox"
            checked={settings.anonymousTelemetry}
            onChange={(event) => setSettings((current) => ({
              ...current,
              anonymousTelemetry: event.target.checked,
            }))}
          />
          <span>
            <strong><ShieldCheck size={14} /> Send anonymous feature usage</strong>
            <small>
              Sends only allow-listed feature and action types to the configured Umami endpoint.
              No cookies, project content, page paths, or user identifiers are sent.
              {providerStatus.telemetry === "not_configured" &&
                " No telemetry endpoint is configured, so events are not sent."}
            </small>
          </span>
        </label>

        <div className="privacy-local-logs">
          <div>
            <strong>Local diagnostic logs</strong>
            <small>Sanitized logs stay on this device unless you separately enable crash reporting.</small>
          </div>
          <button className="button button-secondary" onClick={() => void exportLogs()}>
            <Download size={14} /> Export logs
          </button>
        </div>
        <a className="wallet-privacy-policy-link" href="/privacy.html">
          Read the privacy policy
        </a>

        {message && <p className={isError ? "privacy-message is-error" : "privacy-message"} role={isError ? "alert" : "status"}>{message}</p>}
        <div className="dialog-actions">
          <button className="button button-quiet" onClick={() => {
            setSettings(DENIED_BY_DEFAULT);
            void persistSettings(DENIED_BY_DEFAULT);
          }} disabled={saving}>
            {firstLaunch ? "Continue with both off" : "Turn both off"}
          </button>
          <button className="button button-primary" onClick={() => void persistSettings(settings)} disabled={saving}>
            {saving ? "Saving…" : "Save choices"}
          </button>
        </div>
      </section>
    </div>
  );
}

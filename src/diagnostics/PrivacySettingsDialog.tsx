import { useEffect, useState } from "react";
import {
  Bug,
  Download,
  Info,
  Keyboard,
  Palette,
  Settings,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
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
import type { ThemePreference } from "../onboarding/storage";
import { APP_VERSION } from "../appVersion";

interface PrivacySettingsDialogProps {
  firstLaunch?: boolean;
  theme: ThemePreference;
  onThemeChange: (theme: ThemePreference) => void;
  onClose: () => void;
  onSaved?: () => void;
  onShowOnboarding?: () => void;
}

type SettingsSection = "general" | "privacy" | "about";

const DENIED_BY_DEFAULT: PrivacySettings = {
  crashReports: false,
  anonymousTelemetry: false,
};

export function PrivacySettingsDialog({
  firstLaunch = false,
  theme,
  onThemeChange,
  onClose,
  onSaved,
  onShowOnboarding,
}: PrivacySettingsDialogProps) {
  const [settings, setSettings] = useState<PrivacySettings>(DENIED_BY_DEFAULT);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [isError, setIsError] = useState(false);
  const [section, setSection] = useState<SettingsSection>("general");
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

  // Escape closes Settings, except on first launch (the privacy choice is required) or while saving.
  useEffect(() => {
    if (firstLaunch) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || saving) return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [firstLaunch, saving, onClose]);

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
      setSettings(nextSettings);
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

  const selectSection = (next: SettingsSection) => {
    setSection(next);
    setMessage("");
    setIsError(false);
  };

  return (
    <div className="overlay privacy-settings-overlay" onMouseDown={(event) => {
      if (!firstLaunch && event.target === event.currentTarget) onClose();
    }}>
      <section
        className={`dialog-card privacy-settings-dialog${firstLaunch ? " is-first-launch" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="privacy-settings-title"
      >
        {!firstLaunch && (
          <button className="icon-button dialog-close" aria-label="Close settings" onClick={onClose}>
            <X size={17} />
          </button>
        )}
        <header className="settings-dialog-header">
          <div className="settings-dialog-icon">{firstLaunch ? <ShieldCheck size={19} /> : <Settings size={19} />}</div>
          <div>
            <span className="eyebrow">{firstLaunch ? "YOUR PRIVACY" : "PREFERENCES"}</span>
            <h2 id="privacy-settings-title">{firstLaunch ? "Choose what you share" : "Settings"}</h2>
            {!firstLaunch && <p>Personalize your workspace and manage how ProtoFlow uses diagnostics.</p>}
          </div>
        </header>

        {!firstLaunch && (
          <nav className="settings-section-nav" aria-label="Settings sections">
            <button type="button" className={section === "general" ? "is-active" : ""} aria-current={section === "general" ? "page" : undefined} onClick={() => selectSection("general")}>
              <Palette size={15} /> General
            </button>
            <button type="button" className={section === "privacy" ? "is-active" : ""} aria-current={section === "privacy" ? "page" : undefined} onClick={() => selectSection("privacy")}>
              <ShieldCheck size={15} /> Privacy
            </button>
            <button type="button" className={section === "about" ? "is-active" : ""} aria-current={section === "about" ? "page" : undefined} onClick={() => selectSection("about")}>
              <Info size={15} /> About
            </button>
          </nav>
        )}

        {(firstLaunch || section === "privacy") && (
          <div className="settings-panel" aria-label="Privacy settings">
            {!firstLaunch && <h3 className="settings-section-title">Privacy &amp; diagnostics</h3>}
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
                onChange={(event) => setSettings((current) => ({ ...current, crashReports: event.target.checked }))}
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
                onChange={(event) => setSettings((current) => ({ ...current, anonymousTelemetry: event.target.checked }))}
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
            <a className="wallet-privacy-policy-link" href="/privacy.html">Read the privacy policy</a>
          </div>
        )}

        {!firstLaunch && section === "general" && (
          <div className="settings-panel" aria-label="General settings">
            <h3 className="settings-section-title">Appearance</h3>
            <label className="privacy-appearance-setting">
              <span>Workspace appearance</span>
              <select
                aria-label="Workspace appearance"
                value={theme}
                onChange={(event) => {
                  const value = event.target.value;
                  if (value === "light" || value === "dark" || value === "system") onThemeChange(value);
                }}
              >
                <option value="light">Light</option>
                <option value="dark">Dark</option>
                <option value="system">System</option>
              </select>
              <small>Changes apply immediately and are saved on this device.</small>
            </label>

            <h3 className="settings-section-title">Getting started</h3>
            <div className="settings-action-row">
              <div>
                <strong><Sparkles size={14} /> Onboarding tour</strong>
                <small>Replay the guided introduction to the workspace and editor.</small>
              </div>
              <button type="button" className="button button-secondary" onClick={onShowOnboarding}>Show again</button>
            </div>

            <h3 className="settings-section-title">Keyboard shortcuts</h3>
            <div className="settings-shortcuts" aria-label="Keyboard shortcuts">
              <div><span>Quick actions</span><kbd>Ctrl / Cmd + K</kbd></div>
              <div><span>Save project</span><kbd>Ctrl / Cmd + S</kbd></div>
              <div><span>Open project</span><kbd>Ctrl / Cmd + O</kbd></div>
              <div><span>Undo</span><kbd>Ctrl / Cmd + Z</kbd></div>
              <div><span>Redo</span><kbd>Ctrl / Cmd + Shift + Z</kbd></div>
            </div>
          </div>
        )}

        {!firstLaunch && section === "about" && (
          <div className="settings-panel settings-about-panel" aria-label="About ProtoFlow">
            <div className="settings-about-mark">PF</div>
            <h3>ProtoFlow</h3>
            <p>Design, prototype, and share interactive experiences.</p>
            <div className="settings-version-row"><span>Version</span><strong>{APP_VERSION}</strong></div>
            <a className="wallet-privacy-policy-link" href="/privacy.html">Privacy policy</a>
            <p className="settings-about-note"><Keyboard size={13} /> Keyboard shortcuts are listed in General settings.</p>
          </div>
        )}

        {message && <p className={isError ? "privacy-message is-error" : "privacy-message"} role={isError ? "alert" : "status"}>{message}</p>}
        <div className="dialog-actions">
          {firstLaunch ? (
            <>
              <button className="button button-quiet" onClick={() => {
                setSettings(DENIED_BY_DEFAULT);
                void persistSettings(DENIED_BY_DEFAULT);
              }} disabled={saving}>Continue with both off</button>
              <button className="button button-primary" onClick={() => void persistSettings(settings)} disabled={saving}>
                {saving ? "Saving…" : "Save choices"}
              </button>
            </>
          ) : section === "privacy" ? (
            <>
              <button className="button button-quiet" onClick={() => {
                setSettings(DENIED_BY_DEFAULT);
                void persistSettings(DENIED_BY_DEFAULT);
              }} disabled={saving}>Turn both off</button>
              <button className="button button-primary" onClick={() => void persistSettings(settings)} disabled={saving}>
                {saving ? "Saving…" : "Save choices"}
              </button>
            </>
          ) : (
            <button className="button button-primary" onClick={onClose}>Done</button>
          )}
        </div>
      </section>
    </div>
  );
}

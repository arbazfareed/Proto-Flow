import { useEffect, useMemo, useState } from "react";
import { Check, Copy, ExternalLink, Link2, Trash2, X } from "lucide-react";
import QRCode from "qrcode";
import { generatePublishedPreviewHtml, publishedBundleSize } from "../preview/publishBundle";
import { useStore } from "../store";
import {
  fetchPublishedPreviews,
  unpublishPreview,
  type PublishedPreview,
} from "../wallet/api";
import { useMeteredAction } from "../wallet/meteredActions";
import { useWalletStore } from "../wallet/store";

function formatSize(bytes: number): string {
  return bytes < 1024 * 1024
    ? `${(bytes / 1024).toFixed(1)} KB`
    : `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function timeRemaining(expiresAt: string, now: number): string {
  const remaining = Date.parse(expiresAt) - now;
  if (remaining <= 0) return "Expired";
  const days = Math.floor(remaining / 86_400_000);
  const hours = Math.floor((remaining % 86_400_000) / 3_600_000);
  const minutes = Math.floor((remaining % 3_600_000) / 60_000);
  return days > 0 ? `${days}d ${hours}h remaining` : `${hours}h ${minutes}m remaining`;
}

export function CloudPreviewDialog({ onClose }: { onClose: () => void }) {
  const project = useStore((state) => state.project);
  const token = useWalletStore((state) => state.jwt);
  const [projectName, setProjectName] = useState(project.name);
  const [history, setHistory] = useState<PublishedPreview[]>([]);
  const [selectedPreview, setSelectedPreview] = useState<PublishedPreview | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [busyPreviewId, setBusyPreviewId] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [message, setMessage] = useState("");
  const [copied, setCopied] = useState(false);
  const bundle = useMemo(() => generatePublishedPreviewHtml(project), [project]);
  const bundleSize = useMemo(() => publishedBundleSize(bundle), [bundle]);
  const payload = useMemo(() => ({ projectName, bundle }), [bundle, projectName]);
  const publisher = useMeteredAction<PublishedPreview>(
    "cloud_preview_publish",
    payload,
    { skipConfirmation: true },
  );
  const balance = useWalletStore((state) => state.balance);

  const refreshHistory = async () => {
    if (!token) return;
    setLoadingHistory(true);
    try {
      const previews = await fetchPublishedPreviews(token);
      setHistory(previews);
      if (selectedPreview) {
        setSelectedPreview(previews.find((item) => item.id === selectedPreview.id) ?? null);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not load published previews.");
    } finally {
      setLoadingHistory(false);
    }
  };

  useEffect(() => {
    void refreshHistory();
    const interval = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(interval);
  }, [token]);

  useEffect(() => {
    if (!selectedPreview) {
      setQrDataUrl("");
      return;
    }
    let cancelled = false;
    void QRCode.toDataURL(selectedPreview.url, {
      errorCorrectionLevel: "M",
      margin: 2,
      width: 192,
      color: { dark: "#17141d", light: "#ffffff" },
    }).then((dataUrl) => {
      if (!cancelled) setQrDataUrl(dataUrl);
    }).catch((error: unknown) => {
      console.error("Could not generate a QR code for the published preview.", error);
      if (!cancelled) setMessage("Could not generate the preview QR code.");
    });
    return () => {
      cancelled = true;
    };
  }, [selectedPreview]);

  const publish = async () => {
    setMessage("");
    const result = await publisher.run();
    if (!result) return;
    setSelectedPreview(result);
    setMessage("Published successfully. Your preview link expires in 30 days.");
    await refreshHistory();
  };

  const copyLink = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setMessage("Preview link copied.");
      window.setTimeout(() => setCopied(false), 1800);
    } catch (error) {
      console.error("Could not copy the published preview URL.", error);
      setMessage("Copy was blocked. Select and copy the preview link instead.");
    }
  };

  const removePreview = async (preview: PublishedPreview) => {
    if (!token || !window.confirm(`Unpublish "${preview.projectName}"? Its public link will stop working.`)) return;
    setBusyPreviewId(preview.id);
    setMessage("");
    try {
      await unpublishPreview(token, preview.id);
      setHistory((current) => current.filter((item) => item.id !== preview.id));
      if (selectedPreview?.id === preview.id) setSelectedPreview(null);
      setMessage("Preview unpublished. Credits are not refunded.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not unpublish this preview.");
    } finally {
      setBusyPreviewId(null);
    }
  };

  return (
    <div className="overlay cloud-preview-overlay" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section
        className="dialog-card cloud-preview-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cloud-preview-title"
      >
        <button className="icon-button dialog-close" aria-label="Close publish dialog" onClick={onClose}>
          <X size={17} />
        </button>
        <div className="dialog-icon"><Link2 size={18} /></div>
        <span className="eyebrow">SHARE A LIVE PROTOTYPE</span>
        <h2 id="cloud-preview-title">Publish to cloud</h2>
        {!selectedPreview && (
          <div className="cloud-preview-publish-form">
            <label htmlFor="cloud-preview-project-name">Project name</label>
            <input
              id="cloud-preview-project-name"
              value={projectName}
              maxLength={120}
              onChange={(event) => setProjectName(event.currentTarget.value)}
            />
            <p className="cloud-preview-summary">
              Standalone HTML · {formatSize(bundleSize)} · Public for 30 days · 2 credits
            </p>
            <button
              className="button button-primary"
              onClick={() => void publish()}
              disabled={
                publisher.isRunning ||
                !projectName.trim() ||
                bundleSize > 10 * 1024 * 1024 ||
                !token
              }
            >
              {publisher.isRunning ? "Publishing…" : "Publish (2 credits)"}
            </button>
            {!token && <p role="alert">Sync your wallet before publishing.</p>}
            {bundleSize > 10 * 1024 * 1024 && <p role="alert">The bundle exceeds the 10 MiB limit.</p>}
          </div>
        )}
        {selectedPreview && (
          <div className="cloud-preview-result">
            <p className="cloud-preview-success"><Check size={15} /> Published · {timeRemaining(selectedPreview.expiresAt, now)}</p>
            <label htmlFor="published-preview-url">Shareable URL</label>
            <div className="cloud-preview-link-row">
              <input id="published-preview-url" readOnly value={selectedPreview.url} onFocus={(event) => event.currentTarget.select()} />
              <button className="button button-secondary" onClick={() => void copyLink(selectedPreview.url)}>
                {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? "Copied" : "Copy"}
              </button>
              <a className="button button-secondary" href={selectedPreview.url} target="_blank" rel="noopener noreferrer">
                <ExternalLink size={14} /> Open
              </a>
            </div>
            {qrDataUrl && <img className="cloud-preview-qr" src={qrDataUrl} alt="QR code for the published preview URL" />}
            <p className="cloud-preview-views">{selectedPreview.viewCount} views · {formatSize(selectedPreview.sizeBytes)}</p>
            <button className="button button-quiet" onClick={() => setSelectedPreview(null)}>Publish another</button>
          </div>
        )}
        {message && <p className="cloud-preview-message" role="status">{message}</p>}
        {publisher.error && <p className="cloud-preview-message" role="alert">{publisher.error}</p>}
        <section className="cloud-preview-history" aria-label="Published preview history">
          <div className="cloud-preview-history-heading">
            <h3>Published previews</h3>
            <button className="button button-quiet" onClick={() => void refreshHistory()} disabled={loadingHistory}>
              {loadingHistory ? "Refreshing…" : "Refresh"}
            </button>
          </div>
          {history.length === 0 && <p>{loadingHistory ? "Loading…" : "No active cloud previews."}</p>}
          {history.map((preview) => (
            <article className="cloud-preview-history-item" key={preview.id}>
              <button className="cloud-preview-history-link" onClick={() => setSelectedPreview(preview)}>
                <strong>{preview.projectName}</strong>
                <span>{timeRemaining(preview.expiresAt, now)} · {preview.viewCount} views</span>
              </button>
              <button
                className="icon-button"
                aria-label={`Unpublish ${preview.projectName}`}
                disabled={busyPreviewId === preview.id}
                onClick={() => void removePreview(preview)}
              >
                <Trash2 size={15} />
              </button>
            </article>
          ))}
        </section>
        <p className="cloud-preview-balance">{balance} credits available</p>
      </section>
    </div>
  );
}

import { useEffect, useState } from "react";
import { Download, X } from "lucide-react";
import {
  fetchAllLedgerEntries,
  fetchLedgerPage,
  type LedgerEntry,
  type LedgerReason,
} from "../wallet/api";

interface WalletHistoryDialogProps {
  token: string;
  onClose: () => void;
}

const REASONS: Array<{ value: LedgerReason; label: string }> = [
  { value: "starter_grant", label: "Starter grant" },
  { value: "daily_refill", label: "Daily refill" },
  { value: "sign_in_bonus", label: "Sign-in bonus" },
  { value: "account_merge_cap", label: "Wallet merge cap" },
  { value: "action:ai_generate", label: "AI generation" },
  { value: "action:cloud_publish", label: "Cloud publish" },
  { value: "action:code_export", label: "Code export" },
  { value: "admin_adjust", label: "Admin adjustment" },
];

function labelForReason(reason: string): string {
  return REASONS.find((item) => item.value === reason)?.label ?? reason.replaceAll("_", " ");
}

function csvCell(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function downloadCsv(entries: LedgerEntry[]): void {
  const rows = [
    ["Timestamp (local)", "Reason", "Delta", "Metadata"],
    ...entries.map((entry) => [
      new Date(entry.createdAt).toLocaleString(),
      entry.reason,
      String(entry.delta),
      JSON.stringify(entry.metadata),
    ]),
  ];
  const csv = rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `protoflow-usage-history-${new Date().toISOString().slice(0, 10)}.csv`;
  anchor.click();
  requestAnimationFrame(() => URL.revokeObjectURL(url));
}

export function WalletHistoryDialog({ token, onClose }: WalletHistoryDialogProps) {
  const [reason, setReason] = useState<LedgerReason | "all">("all");
  const [pageCursors, setPageCursors] = useState<Array<string | null>>([null]);
  const [pageIndex, setPageIndex] = useState(0);
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [exportMessage, setExportMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    void fetchLedgerPage(token, {
      limit: 50,
      cursor: pageCursors[pageIndex],
      reason: reason === "all" ? null : reason,
    }).then((page) => {
      if (!active) return;
      setEntries(page.entries);
      setNextCursor(page.nextCursor);
    }).catch((failure: unknown) => {
      if (active) setError(failure instanceof Error ? failure.message : "Could not load wallet history.");
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [pageCursors, pageIndex, reason, token]);

  const changeReason = (value: LedgerReason | "all") => {
    setReason(value);
    setPageCursors([null]);
    setPageIndex(0);
  };

  const exportCsv = async () => {
    setExporting(true);
    setError("");
    setExportMessage("");
    try {
      downloadCsv(await fetchAllLedgerEntries(token, reason === "all" ? null : reason));
      setExportMessage("CSV export has been downloaded.");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not export wallet history.");
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="overlay wallet-history-overlay" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section
        className="dialog-card wallet-history-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="wallet-history-title"
        onKeyDown={(event) => {
          if (event.key === "Escape") onClose();
        }}
      >
        <button className="icon-button dialog-close" aria-label="Close usage history" onClick={onClose}>
          <X size={17} />
        </button>
        <span className="eyebrow">WALLET ACTIVITY</span>
        <h2 id="wallet-history-title">Full usage history</h2>
        <div className="wallet-history-toolbar">
          <label htmlFor="wallet-history-filter">Filter by reason</label>
          <select
            id="wallet-history-filter"
            value={reason}
            onChange={(event) => changeReason(event.target.value as LedgerReason | "all")}
          >
            <option value="all">All activity</option>
            {REASONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
          <button className="button button-secondary" onClick={() => void exportCsv()} disabled={exporting || loading}>
            <Download size={14} /> {exporting ? "Preparing CSV…" : "Export CSV"}
          </button>
        </div>
        {error && <p className="wallet-dialog-error" role="alert">{error}</p>}
        {exportMessage && <p className="wallet-data-message" role="status">{exportMessage}</p>}
        <div className="wallet-history-table-wrap" aria-live="polite">
          <table className="wallet-history-table">
            <thead>
              <tr><th>When</th><th>Reason</th><th>Change</th></tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={3} className="wallet-history-empty">Loading usage history…</td></tr>
              ) : entries.length === 0 ? (
                <tr><td colSpan={3} className="wallet-history-empty">No matching activity.</td></tr>
              ) : entries.map((entry) => (
                <tr key={entry.id}>
                  <td><time dateTime={entry.createdAt}>{new Date(entry.createdAt).toLocaleString()}</time></td>
                  <td>{labelForReason(entry.reason)}</td>
                  <td className={entry.delta > 0 ? "is-credit" : "is-debit"}>
                    {entry.delta > 0 ? "+" : ""}{entry.delta}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <footer className="wallet-history-footer">
          <span>Page {pageIndex + 1} · {entries.length} entries</span>
          <div>
            <button
              className="button button-quiet"
              onClick={() => setPageIndex((index) => Math.max(0, index - 1))}
              disabled={loading || pageIndex === 0}
            >Previous</button>
            <button
              className="button button-secondary"
              onClick={() => {
                if (!nextCursor) return;
                setPageCursors((cursors) => [...cursors.slice(0, pageIndex + 1), nextCursor]);
                setPageIndex((index) => index + 1);
              }}
              disabled={loading || !nextCursor}
            >Next</button>
          </div>
        </footer>
      </section>
    </div>
  );
}

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  BadgeCheck,
  Ban,
  Check,
  ChevronDown,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  Database,
  Gauge,
  LoaderCircle,
  LockKeyhole,
  LogOut,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Users,
  Wallet,
  X,
} from "lucide-react";
import {
  adjustCredits,
  getAccount,
  getAccounts,
  getAdminIdentity,
  getAudit,
  getFlags,
  getMetrics,
  reissueDailyGrants,
  softBan,
  unflag,
  type AbuseFlag,
  type AdminAccount,
  type AuditEntry,
  type DailyMetric,
} from "./api";

type Section = "overview" | "accounts" | "flags" | "audit";

type AccountDetail = Awaited<ReturnType<typeof getAccount>>;

function money(amount: number): string {
  return new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 3 }).format(amount);
}

function dateTime(value: string | number): string {
  return new Date(value).toLocaleString();
}

function StatCard({ label, value, detail, icon: Icon, tone = "blue" }: {
  label: string; value: string; detail: string; icon: typeof Users; tone?: string;
}) {
  return <article className={`stat-card tone-${tone}`}>
    <div className="stat-icon"><Icon size={18} /></div>
    <span>{label}</span>
    <strong>{value}</strong>
    <small>{detail}</small>
  </article>;
}

function MetricChart({ title, rows, value, color, formatter = String }: {
  title: string; rows: DailyMetric[]; value: (row: DailyMetric) => number; color: string; formatter?: (value: number) => string;
}) {
  const max = Math.max(1, ...rows.map(value));
  const bars = rows.slice(-30);
  return <article className="chart-card">
    <div className="card-title-row"><div><span className="kicker">LAST 30 DAYS</span><h3>{title}</h3></div><span className="chart-legend" style={{ color }}>Daily</span></div>
    <div className="bar-chart" role="img" aria-label={`${title} for the last ${bars.length} days`}>
      {bars.map((row) => {
        const amount = value(row);
        return <div className="bar-column" key={`${title}-${row.day}`} title={`${row.day}: ${formatter(amount)}`}>
          <span className="bar-value">{amount > 0 ? formatter(amount) : ""}</span>
          <div className="bar-track"><div className="bar-fill" style={{ height: `${Math.max(amount > 0 ? 5 : 0, amount / max * 100)}%`, background: color }} /></div>
          <time>{row.day.slice(8)}</time>
        </div>;
      })}
    </div>
  </article>;
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return <div className="empty-state"><div className="empty-icon"><ShieldCheck size={20} /></div><strong>{title}</strong><span>{body}</span></div>;
}

export default function App() {
  const [section, setSection] = useState<Section>("overview");
  const [identity, setIdentity] = useState("");
  const [accessVerified, setAccessVerified] = useState(false);
  const [accounts, setAccounts] = useState<AdminAccount[]>([]);
  const [accountCursor, setAccountCursor] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [detail, setDetail] = useState<AccountDetail | null>(null);
  const [flags, setFlags] = useState<AbuseFlag[]>([]);
  const [selectedFlags, setSelectedFlags] = useState<string[]>([]);
  const [metrics, setMetrics] = useState<DailyMetric[]>([]);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [auditCursor, setAuditCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [adjustDelta, setAdjustDelta] = useState("10");
  const [adjustReason, setAdjustReason] = useState("");
  const [banReason, setBanReason] = useState("");
  const [banHours, setBanHours] = useState("24");

  const loadBase = useCallback(async () => {
    setLoading(true);
    setError("");
    setAccessVerified(false);
    try {
      const me = await getAdminIdentity();
      setIdentity(me.email);
      setAccessVerified(true);
      const [accountPage, flagResult, metricResult, auditPage] = await Promise.all([
        getAccounts(), getFlags(), getMetrics(), getAudit(),
      ]);
      setAccounts(accountPage.accounts);
      setAccountCursor(accountPage.nextCursor);
      setFlags(flagResult.flags);
      setMetrics(metricResult.daily);
      setAudit(auditPage.entries);
      setAuditCursor(auditPage.nextCursor);
      setSelectedId((current) => current || accountPage.accounts[0]?.id || "");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Admin dashboard could not load.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadBase(); }, [loadBase]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    let active = true;
    void getAccount(selectedId).then((value) => {
      if (active) setDetail(value);
    }).catch((failure: unknown) => {
      if (active) setError(failure instanceof Error ? failure.message : "Could not load account details.");
    });
    return () => { active = false; };
  }, [selectedId]);

  const totals = useMemo(() => metrics.reduce((sum, row) => ({
    signups: sum.signups + row.signups,
    aiCalls: sum.aiCalls + row.aiCalls,
    creditsGranted: sum.creditsGranted + row.creditsGranted,
    creditsSpent: sum.creditsSpent + row.creditsSpent,
    estimatedCost: sum.estimatedCost + row.estimatedTotalUsd,
  }), { signups: 0, aiCalls: 0, creditsGranted: 0, creditsSpent: 0, estimatedCost: 0 }), [metrics]);

  const searchAccounts = async (event?: FormEvent) => {
    event?.preventDefault();
    setBusy(true);
    setError("");
    try {
      const page = await getAccounts(search.trim());
      setAccounts(page.accounts);
      setAccountCursor(page.nextCursor);
      setSelectedId(page.accounts[0]?.id ?? "");
      setSection("accounts");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Account search failed.");
    } finally {
      setBusy(false);
    }
  };

  const loadMoreAccounts = async () => {
    if (!accountCursor) return;
    setBusy(true);
    try {
      const page = await getAccounts(search.trim(), accountCursor);
      setAccounts((current) => [...current, ...page.accounts]);
      setAccountCursor(page.nextCursor);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not load more accounts.");
    } finally {
      setBusy(false);
    }
  };

  const refresh = async () => {
    setNotice("");
    await loadBase();
    setNotice("Dashboard refreshed.");
  };

  const submitAdjustment = async (event: FormEvent) => {
    event.preventDefault();
    if (!detail) return;
    const delta = Number(adjustDelta);
    if (!Number.isSafeInteger(delta) || delta === 0 || !adjustReason.trim()) {
      setError("Enter a non-zero whole-credit amount and a reason.");
      return;
    }
    if (!window.confirm(`${delta > 0 ? "Add" : "Subtract"} ${Math.abs(delta)} credits for ${detail.account.id}?`)) return;
    setBusy(true);
    setError("");
    try {
      await adjustCredits(detail.account.id, delta, adjustReason.trim());
      setAdjustReason("");
      setNotice("Credit adjustment recorded and audited.");
      await refresh();
      setDetail(await getAccount(detail.account.id));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Credit adjustment failed.");
    } finally {
      setBusy(false);
    }
  };

  const submitSoftBan = async (event: FormEvent) => {
    event.preventDefault();
    if (!detail || !banReason.trim()) return;
    if (!window.confirm(`Apply a ${banHours}-hour read-only soft-ban to ${detail.account.id}?`)) return;
    setBusy(true);
    try {
      await softBan(detail.account.id, banReason.trim(), Number(banHours));
      setBanReason("");
      setNotice("Temporary read-only flag recorded.");
      const next = await getAccount(detail.account.id);
      setDetail(next);
      const refreshedFlags = await getFlags();
      setFlags(refreshedFlags.flags);
      await getAudit().then((page) => setAudit(page.entries));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Soft-ban could not be applied.");
    } finally {
      setBusy(false);
    }
  };

  const clearSelectedFlags = async () => {
    if (!selectedFlags.length) return;
    setBusy(true);
    try {
      const result = await unflag(selectedFlags);
      setSelectedFlags([]);
      setNotice(`${result.cleared} flag${result.cleared === 1 ? "" : "s"} cleared and audited.`);
      const [flagResult, auditPage] = await Promise.all([getFlags(), getAudit()]);
      setFlags(flagResult.flags);
      setAudit(auditPage.entries);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Flags could not be cleared.");
    } finally {
      setBusy(false);
    }
  };

  const reissueForSelected = async () => {
    const ids = selectedFlags.map((id) => flags.find((flag) => flag.id === id)?.accountId).filter((id): id is string => Boolean(id));
    const uniqueIds = [...new Set(ids)];
    if (!uniqueIds.length) {
      setError("Select account flags before re-issuing a daily refill.");
      return;
    }
    const reason = window.prompt(`Re-issue the daily refill for ${uniqueIds.length} selected account(s). Enter an operational reason:`);
    if (!reason?.trim()) return;
    if (!window.confirm("This credits up to 20 per account and is audited. Continue?")) return;
    setBusy(true);
    try {
      const result = await reissueDailyGrants(uniqueIds, reason.trim());
      setNotice(`Re-issued ${result.reissued} of ${result.requested} requested refills.`);
      await loadBase();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Daily refills could not be re-issued.");
    } finally {
      setBusy(false);
    }
  };

  const loadMoreAudit = async () => {
    if (!auditCursor) return;
    setBusy(true);
    try {
      const page = await getAudit(auditCursor);
      setAudit((current) => [...current, ...page.entries]);
      setAuditCursor(page.nextCursor);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not load more audit events.");
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <div className="boot-screen"><LoaderCircle className="spin" /><span>Verifying Access and loading operations…</span></div>;
  if (!accessVerified) return <main className="access-denied">
    <div className="access-denied-card">
      <div className="access-denied-icon"><LockKeyhole size={22} /></div>
      <span className="kicker">PRIVATE OPERATIONS</span>
      <h1>Admin access required</h1>
      <p>{error || "Sign in through the Cloudflare Access protected admin hostname to continue."}</p>
      <p className="access-denied-note">The Worker verifies the signed Access assertion, application audience, and maintainer email allowlist on every request.</p>
      <button className="primary-button" onClick={() => void loadBase()}><RefreshCw size={14} /> Retry Access check</button>
    </div>
  </main>;

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-symbol">P<span>F</span></div><div><strong>protoflow</strong><small>OPERATIONS</small></div></div>
      <div className="sidebar-caption">CONTROL ROOM</div>
      <nav aria-label="Admin sections">
        <button className={section === "overview" ? "nav active" : "nav"} onClick={() => setSection("overview")}><Gauge size={17} /> Overview</button>
        <button className={section === "accounts" ? "nav active" : "nav"} onClick={() => setSection("accounts")}><Users size={17} /> Accounts</button>
        <button className={section === "flags" ? "nav active" : "nav"} onClick={() => setSection("flags")}><ShieldCheck size={17} /> Flags <span className="nav-count">{flags.length}</span></button>
        <button className={section === "audit" ? "nav active" : "nav"} onClick={() => setSection("audit")}><Activity size={17} /> Audit log</button>
      </nav>
      <div className="sidebar-bottom">
        <div className="access-chip"><span className="online-dot" /> Access verified</div>
        <span className="sidebar-email">{identity}</span>
        <button className="nav logout" onClick={() => { window.location.assign("/cdn-cgi/access/logout"); }}><LogOut size={16} /> Sign out</button>
      </div>
    </aside>

    <main className="main-area">
      <header className="topbar">
        <div><span className="kicker">FREE TIER · OPERATIONS</span><h1>{section === "overview" ? "Overview" : section === "accounts" ? "Accounts" : section === "flags" ? "Abuse flags" : "Audit log"}</h1></div>
        <div className="top-actions">
          <span className="secure-label"><LockKeyhole size={14} /> PRIVATE</span>
          <button className="icon-action" title="Refresh dashboard" onClick={() => void refresh()} disabled={busy}><RefreshCw size={16} className={busy ? "spin" : ""} /></button>
          <div className="avatar">{identity ? identity.slice(0, 1).toUpperCase() : "?"}</div>
        </div>
      </header>
      {(error || notice) && <div className={error ? "notice error" : "notice success"} role={error ? "alert" : "status"}>{error ? <AlertTriangle size={16} /> : <Check size={16} />}{error || notice}<button onClick={() => { setError(""); setNotice(""); }} aria-label="Dismiss notification"><X size={14} /></button></div>}

      {section === "overview" && <>
        <section className="stat-grid">
          <StatCard label="New accounts · 30d" value={totals.signups.toLocaleString()} detail="Active, non-merged accounts" icon={Users} tone="violet" />
          <StatCard label="AI requests · 30d" value={totals.aiCalls.toLocaleString()} detail="Requests currently return unavailable" icon={Sparkles} tone="blue" />
          <StatCard label="Credits granted · 30d" value={totals.creditsGranted.toLocaleString()} detail={`${totals.creditsSpent.toLocaleString()} credits spent`} icon={Wallet} tone="green" />
          <StatCard label="Estimated provider cost" value={money(totals.estimatedCost)} detail="Gemini + R2 + D1 · rough estimate" icon={CircleDollarSign} tone="amber" />
        </section>
        <div className="section-heading"><div><span className="kicker">TREND MONITORING</span><h2>Usage · last 30 days</h2></div><span className="subtle-pill"><Clock3 size={13} /> UTC</span></div>
        <section className="chart-grid">
          <MetricChart title="New signups" rows={metrics} value={(row) => row.signups} color="#9b8cff" />
          <MetricChart title="AI requests" rows={metrics} value={(row) => row.aiCalls} color="#58b6ff" />
          <MetricChart title="Publishes & exports" rows={metrics} value={(row) => row.publishCalls + row.codeExports} color="#32c99a" />
          <MetricChart title="Credit grants" rows={metrics} value={(row) => row.creditsGranted} color="#ffbd68" />
          <MetricChart title="Credit spend" rows={metrics} value={(row) => row.creditsSpent} color="#ff7e8b" />
          <article className="chart-card cost-card">
            <div className="card-title-row"><div><span className="kicker">COST ESTIMATE</span><h3>Daily service cost</h3></div><CircleDollarSign size={18} /></div>
            <div className="cost-stack">{[
              ["Gemini", metrics.reduce((sum, row) => sum + row.estimatedGeminiUsd, 0), "#a18cff"],
              ["R2", metrics.reduce((sum, row) => sum + row.estimatedR2Usd, 0), "#42d6a2"],
              ["D1", metrics.reduce((sum, row) => sum + row.estimatedD1Usd, 0), "#54b8ff"],
            ].map(([name, amount, color]) => <div className="cost-row" key={String(name)}><span><i style={{ background: String(color) }} />{name}</span><strong>{money(Number(amount))}</strong></div>)}</div>
            <p className="cost-footnote">Pricing defaults are rough public estimates. Configure unit rates in Worker vars for your account/region.</p>
          </article>
        </section>
        <div className="section-heading lower-heading"><div><span className="kicker">RECENT OPERATIONS</span><h2>Admin audit</h2></div><button className="text-button" onClick={() => setSection("audit")}>View all <ChevronRight size={14} /></button></div>
        <AuditTable entries={audit.slice(0, 6)} />
      </>}

      {section === "accounts" && <div className="accounts-layout">
        <section className="panel account-list-panel">
          <div className="panel-heading"><div><span className="kicker">ACCOUNT DIRECTORY</span><h2>Wallets</h2></div><span className="count-chip">{accounts.length}{accountCursor ? "+" : ""}</span></div>
          <form className="search-form" onSubmit={(event) => void searchAccounts(event)}>
            <Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search ID, device hash, email…" aria-label="Search accounts" />
            <button type="submit" disabled={busy}>Search</button>
          </form>
          <div className="account-list">
            {accounts.length === 0 ? <EmptyState title="No accounts found" body="Search by account ID, device hash, or linked email." /> : accounts.map((account) => <button className={selectedId === account.id ? "account-row selected" : "account-row"} key={account.id} onClick={() => setSelectedId(account.id)}>
              <span className="account-avatar">{account.email ? account.email.slice(0, 1).toUpperCase() : "A"}</span><span className="account-row-main"><strong>{account.email ?? "Anonymous wallet"}</strong><small>{account.id}</small><small className="hash">{account.deviceIdHash}</small></span><span className="account-row-balance"><strong>{account.balance}</strong><small>credits</small>{account.activeFlagCount > 0 && <i>{account.activeFlagCount} flag</i>}</span>
            </button>)}
          </div>
          {accountCursor && <button className="load-more" onClick={() => void loadMoreAccounts()} disabled={busy}>Load more accounts <ChevronDown size={14} /></button>}
        </section>
        <section className="panel detail-panel">
          {!detail ? <EmptyState title="Select an account" body="Choose a wallet to inspect its balance, ledger, and safety flags." /> : <>
            <div className="detail-header"><div><span className="kicker">ACCOUNT DETAIL</span><h2>{detail.account.email ?? "Anonymous wallet"}</h2><code>{detail.account.id}</code></div><span className="balance-badge"><Wallet size={15} /> {detail.wallet.balance} credits</span></div>
            <div className="identity-line"><span>Device hash</span><code>{detail.account.deviceIdHash}</code></div>
            <div className="identity-line"><span>Created</span><time>{dateTime(detail.account.createdAt)}</time></div>
            <div className="identity-line"><span>Last seen</span><time>{dateTime(detail.account.lastSeenAt)}</time></div>
            <div className="mini-stats"><span>Granted <b>{detail.wallet.lifetimeGranted}</b></span><span>Spent <b>{detail.wallet.lifetimeSpent}</b></span><span>Flags <b>{detail.flags.filter((flag) => !flag.clearedAt).length}</b></span></div>
            <div className="detail-section"><div className="section-title"><h3>Manual credit adjustment</h3><span className="audit-tag"><BadgeCheck size={12} /> audited</span></div>
              <form className="adjust-form" onSubmit={(event) => void submitAdjustment(event)}><label>Delta<input type="number" step="1" min={-10_000} max={10_000} value={adjustDelta} onChange={(event) => setAdjustDelta(event.target.value)} required /></label><label>Reason<input value={adjustReason} onChange={(event) => setAdjustReason(event.target.value)} maxLength={200} placeholder="Support correction" required /></label><button className="primary-button" disabled={busy}><Wallet size={14} /> Apply adjustment</button></form>
              <p className="field-note">Positive adds credits; negative subtracts. Wallet stays between 0 and 100.</p>
            </div>
            <div className="detail-section"><div className="section-title"><h3>Temporary soft-ban</h3><span className="audit-tag"><BadgeCheck size={12} /> audited</span></div>
              <form className="adjust-form ban-form" onSubmit={(event) => void submitSoftBan(event)}><label>Reason<input value={banReason} onChange={(event) => setBanReason(event.target.value)} maxLength={200} placeholder="Abuse review" required /></label><label>Duration<select value={banHours} onChange={(event) => setBanHours(event.target.value)}><option value="1">1 hour</option><option value="24">24 hours</option><option value="168">7 days</option><option value="720">30 days</option></select></label><button className="danger-button" disabled={busy}><Ban size={14} /> Soft-ban</button></form>
            </div>
            <div className="detail-section"><div className="section-title"><h3>Recent ledger</h3><span className="subtle-pill">Last 50</span></div><LedgerTable rows={detail.ledger} /></div>
            <div className="detail-section"><h3>Account flags</h3>{detail.flags.length === 0 ? <p className="muted-line">No flag history.</p> : detail.flags.map((flag) => <div className="flag-line" key={flag.id}><AlertTriangle size={14} /><span>{flag.reason}<small>{flag.mode} · {dateTime(flag.flaggedAt)}</small></span><b className={flag.clearedAt ? "flag-cleared" : "flag-active"}>{flag.clearedAt ? "Cleared" : "Active"}</b></div>)}</div>
          </>}
        </section>
      </div>}

      {section === "flags" && <section className="panel table-panel">
        <div className="panel-heading"><div><span className="kicker">SAFETY CONTROLS</span><h2>Active abuse flags</h2></div><div className="action-group"><button className="secondary-button" disabled={!selectedFlags.length || busy} onClick={() => void reissueForSelected()}><Wallet size={14} /> Re-issue daily refill</button><button className="primary-button" disabled={!selectedFlags.length || busy} onClick={() => void clearSelectedFlags()}><Check size={14} /> Clear selected ({selectedFlags.length})</button></div></div>
        {flags.length === 0 ? <EmptyState title="No active flags" body="New challenge and read-only flags will appear here." /> : <div className="table-scroll"><table><thead><tr><th><input type="checkbox" aria-label="Select all flags" checked={selectedFlags.length === flags.length && flags.length > 0} onChange={(event) => setSelectedFlags(event.target.checked ? flags.map((flag) => flag.id) : [])} /></th><th>Account</th><th>Reason</th><th>Mode</th><th>Flagged</th><th>Expires</th></tr></thead><tbody>{flags.map((flag) => <tr key={flag.id}><td><input type="checkbox" aria-label={`Select flag ${flag.id}`} checked={selectedFlags.includes(flag.id)} onChange={(event) => setSelectedFlags((ids) => event.target.checked ? [...ids, flag.id] : ids.filter((id) => id !== flag.id))} /></td><td><button className="table-link" onClick={() => { if (flag.accountId) { setSelectedId(flag.accountId); setSection("accounts"); } }}>{flag.email ?? flag.accountId ?? "IP-scope flag"}<small>{flag.deviceIdHash ?? flag.scopeKey}</small></button></td><td>{flag.reason}</td><td><span className={flag.mode === "read_only" ? "mode-pill red" : "mode-pill amber"}>{flag.mode.replace("_", " ")}</span></td><td>{dateTime(flag.flaggedAt * 1000)}</td><td>{dateTime(flag.expiresAt * 1000)}</td></tr>)}</tbody></table></div>}
      </section>}

      {section === "audit" && <section className="panel table-panel">
        <div className="panel-heading"><div><span className="kicker">ACCOUNTABILITY</span><h2>Admin action history</h2></div><span className="audit-tag"><Database size={13} /> Append-only records</span></div>
        {audit.length === 0 ? <EmptyState title="No admin actions yet" body="Every credit adjustment, flag change, soft-ban, and refill reissue appears here." /> : <div className="table-scroll"><table><thead><tr><th>When</th><th>Actor</th><th>Action</th><th>Account</th><th>Details</th></tr></thead><tbody>{audit.map((entry) => <tr key={entry.id}><td>{dateTime(entry.createdAt)}</td><td>{entry.actorEmail}</td><td><span className="action-pill">{entry.action.replaceAll("_", " ")}</span></td><td><code>{entry.targetAccountId ?? "—"}</code></td><td><code>{JSON.stringify(entry.details)}</code></td></tr>)}</tbody></table></div>}
        {auditCursor && <button className="load-more" onClick={() => void loadMoreAudit()} disabled={busy}>Load more audit records <ChevronDown size={14} /></button>}
      </section>}

      <footer className="footer-note"><span><ShieldCheck size={14} /> Worker validates Cloudflare Access assertions</span><span>Operational estimates are approximate · no payment data</span></footer>
    </main>
  </div>;
}

function LedgerTable({ rows }: { rows: Array<{ id: string; delta: number; reason: string; createdAt: string; metadata: Record<string, number> }> }) {
  if (!rows.length) return <p className="muted-line">No ledger entries.</p>;
  return <div className="ledger-list">{rows.map((row) => <div className="ledger-row" key={row.id}><span className={row.delta > 0 ? "ledger-plus" : "ledger-minus"}>{row.delta > 0 ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}{row.delta > 0 ? "+" : ""}{row.delta}</span><span>{row.reason.replaceAll("_", " ")}<small>{Object.entries(row.metadata).map(([key, value]) => `${key}: ${value}`).join(" · ") || "No metadata"}</small></span><time>{dateTime(row.createdAt)}</time></div>)}</div>;
}

function AuditTable({ entries }: { entries: AuditEntry[] }) {
  if (!entries.length) return <section className="panel compact-panel"><EmptyState title="No admin actions recorded" body="Audited actions appear here after the first operation." /></section>;
  return <section className="panel compact-panel"><div className="table-scroll"><table><thead><tr><th>Time</th><th>Actor</th><th>Action</th><th>Target</th></tr></thead><tbody>{entries.map((entry) => <tr key={entry.id}><td>{dateTime(entry.createdAt)}</td><td>{entry.actorEmail}</td><td>{entry.action.replaceAll("_", " ")}</td><td><code>{entry.targetAccountId ?? "—"}</code></td></tr>)}</tbody></table></div></section>;
}

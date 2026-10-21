PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY NOT NULL,
  device_fingerprint TEXT NOT NULL UNIQUE,
  install_id TEXT UNIQUE,
  email TEXT,
  google_sub TEXT,
  merged_into TEXT REFERENCES accounts(id),
  deleted_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  last_seen_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;

CREATE TABLE IF NOT EXISTS wallets (
  account_id TEXT PRIMARY KEY NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  balance INTEGER NOT NULL DEFAULT 0 CHECK (balance >= 0),
  lifetime_granted INTEGER NOT NULL DEFAULT 0 CHECK (lifetime_granted >= 0),
  lifetime_spent INTEGER NOT NULL DEFAULT 0 CHECK (lifetime_spent >= 0),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;

CREATE TABLE IF NOT EXISTS ledger (
  id TEXT PRIMARY KEY NOT NULL,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  delta INTEGER NOT NULL CHECK (delta != 0),
  reason TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}'
    CHECK (json_valid(metadata_json) AND json_type(metadata_json) = 'object'),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;

CREATE TABLE IF NOT EXISTS daily_grants (
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  granted_at TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount > 0),
  PRIMARY KEY (account_id, granted_at)
) STRICT;

CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY NOT NULL,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL CHECK (count >= 0)
) STRICT;

CREATE INDEX IF NOT EXISTS ledger_account_created_idx
  ON ledger (account_id, created_at DESC);

CREATE INDEX IF NOT EXISTS accounts_email_idx
  ON accounts (email) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS accounts_deleted_at_idx
  ON accounts (deleted_at) WHERE deleted_at IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS accounts_email_unique_idx
  ON accounts (email COLLATE NOCASE) WHERE email IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS accounts_google_sub_idx
  ON accounts (google_sub) WHERE google_sub IS NOT NULL;

CREATE TABLE IF NOT EXISTS auth_magic_links (
  token_hash TEXT PRIMARY KEY NOT NULL,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  email TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER
) STRICT;

CREATE TABLE IF NOT EXISTS auth_email_rate_limits (
  email_hash TEXT PRIMARY KEY NOT NULL,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL CHECK (count >= 0)
) STRICT;

CREATE TABLE IF NOT EXISTS auth_oauth_states (
  state_hash TEXT PRIMARY KEY NOT NULL,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  device_id TEXT NOT NULL,
  code_verifier TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER
) STRICT;

CREATE TABLE IF NOT EXISTS auth_oauth_tickets (
  ticket_hash TEXT PRIMARY KEY NOT NULL,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  device_id TEXT NOT NULL,
  google_sub TEXT NOT NULL,
  email TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER
) STRICT;

CREATE INDEX IF NOT EXISTS auth_magic_links_expiry_idx ON auth_magic_links (expires_at);
CREATE INDEX IF NOT EXISTS auth_oauth_states_expiry_idx ON auth_oauth_states (expires_at);
CREATE INDEX IF NOT EXISTS auth_oauth_tickets_expiry_idx ON auth_oauth_tickets (expires_at);

CREATE UNIQUE INDEX IF NOT EXISTS ledger_starter_grant_once_idx
  ON ledger (account_id)
  WHERE reason = 'starter_grant';

CREATE TABLE IF NOT EXISTS abuse_flags (
  id TEXT PRIMARY KEY NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('account', 'ip')),
  scope_key TEXT NOT NULL,
  account_id TEXT REFERENCES accounts(id) ON DELETE SET NULL,
  reason TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('challenge', 'read_only')),
  flagged_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  cleared_at INTEGER
) STRICT;

CREATE INDEX IF NOT EXISTS abuse_flags_active_scope_idx
  ON abuse_flags (scope, scope_key, expires_at)
  WHERE cleared_at IS NULL;

CREATE TABLE IF NOT EXISTS abuse_signups (
  account_id TEXT PRIMARY KEY NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  ip_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS abuse_signups_ip_created_idx
  ON abuse_signups (ip_hash, created_at DESC);

CREATE TABLE IF NOT EXISTS admin_audit (
  id TEXT PRIMARY KEY NOT NULL,
  actor_email TEXT NOT NULL,
  action TEXT NOT NULL,
  target_account_id TEXT REFERENCES accounts(id) ON DELETE SET NULL,
  details_json TEXT NOT NULL DEFAULT '{}'
    CHECK (json_valid(details_json) AND json_type(details_json) = 'object'),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;

CREATE INDEX IF NOT EXISTS admin_audit_created_idx ON admin_audit (created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS admin_audit_target_idx ON admin_audit (target_account_id, created_at DESC);

CREATE TABLE IF NOT EXISTS usage_events (
  id TEXT PRIMARY KEY NOT NULL,
  account_id TEXT REFERENCES accounts(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL CHECK (
    event_type IN ('ai_generate', 'cloud_publish', 'code_export', 'collaboration_session')
  ),
  metadata_json TEXT NOT NULL DEFAULT '{}'
    CHECK (json_valid(metadata_json) AND json_type(metadata_json) = 'object'),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;

CREATE INDEX IF NOT EXISTS usage_events_type_created_idx ON usage_events (event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS usage_events_account_created_idx ON usage_events (account_id, created_at DESC);

CREATE TABLE IF NOT EXISTS ai_interaction_feedback (
  id TEXT PRIMARY KEY NOT NULL,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  rule_id TEXT NOT NULL,
  feedback TEXT NOT NULL CHECK (feedback IN ('positive', 'negative')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (account_id, rule_id)
) STRICT;

CREATE INDEX IF NOT EXISTS ai_interaction_feedback_created_idx
  ON ai_interaction_feedback (created_at DESC);

CREATE TABLE IF NOT EXISTS published_previews (
  id TEXT PRIMARY KEY NOT NULL,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  project_name TEXT NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
  view_count INTEGER NOT NULL DEFAULT 0 CHECK (view_count >= 0)
) STRICT;

CREATE INDEX IF NOT EXISTS published_previews_account_created_idx
  ON published_previews (account_id, created_at DESC);

CREATE INDEX IF NOT EXISTS published_previews_expiry_idx
  ON published_previews (expires_at);

CREATE TABLE IF NOT EXISTS collaboration_sessions (
  id TEXT PRIMARY KEY NOT NULL,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  project_name TEXT NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  last_activity_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  view_only INTEGER NOT NULL DEFAULT 0 CHECK (view_only IN (0, 1)),
  ended_at TEXT
) STRICT;

CREATE INDEX IF NOT EXISTS collaboration_sessions_account_created_idx
  ON collaboration_sessions (account_id, created_at DESC);

CREATE INDEX IF NOT EXISTS collaboration_sessions_activity_idx
  ON collaboration_sessions (last_activity_at)
  WHERE ended_at IS NULL;

CREATE TABLE IF NOT EXISTS collaboration_versions (
  id TEXT PRIMARY KEY NOT NULL,
  session_id TEXT NOT NULL REFERENCES collaboration_sessions(id) ON DELETE CASCADE,
  object_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0)
) STRICT;

CREATE INDEX IF NOT EXISTS collaboration_versions_session_created_idx
  ON collaboration_versions (session_id, created_at DESC);

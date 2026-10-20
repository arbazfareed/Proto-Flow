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

CREATE TABLE IF NOT EXISTS wallet_ip_activity (
  ip_hash TEXT NOT NULL,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  last_seen_at TEXT NOT NULL,
  PRIMARY KEY (ip_hash, account_id)
) STRICT;

CREATE INDEX IF NOT EXISTS wallet_ip_activity_seen_idx
  ON wallet_ip_activity (ip_hash, last_seen_at DESC);

CREATE INDEX IF NOT EXISTS wallet_ip_activity_retention_idx
  ON wallet_ip_activity (last_seen_at);

CREATE TABLE IF NOT EXISTS daily_ip_grants (
  ip_hash TEXT PRIMARY KEY NOT NULL,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  granted_at TEXT NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS daily_ip_grants_retention_idx
  ON daily_ip_grants (granted_at);

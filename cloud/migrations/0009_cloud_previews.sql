CREATE TABLE published_previews (
  id TEXT PRIMARY KEY NOT NULL,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  project_name TEXT NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
  view_count INTEGER NOT NULL DEFAULT 0 CHECK (view_count >= 0)
) STRICT;

CREATE INDEX published_previews_account_created_idx
  ON published_previews (account_id, created_at DESC);

CREATE INDEX published_previews_expiry_idx
  ON published_previews (expires_at);

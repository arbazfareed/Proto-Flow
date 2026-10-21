CREATE TABLE collaboration_sessions (
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

CREATE INDEX collaboration_sessions_account_created_idx
  ON collaboration_sessions (account_id, created_at DESC);

CREATE INDEX collaboration_sessions_activity_idx
  ON collaboration_sessions (last_activity_at)
  WHERE ended_at IS NULL;

CREATE TABLE collaboration_versions (
  id TEXT PRIMARY KEY NOT NULL,
  session_id TEXT NOT NULL REFERENCES collaboration_sessions(id) ON DELETE CASCADE,
  object_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0)
) STRICT;

CREATE INDEX collaboration_versions_session_created_idx
  ON collaboration_versions (session_id, created_at DESC);

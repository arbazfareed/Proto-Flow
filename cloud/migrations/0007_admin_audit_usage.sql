CREATE TABLE admin_audit (
  id TEXT PRIMARY KEY NOT NULL,
  actor_email TEXT NOT NULL,
  action TEXT NOT NULL,
  target_account_id TEXT REFERENCES accounts(id) ON DELETE SET NULL,
  details_json TEXT NOT NULL DEFAULT '{}'
    CHECK (json_valid(details_json) AND json_type(details_json) = 'object'),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;

CREATE INDEX admin_audit_created_idx ON admin_audit (created_at DESC, id DESC);
CREATE INDEX admin_audit_target_idx ON admin_audit (target_account_id, created_at DESC);

CREATE TABLE usage_events (
  id TEXT PRIMARY KEY NOT NULL,
  account_id TEXT REFERENCES accounts(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('ai_generate', 'cloud_publish', 'code_export')),
  metadata_json TEXT NOT NULL DEFAULT '{}'
    CHECK (json_valid(metadata_json) AND json_type(metadata_json) = 'object'),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;

CREATE INDEX usage_events_type_created_idx ON usage_events (event_type, created_at DESC);
CREATE INDEX usage_events_account_created_idx ON usage_events (account_id, created_at DESC);

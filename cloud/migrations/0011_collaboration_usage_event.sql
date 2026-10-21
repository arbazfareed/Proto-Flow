CREATE TABLE usage_events_new (
  id TEXT PRIMARY KEY NOT NULL,
  account_id TEXT REFERENCES accounts(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL CHECK (
    event_type IN ('ai_generate', 'cloud_publish', 'code_export', 'collaboration_session')
  ),
  metadata_json TEXT NOT NULL DEFAULT '{}'
    CHECK (json_valid(metadata_json) AND json_type(metadata_json) = 'object'),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;

INSERT INTO usage_events_new (id, account_id, event_type, metadata_json, created_at)
SELECT id, account_id, event_type, metadata_json, created_at
FROM usage_events;

DROP TABLE usage_events;
ALTER TABLE usage_events_new RENAME TO usage_events;

CREATE INDEX usage_events_type_created_idx ON usage_events (event_type, created_at DESC);
CREATE INDEX usage_events_account_created_idx ON usage_events (account_id, created_at DESC);

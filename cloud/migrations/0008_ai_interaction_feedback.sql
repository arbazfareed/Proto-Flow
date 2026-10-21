CREATE TABLE ai_interaction_feedback (
  id TEXT PRIMARY KEY NOT NULL,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  rule_id TEXT NOT NULL,
  feedback TEXT NOT NULL CHECK (feedback IN ('positive', 'negative')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (account_id, rule_id)
) STRICT;

CREATE INDEX ai_interaction_feedback_created_idx
  ON ai_interaction_feedback (created_at DESC);

ALTER TABLE accounts ADD COLUMN deleted_at TEXT;

CREATE INDEX accounts_deleted_at_idx ON accounts (deleted_at)
  WHERE deleted_at IS NOT NULL;

UPDATE ledger SET reason = 'daily_refill' WHERE reason = 'daily_grant';
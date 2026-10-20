ALTER TABLE accounts ADD COLUMN install_id TEXT;

CREATE UNIQUE INDEX accounts_install_id_idx
  ON accounts (install_id)
  WHERE install_id IS NOT NULL;

CREATE UNIQUE INDEX ledger_starter_grant_once_idx
  ON ledger (account_id)
  WHERE reason = 'starter_grant';

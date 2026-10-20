ALTER TABLE accounts ADD COLUMN google_sub TEXT;
ALTER TABLE accounts ADD COLUMN merged_into TEXT REFERENCES accounts(id);

CREATE UNIQUE INDEX accounts_google_sub_idx
  ON accounts (google_sub) WHERE google_sub IS NOT NULL;
CREATE UNIQUE INDEX accounts_email_unique_idx
  ON accounts (email COLLATE NOCASE) WHERE email IS NOT NULL;

CREATE TABLE auth_magic_links (
  token_hash TEXT PRIMARY KEY NOT NULL,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  email TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER
) STRICT;

CREATE TABLE auth_email_rate_limits (
  email_hash TEXT PRIMARY KEY NOT NULL,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL CHECK (count >= 0)
) STRICT;

CREATE TABLE auth_oauth_states (
  state_hash TEXT PRIMARY KEY NOT NULL,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  device_id TEXT NOT NULL,
  code_verifier TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER
) STRICT;

CREATE TABLE auth_oauth_tickets (
  ticket_hash TEXT PRIMARY KEY NOT NULL,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  device_id TEXT NOT NULL,
  google_sub TEXT NOT NULL,
  email TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER
) STRICT;

CREATE INDEX auth_magic_links_expiry_idx ON auth_magic_links (expires_at);
CREATE INDEX auth_oauth_states_expiry_idx ON auth_oauth_states (expires_at);
CREATE INDEX auth_oauth_tickets_expiry_idx ON auth_oauth_tickets (expires_at);

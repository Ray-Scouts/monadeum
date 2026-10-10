-- Durable stores for the wallets, auth, trading, x402, and tick modules (ARCHITECTURE.md section 10, database layer).
--
-- Rules for this schema:
-- - No private key, session key, or plaintext session token is ever stored here (SECURITY.md section 11).
-- - Every uniqueness and at-most-once guarantee a store interface documents is a constraint here, not only
--   application code: a primary key or unique index for each insert-if-absent key, and CHECK constraints for the
--   value shapes the stores rely on.
-- - A record whose shape is owned by its module (nested attempts, receipts, fills) is kept whole in `body`, encoded
--   by `@monadeum/db` with bigints tagged so they round-trip exactly. Every column a constraint or a lookup needs is
--   written in the same statement as `body`, so the two cannot diverge.
-- - A migration that has been applied is never edited; the runner refuses to start when its checksum changes.

-- WalletsModule: one row per agent account.
CREATE TABLE wallet_accounts (
  agent_id     text PRIMARY KEY,
  -- Lowercased account address: an account belongs to at most one agent, compared case-insensitively.
  account_key  text NOT NULL UNIQUE CHECK (account_key ~ '^0x[0-9a-f]{40}$'),
  body         jsonb NOT NULL
);

-- WalletsModule: per-tick operation records, written before the operation is submitted (at-most-once per tick).
CREATE TABLE wallet_tick_operations (
  agent_id     text NOT NULL,
  tick_key     text NOT NULL,
  -- Claim order, which `listOperations` returns.
  seq          bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  body         jsonb NOT NULL,
  PRIMARY KEY (agent_id, tick_key)
);

-- WalletsModule: per-agent paymaster sponsorship usage. Reservations are single conditional statements.
CREATE TABLE wallet_sponsorship (
  agent_id     text PRIMARY KEY,
  operations   integer NOT NULL,
  -- Settled gas plus open reservations, in wei. numeric(78, 0) holds any uint256.
  gas_wei      numeric(78, 0) NOT NULL
);

-- AuthModule: one row per person. A Privy identity belongs to at most one user.
CREATE TABLE auth_users (
  id              text PRIMARY KEY,
  privy_user_id   text UNIQUE,
  -- The one owner wallet. Set once; the store refuses to change it once set.
  owner_wallet    text CHECK (owner_wallet ~* '^0x[0-9a-f]{40}$'),
  created_at      bigint NOT NULL
);

-- AuthModule: linked wallets. The primary key on the lowercased address is what makes a wallet belong to at most one
-- user, across concurrent requests.
CREATE TABLE auth_user_wallets (
  address_key  text PRIMARY KEY CHECK (address_key ~ '^0x[0-9a-f]{40}$'),
  user_id      text NOT NULL REFERENCES auth_users (id) ON DELETE CASCADE,
  -- Position in the user's wallet list, so the list round-trips in order.
  position     integer NOT NULL,
  address      text NOT NULL CHECK (lower(address) = address_key),
  kind         text NOT NULL CHECK (kind IN ('embedded', 'external')),
  proof        text NOT NULL CHECK (proof IN ('privy-identity-token', 'wallet-signature')),
  linked_at    bigint NOT NULL,
  UNIQUE (user_id, position)
);

-- AuthModule: one-time EIP-4361 challenges. Consumed with DELETE ... RETURNING, so each is returned at most once.
CREATE TABLE auth_challenges (
  nonce        text PRIMARY KEY,
  message      text NOT NULL,
  address      text NOT NULL,
  purpose      text NOT NULL CHECK (purpose IN ('sign-in', 'link')),
  user_id      text,
  expires_at   bigint NOT NULL
);

-- AuthModule: external-wallet sessions. Only the SHA-256 of the bearer token is stored; the CHECK rejects anything
-- that is not a lowercase 32-byte hex digest, so a plaintext token cannot be written by mistake.
CREATE TABLE auth_sessions (
  token_hash   text PRIMARY KEY CHECK (token_hash ~ '^0x[0-9a-f]{64}$'),
  user_id      text NOT NULL,
  wallet       text NOT NULL,
  expires_at   bigint NOT NULL
);

-- TradingModule: one trade record per tick key, claimed before the signer is called.
CREATE TABLE trade_records (
  key          text PRIMARY KEY,
  seq          bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  status       text NOT NULL CHECK (status IN ('claimed', 'submitted', 'filled', 'failed', 'needs-review')),
  -- Lowercased fill transaction hash, for attributing router swaps to records.
  tx_hash_key  text,
  body         jsonb NOT NULL
);
CREATE INDEX trade_records_tx_hash_key ON trade_records (tx_hash_key) WHERE tx_hash_key IS NOT NULL;

-- X402Module: one payment log entry per purchase key, claimed before the payer is called.
CREATE TABLE x402_payments (
  key             text PRIMARY KEY,
  seq             bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  settlement_ref  text,
  body            jsonb NOT NULL
);
CREATE INDEX x402_payments_settlement_ref ON x402_payments (settlement_ref) WHERE settlement_ref IS NOT NULL;

-- Tick loop: one record per (agent ID, tick) key, claimed before the tick runs. The approval is written here before the
-- approved plan is submitted, so a restarted tick resumes it instead of deciding again.
CREATE TABLE tick_records (
  key       text PRIMARY KEY,
  agent_id  text NOT NULL,
  tick      bigint NOT NULL,
  status    text NOT NULL CHECK (status IN ('started', 'approved', 'recorded')),
  body      jsonb NOT NULL
);

-- The relayed funding transfer (ARCHITECTURE.md sections 6.1 and 7): EIP-3009 authorizations the API prepares for an
-- owner to sign, moving USDC from the owner wallet on record to the agent's deployed account, and their submission by
-- the platform relayer.
--
-- One row per authorization nonce, which is random and 32 bytes, and which the token accepts once per `from`:
-- - the primary key makes a nonce prepared once, so a replayed submission finds the row it already claimed;
-- - `status` moves forward only: prepared, then submitted with the signature and the relayer's transaction hash written
--   in the same statement that claims the user's daily relay budget, then confirmed or failed;
-- - `submitted_at` is what the per-user daily budget counts, whatever the outcome, because every relayed transaction
--   costs the relayer gas.
-- The authorization's fields are columns, not only a body, so the signature is always verified against what the API
-- stored, never against what a client sends back.

CREATE TABLE api_funding_authorizations (
  nonce         char(66) PRIMARY KEY CHECK (nonce ~ '^0x[0-9a-f]{64}$'),
  agent_id      text NOT NULL,
  user_id       text NOT NULL,
  owner_key     text NOT NULL CHECK (owner_key ~ '^0x[0-9a-f]{40}$'),
  account_key   text NOT NULL CHECK (account_key ~ '^0x[0-9a-f]{40}$'),
  asset_key     text NOT NULL CHECK (asset_key ~ '^0x[0-9a-f]{40}$'),
  value         numeric(78, 0) NOT NULL CHECK (value > 0),
  valid_after   bigint NOT NULL CHECK (valid_after >= 0),
  valid_before  bigint NOT NULL CHECK (valid_before > valid_after),
  created_at    bigint NOT NULL,
  status        text NOT NULL CHECK (status IN ('prepared', 'submitted', 'confirmed', 'failed')),
  signature     text CHECK (signature ~ '^0x[0-9a-f]{130}$'),
  tx_hash       char(66) CHECK (tx_hash ~ '^0x[0-9a-f]{64}$'),
  submitted_at  bigint,
  block_number  numeric(78, 0),
  error         text,
  CHECK ((status = 'prepared') = (submitted_at IS NULL)),
  CHECK (status = 'prepared' OR (signature IS NOT NULL AND tx_hash IS NOT NULL))
);
CREATE INDEX api_funding_authorizations_user_submitted ON api_funding_authorizations (user_id, submitted_at);
CREATE INDEX api_funding_authorizations_agent ON api_funding_authorizations (agent_id, created_at);

REVOKE ALL ON api_funding_authorizations FROM PUBLIC;

-- Only the API prepares, claims, and settles authorizations. No role may delete one: the record of what the relayer
-- submitted, and what each user's budget counted, is kept.
GRANT SELECT, INSERT, UPDATE ON api_funding_authorizations TO monadeum_api;

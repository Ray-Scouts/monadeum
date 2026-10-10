-- The API process (apps/api, ARCHITECTURE.md section 10): its own tables and the grants of its role.
--
-- The API connects through a login role that is a member of `monadeum_api` and of `monadeum_reader`, and runs every
-- statement under one of the two with SET LOCAL ROLE: its own stores as `monadeum_api`, the indexer read-model as
-- `monadeum_reader`. `monadeum_api` therefore has no privilege on the read-model, and `monadeum_reader` gets none on the
-- auth tables or the tables below; its read access to the module store tables is 0005's and is not changed here.
-- 0005 already revoked PUBLIC on the auth and wallet tables and left the auth tables to this role. Roles are
-- cluster-wide, so the role is created only if absent (CREATEROLE needed, as in 0004).

-- AgentsModule's creation record: the owner wallet, account index, name, and requested limits of an agent the API
-- created and deployed. Ownership checks read this, never a request field. The worker's `worker_agents` (0006) is the
-- record of an agent ready to trade, and needs a genome, which the API does not yet collect; so the API does not
-- create worker agents yet and holds no INSERT on `worker_agents`. It reads that table only to refuse a request when the
-- two records name different owners. The INSERT grant comes with the creation flow that writes a genome.
CREATE TABLE api_agents (
  agent_id     text PRIMARY KEY,
  owner_key    text NOT NULL CHECK (owner_key ~ '^0x[0-9a-f]{40}$'),
  agent_index  numeric(78, 0) NOT NULL CHECK (agent_index >= 0),
  -- Identity registry token ID (section 9), null until the registry is deployed.
  registry_id  numeric(78, 0) UNIQUE,
  created_at   bigint NOT NULL,
  body         jsonb NOT NULL,
  UNIQUE (owner_key, agent_index)
);

-- Revocations a root wallet started, the input of the bulk recovery hold (SECURITY.md section 9). Append-only.
CREATE TABLE api_recovery_actions (
  owner_key    text NOT NULL CHECK (owner_key ~ '^0x[0-9a-f]{40}$'),
  agent_id     text NOT NULL,
  at           bigint NOT NULL
);
CREATE INDEX api_recovery_actions_owner_at ON api_recovery_actions (owner_key, at);

-- Held recovery requests, until confirmed, delayed, and released.
CREATE TABLE api_recovery_holds (
  id           text PRIMARY KEY,
  owner_key    text NOT NULL CHECK (owner_key ~ '^0x[0-9a-f]{40}$'),
  user_id      text NOT NULL,
  released     boolean NOT NULL,
  body         jsonb NOT NULL
);

-- Owner-signed reallocation policies (EVOLUTION.md section 3.1 item 8). Append-only: one row per (owner, sequence).
CREATE TABLE api_reallocation_policies (
  owner_key    text NOT NULL CHECK (owner_key ~ '^0x[0-9a-f]{40}$'),
  sequence     integer NOT NULL CHECK (sequence >= 0),
  policy_hash  char(66) NOT NULL CHECK (policy_hash ~ '^0x[0-9a-f]{64}$'),
  signature    text NOT NULL CHECK (signature ~ '^0x[0-9a-fA-F]+$'),
  document     jsonb NOT NULL,
  created_at   bigint NOT NULL,
  PRIMARY KEY (owner_key, sequence)
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'monadeum_api') THEN
    CREATE ROLE monadeum_api NOLOGIN;
  END IF;
  EXECUTE format('GRANT USAGE ON SCHEMA %I TO monadeum_api', current_schema());
END $$;

REVOKE ALL ON api_agents, api_recovery_actions, api_recovery_holds, api_reallocation_policies FROM PUBLIC;

-- The migration ledger, so the API can verify the schema it expects without applying it (`verifyMigrations`).
GRANT SELECT ON store_schema_migrations TO monadeum_api;

-- AuthModule's stores: the API is their only user.
GRANT SELECT, INSERT, UPDATE, DELETE ON auth_users, auth_user_wallets, auth_challenges, auth_sessions TO monadeum_api;

-- WalletsModule, for deployment and revocation only: account records and the sponsorship ledger. No grant on the
-- per-tick operation records, which only the worker's session-key execution writes; none is DELETE.
GRANT SELECT, INSERT, UPDATE ON wallet_accounts, wallet_sponsorship TO monadeum_api;

-- The API's own tables. Recovery actions and signed policies are append-only for this role.
GRANT SELECT, INSERT ON api_agents, api_recovery_actions, api_reallocation_policies TO monadeum_api;
GRANT SELECT, INSERT, UPDATE ON api_recovery_holds TO monadeum_api;

-- The worker's agent registry, read only: the ownership cross-check above.
GRANT SELECT ON worker_agents TO monadeum_api;

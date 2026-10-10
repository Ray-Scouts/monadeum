-- Database roles for the two writer rules the architecture states as grants (ARCHITECTURE.md sections 10 and 16.1):
-- - the indexer is the only writer of the chain-sourced read-model; every other service reads it;
-- - policy documents are append-only, only a separate operator role may INSERT them, the worker may only SELECT them,
--   and the role that writes genomes has no grant on them at all.
--
-- The roles are group roles without LOGIN. A deployment grants membership in one of them to each process's login
-- role; no process connects as the table owner. Roles are cluster-wide, so they are created only if absent, which
-- requires the migrating role to have CREATEROLE (or the roles to exist beforehand). Grants on the module store tables
-- from 0001 are not set here; they follow when the API and worker processes are wired to the database.

DO $$
DECLARE
  r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['monadeum_indexer', 'monadeum_reader', 'monadeum_worker', 'monadeum_policy_operator'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('CREATE ROLE %I NOLOGIN', r);
    END IF;
    EXECUTE format('GRANT USAGE ON SCHEMA %I TO %I', current_schema(), r);
  END LOOP;
END $$;

-- Read-model: the indexer writes, readers read. Nothing else has any privilege beyond the owner.
REVOKE ALL ON indexer_cursor, indexer_blocks, indexer_tracked_accounts, chain_events FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON indexer_cursor, indexer_blocks, indexer_tracked_accounts, chain_events TO monadeum_indexer;
GRANT SELECT ON indexer_cursor, indexer_tracked_accounts, chain_events, agent_account_deployments, agent_spend_limits,
  agent_spend_allowlist, agent_spends, agent_session_permissions TO monadeum_reader;

-- Policy documents: the operator appends, the worker reads. No role is granted UPDATE, DELETE, or TRUNCATE, and the
-- trigger from 0003 rejects them even for the owner.
REVOKE ALL ON risk_policy_versions FROM PUBLIC;
GRANT INSERT ON risk_policy_versions TO monadeum_policy_operator;
GRANT SELECT ON risk_policy_versions TO monadeum_worker;

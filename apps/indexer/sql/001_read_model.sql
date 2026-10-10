-- Chain-sourced read-model written by apps/indexer.
--
-- Status: schema only. No Postgres store implements ReadModelStore yet, and no migration runner applies this file;
-- the indexer runs on InMemoryReadModelStore until one does. The tables mirror that store one to one, so the Postgres
-- store is a translation of its methods: apply() is one transaction over the four tables, rollback() is one
-- transaction of DELETE ... WHERE block_number > $ancestor plus the cursor update.
--
-- Writer rule (ARCHITECTURE.md section 10): the indexer is the only writer of these tables. Every other service reads.
-- The grants at the end enforce that when the two roles exist.

CREATE TABLE indexer_cursor (
  id           smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  block_number numeric(78, 0) NOT NULL,
  block_hash   char(66) NOT NULL
);

-- Hashes of recent blocks, for reorg detection: the last block of each batch and every block that produced a row.
CREATE TABLE indexer_blocks (
  block_number numeric(78, 0) PRIMARY KEY,
  block_hash   char(66) NOT NULL
);

-- Accounts the indexer follows. Joining this set is permissionless (any address can call setLimits on the spend
-- policy), so presence here is a chain fact, never proof that the platform created the account.
CREATE TABLE indexer_tracked_accounts (
  account     char(42) PRIMARY KEY,
  first_block numeric(78, 0) NOT NULL
);

-- One row per decoded log and handler. `kind` is declared by exactly one handler; `data` holds integers as decimal
-- strings so uint256 values keep full precision.
CREATE TABLE chain_events (
  block_number numeric(78, 0) NOT NULL,
  block_hash   char(66) NOT NULL,
  log_index    integer NOT NULL,
  kind         text NOT NULL,
  account      char(42),
  address      char(42) NOT NULL,
  tx_hash      char(66) NOT NULL,
  data         jsonb NOT NULL,
  PRIMARY KEY (block_number, log_index, kind)
);

CREATE INDEX chain_events_account_kind ON chain_events (account, kind, block_number, log_index);
CREATE INDEX chain_events_kind ON chain_events (kind, block_number, log_index);

-- Projections for the dashboard and API. Views, not tables, so a rollback never leaves a stale derived row.

CREATE VIEW agent_account_deployments AS
SELECT account, data->>'factory' AS factory, data->>'paymaster' AS paymaster, tx_hash, block_number
FROM chain_events WHERE kind = 'account.deployed';

CREATE VIEW agent_spend_limits AS
SELECT DISTINCT ON (account)
  account, (data->>'perTxCap')::numeric AS per_tx_cap, (data->>'dailyCap')::numeric AS daily_cap, block_number
FROM chain_events WHERE kind = 'spend.limits-set'
ORDER BY account, block_number DESC, log_index DESC;

CREATE VIEW agent_spend_allowlist AS
SELECT account, target, selector FROM (
  SELECT DISTINCT ON (account, data->>'target', data->>'selector')
    account, data->>'target' AS target, data->>'selector' AS selector, (data->>'allowed')::boolean AS allowed
  FROM chain_events WHERE kind = 'spend.call-allowed'
  ORDER BY account, data->>'target', data->>'selector', block_number DESC, log_index DESC
) latest WHERE allowed;

-- windowTotal is the rolling 24-hour total at the event, not now; the contract's windowTotal() is the current value.
CREATE VIEW agent_spends AS
SELECT account, (data->>'amount')::numeric AS amount, (data->>'windowTotal')::numeric AS window_total, tx_hash, block_number, log_index
FROM chain_events WHERE kind = 'spend.spent';

CREATE VIEW agent_session_permissions AS
SELECT i.account, i.data->>'permissionId' AS permission_id, (i.data->>'nonce')::integer AS installed_nonce, i.block_number AS installed_block,
  EXISTS (
    SELECT 1 FROM chain_events u
    WHERE u.kind = 'kernel.permission-uninstalled' AND u.account = i.account AND u.data->>'permissionId' = i.data->>'permissionId'
      AND (u.block_number, u.log_index) > (i.block_number, i.log_index)
  ) AS uninstalled
FROM chain_events i WHERE i.kind = 'kernel.permission-installed';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'monadeum_indexer') AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'monadeum_reader') THEN
    REVOKE ALL ON indexer_cursor, indexer_blocks, indexer_tracked_accounts, chain_events FROM PUBLIC;
    GRANT SELECT, INSERT, UPDATE, DELETE ON indexer_cursor, indexer_blocks, indexer_tracked_accounts, chain_events TO monadeum_indexer;
    GRANT SELECT ON indexer_cursor, indexer_tracked_accounts, chain_events, agent_account_deployments, agent_spend_limits,
      agent_spend_allowlist, agent_spends, agent_session_permissions TO monadeum_reader;
  END IF;
END $$;

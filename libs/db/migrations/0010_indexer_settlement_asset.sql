-- The settlement asset the indexer's funding rows come from (ARCHITECTURE.md sections 10 and 11).
--
-- The indexer stores Transfer events of one configured USDC contract (INDEXER_SETTLEMENT_ASSET_ADDRESS), and the
-- worker counts only rows of the contract it is configured with (WORKER_SETTLEMENT_ASSET_ADDRESS). If the two differ,
-- no row counts and no agent is ever funded, silently. The indexer records its address here at start, and the worker
-- reads it at start and refuses to run on a mismatch.
--
-- One row, written once. The indexer may insert it and read it, never change or delete it: a different asset over
-- the same rows would mix two tokens, so changing the asset means rebuilding the read-model, an operator step.

CREATE TABLE indexer_settings (
  id               smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  settlement_asset char(42) NOT NULL CHECK (settlement_asset ~ '^0x[0-9a-f]{40}$')
);

REVOKE ALL ON indexer_settings FROM PUBLIC;
GRANT SELECT, INSERT ON indexer_settings TO monadeum_indexer;
GRANT SELECT ON indexer_settings TO monadeum_worker, monadeum_reader;

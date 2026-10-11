-- Funding and principal (EVOLUTION.md section 1.1, ARCHITECTURE.md sections 6.1 and 10).
--
-- The indexer stores the settlement asset's Transfer events that touch a followed account as `chain_events` rows of
-- kind `settlement.transfer-in` and `settlement.transfer-out` (no schema change: rows are decoded events). The worker
-- recomputes each agent's principal from those rows and writes it to `worker_agents`, which it may already UPDATE
-- (0006). Two changes follow.
--
-- 1. The cursor records whether every stored row was read from finalized blocks. The indexer sets it per batch; the
--    store keeps the conjunction since the read-model was empty, so a read-model filled even once under the
--    confirmations rule never claims to be finalized. A rollback leaves it as it was.
-- 2. The worker may read the read-model, and only read it: the cursor (for the finalized bound) and the rows. It still
--    has no write on any read-model table, and the indexer still has no access to worker_agents.

ALTER TABLE indexer_cursor ADD COLUMN finalized boolean NOT NULL DEFAULT false;

GRANT SELECT ON indexer_cursor, chain_events TO monadeum_worker;

-- Funding transfers as the dashboard reads them. A view, like the other projections in 0002, so a rollback never
-- leaves a stale derived row. Principal itself is the worker's write, not a view: it depends on the owner on record.
CREATE VIEW agent_settlement_transfers AS
SELECT account, kind, address AS asset, data->>'from' AS sender, data->>'to' AS recipient, (data->>'value')::numeric AS value,
  tx_hash, block_number, log_index
FROM chain_events WHERE kind IN ('settlement.transfer-in', 'settlement.transfer-out');

GRANT SELECT ON agent_settlement_transfers TO monadeum_reader;

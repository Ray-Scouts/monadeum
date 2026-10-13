-- Optional contracts the indexer reads, by name (ARCHITECTURE.md section 10, indexer entry).
--
-- The first is the reallocation contract (`reallocation`, INDEXER_REALLOCATION_ADDRESS): its `Reallocated`,
-- registration, principal, retirement, policy, and evaluation events. The API reports reallocations as indexed only when
-- the address recorded here is the reallocation contract it is configured with, so an empty list it serves means that
-- nothing moved, not that nothing was read.
--
-- A row is written once, at the indexer's start, and only into a read-model with no cursor yet: blocks already synced
-- were read without the contract, so adding it later would claim rows the read-model does not have. Adding or changing
-- a contract means rebuilding the read-model, an operator step. The indexer may insert and read rows, never change or
-- delete one.

CREATE TABLE indexer_contracts (
  name    text PRIMARY KEY CHECK (name ~ '^[a-z][a-z0-9-]*$'),
  address char(42) NOT NULL CHECK (address ~ '^0x[0-9a-f]{40}$')
);

REVOKE ALL ON indexer_contracts FROM PUBLIC;
GRANT SELECT, INSERT ON indexer_contracts TO monadeum_indexer;
GRANT SELECT ON indexer_contracts TO monadeum_worker, monadeum_reader;

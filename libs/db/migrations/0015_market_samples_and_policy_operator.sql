-- The worker's tick runner (ARCHITECTURE.md section 11, "Tick runner"): the market mid series the strategy's signal is
-- computed from, and the reads the policy operator's CLI needs to verify a new version against the stored chain.

-- One mid of a Kuru order book per (market, tick): the first valid reading taken during that tick, never replaced, so
-- every agent that ticks in the same hour computes its signal from the same series. `mid` is (best bid + best ask) / 2
-- at Kuru's `bestBidAsk` scale (quote per base, times 1e18); the block it was read at is kept for audit.
CREATE TABLE market_mid_samples (
  market           text NOT NULL CHECK (market ~ '^0x[0-9a-f]{40}$'),
  tick             bigint NOT NULL CHECK (tick > 0),
  mid              numeric(78, 0) NOT NULL CHECK (mid > 0),
  block_number     numeric(78, 0) NOT NULL CHECK (block_number >= 0),
  block_timestamp  bigint NOT NULL CHECK (block_timestamp >= 0),
  recorded_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (market, tick)
);

-- The worker inserts each sample once (insert-if-absent) and reads them; no role updates or deletes one. The reader
-- role may read them.
REVOKE ALL ON market_mid_samples FROM PUBLIC;
GRANT SELECT, INSERT ON market_mid_samples TO monadeum_worker;
GRANT SELECT ON market_mid_samples TO monadeum_reader;

-- The policy operator appends a version only after verifying it extends the stored chain (its version, previousHash,
-- and signer), so it reads the table it appends to, and the migration ledger to verify the schema like every other
-- process role. Still no UPDATE, DELETE, or TRUNCATE: the 0003 trigger and the 0004 grants are unchanged.
GRANT SELECT ON risk_policy_versions TO monadeum_policy_operator;
GRANT SELECT ON store_schema_migrations TO monadeum_policy_operator;

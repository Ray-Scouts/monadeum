-- The worker's evaluation records (ARCHITECTURE.md sections 5 and 10), with their grants: one row per Active, funded
-- agent per evaluation, the outcome the worker computed. Unlike the module stores of 0001, every field is a column,
-- because the API reads them by agent and by evaluation and nothing in them is module-shaped.

CREATE TABLE evaluation_records (
  agent_id            text NOT NULL,
  -- The evaluation tick divided by the evaluation cadence.
  sequence            integer NOT NULL CHECK (sequence >= 0),
  -- Milliseconds since the Unix epoch, from the worker's clock.
  evaluated_at        bigint NOT NULL,
  -- The account's settlement-asset balance read during the evaluation, base units.
  capital             numeric(78, 0) NOT NULL CHECK (capital >= 0),
  adjusted_fitness    double precision,
  -- Within the agent's niche, as the EVOLUTION.md section 6 starvation check computes it. Null with no fitness.
  fitness_percentile  double precision CHECK (fitness_percentile >= 0 AND fitness_percentile <= 1),
  raw_sortino         double precision,
  zero_downside       boolean NOT NULL,
  trade_count         integer NOT NULL CHECK (trade_count >= 0),
  -- The starvation count carried out of this evaluation.
  low_windows         integer NOT NULL CHECK (low_windows >= 0),
  retired             boolean NOT NULL,
  retirement_rule     text,
  PRIMARY KEY (agent_id, sequence),
  CHECK (fitness_percentile IS NULL OR adjusted_fitness IS NOT NULL),
  CHECK (retired = (retirement_rule IS NOT NULL))
);
CREATE INDEX evaluation_records_sequence ON evaluation_records (sequence);

-- Append-only: the worker inserts each record once (insert-if-absent) and reads them, and never changes or deletes
-- one. The reader role, through which the API reads, may only read them.
REVOKE ALL ON evaluation_records FROM PUBLIC;
GRANT SELECT, INSERT ON evaluation_records TO monadeum_worker;
GRANT SELECT ON evaluation_records TO monadeum_reader;

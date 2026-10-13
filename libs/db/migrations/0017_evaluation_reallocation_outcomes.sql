-- What reallocation did to each agent at an evaluation (ARCHITECTURE.md section 5, EVOLUTION.md sections 3.1 and 6),
-- recorded by the worker with the rest of the evaluation record so the API can explain it (issue #43).
--
-- `reallocation_kind` is null when the deployment's reallocation switch was off, so nothing was planned; then every other
-- column added here is null too. Otherwise it is the outcome `evaluationOutcomes` of @monadeum/reallocation computed from
-- the plan: `off` and `unranked` and `held` carry a reason, `sent` and `received` the amount the worker submitted in
-- base units, and a ranked agent its position in its owner's pool (1 is the lowest), the pool size, and the quota.
-- The grants of 0013 cover the new columns: the worker inserts, the reader reads, nobody updates or deletes.

ALTER TABLE evaluation_records
  ADD COLUMN reallocation_kind   text CHECK (reallocation_kind IN ('off', 'unranked', 'sent', 'received', 'held', 'retired')),
  ADD COLUMN reallocation_reason text,
  ADD COLUMN reallocation_amount numeric(78, 0) CHECK (reallocation_amount >= 0),
  ADD COLUMN rank_position       integer CHECK (rank_position >= 1),
  ADD COLUMN rank_of             integer CHECK (rank_of >= 1),
  ADD COLUMN rank_quota          integer CHECK (rank_quota >= 0),
  ADD CHECK (reallocation_kind IS NOT NULL OR (reallocation_reason IS NULL AND reallocation_amount IS NULL AND rank_position IS NULL)),
  ADD CHECK ((rank_position IS NULL) = (rank_of IS NULL) AND (rank_of IS NULL) = (rank_quota IS NULL)),
  ADD CHECK (rank_position IS NULL OR rank_position <= rank_of);

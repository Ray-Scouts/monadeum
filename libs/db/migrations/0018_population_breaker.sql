-- The population-level circuit breaker (SECURITY.md section 9, layer 3): an append-only log whose latest entry is the
-- breaker's state. The worker appends a trip when capital at risk or the reallocation volume of an evaluation crosses
-- its threshold; while the latest entry is a trip, the worker runs no tick and settles no reallocation. Only the policy
-- operator, a human, appends a clear. Kept in Postgres so a restarted worker is still halted.

CREATE TABLE population_breaker_events (
  id           bigserial PRIMARY KEY,
  kind         text NOT NULL CHECK (kind IN ('trip', 'clear')),
  -- For a trip: which signal crossed, the value observed, and the threshold, in settlement-asset base units.
  signal       text CHECK (signal IN ('capital-at-risk', 'reallocation-volume')),
  observed     numeric(78, 0) CHECK (observed >= 0),
  threshold    numeric(78, 0) CHECK (threshold >= 0),
  actor        text NOT NULL CHECK (actor <> ''),
  reason       text NOT NULL CHECK (reason <> ''),
  -- Milliseconds since the Unix epoch, from the writer's clock.
  recorded_at  bigint NOT NULL CHECK (recorded_at >= 0),
  CHECK ((kind = 'trip') = (signal IS NOT NULL AND observed IS NOT NULL AND threshold IS NOT NULL)),
  CHECK (kind = 'trip' OR (signal IS NULL AND observed IS NULL AND threshold IS NULL))
);

-- No role updates or deletes an entry. The worker may append trips only, the policy operator clears only, and the
-- reader, through which the API reads, may only read. Row-level security enforces which kind each role may append.
REVOKE ALL ON population_breaker_events FROM PUBLIC;
ALTER TABLE population_breaker_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY breaker_read ON population_breaker_events FOR SELECT USING (true);
CREATE POLICY breaker_worker_trips ON population_breaker_events FOR INSERT TO monadeum_worker WITH CHECK (kind = 'trip');
CREATE POLICY breaker_operator_clears ON population_breaker_events FOR INSERT TO monadeum_policy_operator WITH CHECK (kind = 'clear');
GRANT SELECT, INSERT ON population_breaker_events TO monadeum_worker, monadeum_policy_operator;
GRANT USAGE ON SEQUENCE population_breaker_events_id_seq TO monadeum_worker, monadeum_policy_operator;
GRANT SELECT ON population_breaker_events TO monadeum_reader;

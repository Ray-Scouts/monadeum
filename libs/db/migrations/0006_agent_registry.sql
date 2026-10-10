-- The worker's agent registry, per-agent running state, and reallocation debit records (ARCHITECTURE.md sections 10
-- and 11), with their grants. Same rules as 0001: guarantees are constraints, module-shaped records are kept whole in
-- `body` (encoded by @monadeum/db with bigints tagged), and the columns a constraint or lookup needs are written in
-- the same statement as `body`.

-- One row per agent. Written by agent creation; the worker reads it and changes only an agent's status (retirement).
CREATE TABLE worker_agents (
  agent_id  text PRIMARY KEY,
  -- The owner's root wallet, lowercased.
  owner     text NOT NULL CHECK (owner ~ '^0x[0-9a-f]{40}$'),
  status    text NOT NULL CHECK (status IN ('active', 'retired')),
  body      jsonb NOT NULL
);

-- The worker's running state for one agent: trade cadence, information spend, fitness history. Replaced whole on
-- every save. An agent with no row has the initial state.
CREATE TABLE worker_agent_states (
  agent_id  text PRIMARY KEY REFERENCES worker_agents (agent_id),
  body      jsonb NOT NULL
);

-- One record per reallocation debit, keyed by (owner, evaluation sequence, source). Claimed before submission, so a
-- key already present is never submitted again.
CREATE TABLE reallocation_debits (
  key     text PRIMARY KEY,
  status  text NOT NULL CHECK (status IN ('approved', 'settled', 'failed', 'rejected')),
  body    jsonb NOT NULL
);

-- The worker may read agents and update them (retirement), but not create them: agent creation belongs to the API,
-- which has no role yet. It writes its running state and debit records, and deletes nothing.
REVOKE ALL ON worker_agents, worker_agent_states, reallocation_debits FROM PUBLIC;
GRANT SELECT, UPDATE ON worker_agents TO monadeum_worker;
GRANT SELECT, INSERT, UPDATE ON worker_agent_states, reallocation_debits TO monadeum_worker;
GRANT SELECT ON worker_agents, worker_agent_states, reallocation_debits TO monadeum_reader;

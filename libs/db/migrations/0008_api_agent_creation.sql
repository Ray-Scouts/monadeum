-- Agent creation writes the worker's agent record (EVOLUTION.md section 1.1, ARCHITECTURE.md section 10).
--
-- The API builds an agent's genome server-side from a named preset, hashes it, and inserts the agent's `worker_agents`
-- row (0006) in the same transaction as its own `api_agents` row (0007), with principal 0. It needs INSERT on that
-- table and nothing more: it never changes or deletes a worker agent (the worker's UPDATE retires agents, and the
-- principal recomputed from funding is the worker's write too), and it still has no access to the worker's running
-- state or debit records. No other role changes.

GRANT INSERT ON worker_agents TO monadeum_api;

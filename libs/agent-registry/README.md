# @monadeum/agent-registry

The worker's agent registry and running state (`AgentStore`, `AgentRegistry`, `AgentRecord`, `AgentState`), its reallocation debit records (`DebitStore`, `DebitRecord`), and its evaluation records (`EvaluationStore`, `EvaluationRecord`), with in-memory implementations (`MemoryAgentStore`, `MemoryDebitStore`, `MemoryEvaluationStore`).

It is a package of its own so that `@monadeum/db` can implement these interfaces on Postgres (`PgAgentStore`, `PgDebitStore`, migration 0006; `PgEvaluationStore`, migration 0013) without depending on `apps/worker`, which uses them. The decision is recorded in `ARCHITECTURE.md` section 10, database layer entry.

`AgentStore` is the worker's view: list, read, retire (`update`), and the running state. `AgentRegistry` adds `add`, agent creation's write; the worker's database role is not granted it. The in-memory implementations are for tests and local development and are not durable. Each is held to the conformance suite in `libs/db`.

`EvaluationStore` is the per-agent outcome of each evaluation: capital in base units, adjusted fitness, the fitness percentile within the agent's niche, raw Sortino, the zero-downside flag, the trade count, the starvation count, and retirement. The worker writes it once per evaluation, insert-if-absent per (agent, sequence), and the API reads it to serve an agent's capital, fitness, and capital history (`ARCHITECTURE.md` section 10).

# @monadeum/agent-registry

The worker's agent registry and running state (`AgentStore`, `AgentRegistry`, `AgentRecord`, `AgentState`) and its reallocation debit records (`DebitStore`, `DebitRecord`), with in-memory implementations (`MemoryAgentStore`, `MemoryDebitStore`).

It is a package of its own so that `@monadeum/db` can implement these interfaces on Postgres (`PgAgentStore`, `PgDebitStore`, migration 0006) without depending on `apps/worker`, which uses them. The decision is recorded in `ARCHITECTURE.md` section 10, database layer entry.

`AgentStore` is the worker's view: list, read, retire (`update`), and the running state. `AgentRegistry` adds `add`, agent creation's write; the worker's database role is not granted it. The in-memory implementations are for tests and local development and are not durable. Both are held to the conformance suite in `libs/db`.

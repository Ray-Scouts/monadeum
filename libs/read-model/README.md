# @monadeum/read-model

The chain-sourced read-model's store interface (`ReadModelStore`), its row types (`ChainEvent`, `BlockHash`, `SyncBatch`, `TrackedAccount`, `EventFilter`), and the in-memory implementation (`InMemoryReadModelStore`).

It also holds the funding rule both sides share: the row kinds the indexer writes for settlement-asset transfers (`settlement.transfer-in`, `settlement.transfer-out`) and `principalFrom`, the pure function the worker uses to recompute an agent's principal from them (`EVOLUTION.md` section 1.1). `finalizedThrough` gives the block through which every stored row was read from finalized blocks, or null, so a reader can act on finalized data only.

It is a package of its own so that `apps/indexer`, the only writer of these rows, can depend on `@monadeum/db`, where `PgReadModelStore` implements the same interface, without a dependency cycle. The decision is recorded in `ARCHITECTURE.md` section 10, database layer entry. It has no runtime dependency beyond viem's types.

`InMemoryReadModelStore` is for tests and local development: it is not durable. Its behavior is held to the conformance suite in `libs/db`, which runs against it and the Postgres store.

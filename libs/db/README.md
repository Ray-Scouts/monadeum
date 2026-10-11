# @monadeum/db

Postgres storage for the module stores: `AgentWalletStore` and `SponsorshipLedger` (`@monadeum/wallets`), `UserStore`, `ChallengeStore` and `SessionStore` (`@monadeum/auth`), `TradeStore` (`@monadeum/trading`), `PaymentLog` (`@monadeum/x402`), `TickStore` (`@monadeum/tick`), `AgentStore` and `DebitStore` (`@monadeum/agent-registry`, used by `apps/worker`), and `ReadModelStore` (`@monadeum/read-model`, written by `apps/indexer`), plus the append-only policy-document table (`PgPolicyVersions`) and the database roles and grants. The decisions behind it are in `ARCHITECTURE.md` section 10, database layer entry.

## Use

```ts
import pg from "pg";
import { migrate, pgDatabase, PgAgentWalletStore } from "@monadeum/db";

const db = pgDatabase(new pg.Pool({ connectionString: process.env.DATABASE_URL }));
await migrate(db);
const wallets = new PgAgentWalletStore(db);
```

`migrate` applies `migrations/NNNN_name.sql` in order and refuses to run if an applied file changed. `verifyMigrations` checks the same without changing anything, and fails if any file is pending. Never edit an applied migration; add a new file.

## Process configuration

`apps/worker` and `apps/indexer` read the same variables through `loadDatabaseSettings` and `openDatabase`:

| Variable | Default | Meaning |
|---|---|---|
| `DATABASE_URL` | unset | Postgres connection string. Unset means in-memory stores, logged as not durable; for local development and tests only. |
| `DATABASE_MIGRATIONS` | `verify` | `verify` checks every migration is applied and changes nothing; `apply` runs pending ones first. A deployed process connects through a role without DDL privileges, so it verifies, and the schema is applied by a separate step as the owner. |
| `MONADEUM_ENV` | `development` | `production` refuses to start without `DATABASE_URL`. |

## Roles

Migrations 0004 to 0009 create the group roles and their grants. Each process's login role is made a member of one, except the API's, which is a member of `monadeum_api` and `monadeum_reader` and runs each statement under one of them; no process connects as the table owner.

| Role | Writes | Reads |
|---|---|---|
| `monadeum_indexer` | read-model tables | read-model tables, migration ledger |
| `monadeum_worker` | wallet, trade, x402, tick, agent state, and debit tables (`SELECT`, `INSERT`, `UPDATE`; no `DELETE`); agents (`UPDATE` only: it retires agents and writes their principal, but never creates one) | those tables, agents, policy versions, migration ledger, and the read-model's `chain_events` and `indexer_cursor` for the principal job (0009) |
| `monadeum_reader` | nothing | read-model tables and views, wallet, trade, x402, tick, agent, agent state, and debit tables, migration ledger |
| `monadeum_policy_operator` | policy versions (`INSERT` only) | nothing |
| `monadeum_api` | auth tables; wallet accounts and sponsorship (`SELECT`, `INSERT`, `UPDATE`; no `DELETE`); the API tables of 0007 (recovery actions and signed policies `INSERT` only, holds also `UPDATE`) | those tables, agents (`SELECT` and `INSERT`: agent creation writes the record, never changes or deletes one, 0008), migration ledger |

Only `monadeum_api` has any privilege on the auth tables and the API tables. Migration `0007_api.sql` adds them; their stores live in `apps/api`, which owns the interfaces.

There is no `SessionKeyVault` here. Session private keys belong in a secrets manager, never in Postgres (`SECURITY.md` section 11).

## Tests

`bun run --filter @monadeum/db test` runs one conformance suite against the in-memory stores and against the Postgres stores on PGlite, in process, with no database service. To run the same suite against a real server, set `DATABASE_URL`; the test creates a throwaway schema and drops it afterwards.

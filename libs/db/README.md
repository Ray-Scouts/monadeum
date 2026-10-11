# @monadeum/db

Postgres storage for the module stores: `AgentWalletStore` and `SponsorshipLedger` (`@monadeum/wallets`), `UserStore`, `ChallengeStore` and `SessionStore` (`@monadeum/auth`), `TradeStore` and `PositionStore` (`@monadeum/trading`), `PaymentLog` (`@monadeum/x402`), `TickStore` (`@monadeum/tick`), `AgentStore`, `DebitStore`, and `EvaluationStore` (`@monadeum/agent-registry`, written by `apps/worker`; `EvaluationStore` is also read by `apps/api`), and `ReadModelStore` (`@monadeum/read-model`, written by `apps/indexer`), plus the append-only policy-document table (`PgPolicyVersions`) and the database roles and grants. The decisions behind it are in `ARCHITECTURE.md` section 10, database layer entry.

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

Migrations 0004 to 0013 create the group roles and their grants. Each process's login role is made a member of one, except the API's, which is a member of `monadeum_api` and `monadeum_reader` and runs each statement under one of them; no process connects as the table owner.

| Role | Writes | Reads |
|---|---|---|
| `monadeum_indexer` | read-model tables | read-model tables, migration ledger |
| `monadeum_worker` | wallet, trade, position (0011), x402, tick, agent state, and debit tables (`SELECT`, `INSERT`, `UPDATE`; no `DELETE`); agents (`UPDATE` only: it retires agents and writes their principal, but never creates one); evaluation records (`SELECT`, `INSERT` only, 0013: append-only) | those tables, agents, policy versions, migration ledger, and the read-model's `chain_events` and `indexer_cursor` for the principal job (0009), and `indexer_settings`, the indexer's recorded settlement asset (0010) |
| `monadeum_reader` | nothing | read-model tables and views, wallet, trade, position, x402, tick, agent, agent state, debit, and evaluation record (0013) tables, migration ledger |
| `monadeum_policy_operator` | policy versions (`INSERT` only) | nothing |
| `monadeum_api` | auth tables; wallet accounts and sponsorship (`SELECT`, `INSERT`, `UPDATE`; no `DELETE`); the API tables of 0007 (recovery actions and signed policies `INSERT` only, holds also `UPDATE`) | those tables, agents (`SELECT` and `INSERT`: agent creation writes the record, never changes or deletes one, 0008), migration ledger |

Only `monadeum_api` has any privilege on the auth tables and the API tables. Migration `0007_api.sql` adds them; their stores live in `apps/api`, which owns the interfaces.

There is no `SessionKeyVault` here. Session private keys never go to Postgres: on testnet they are in the local encrypted file vault of `libs/wallets`, and production needs a secrets manager (`SECURITY.md` section 11).

## Migration step

`runMigrationStep` (`src/migrate-main.ts`, run as `node libs/db/dist/src/migrate-main.js`) is the dedicated, privileged step a deployment runs once before the services start. With `DATABASE_URL` naming the owning role (which needs `CREATEROLE`), it applies every pending migration, then creates or updates one login role per process whose password is set, as members of the group roles above (`PROCESS_LOGIN_ROLES`):

| Variable | Login role | Member of |
|---|---|---|
| `DB_API_PASSWORD` or `DB_API_PASSWORD_FILE` | `monadeum_api_login` | `monadeum_api`, `monadeum_reader` |
| `DB_WORKER_PASSWORD` or `DB_WORKER_PASSWORD_FILE` | `monadeum_worker_login` | `monadeum_worker` |
| `DB_INDEXER_PASSWORD` or `DB_INDEXER_PASSWORD_FILE` | `monadeum_indexer_login` | `monadeum_indexer` |

Each is `LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION INHERIT`; an existing role with any of those privileges is refused, a rerun sets the password again (rotation), and memberships in other monadeum group roles are revoked. Passwords of at least 16 characters, sent only as bind parameters and quoted inside the server; nothing logs them. `test/provision.test.ts` runs it on PGlite. `deploy/docker-compose.yml` runs it as the `migrate` service.

## Tests

`bun run --filter @monadeum/db test` runs one conformance suite against the in-memory stores and against the Postgres stores on PGlite, in process, with no database service. To run the same suite against a real server, set `DATABASE_URL`; the test creates a throwaway schema and drops it afterwards.

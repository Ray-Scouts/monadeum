# @monadeum/db

Postgres storage for the module stores: `AgentWalletStore` and `SponsorshipLedger` (`@monadeum/wallets`), `UserStore`, `ChallengeStore` and `SessionStore` (`@monadeum/auth`), `TradeStore` (`@monadeum/trading`), `PaymentLog` (`@monadeum/x402`), `TickStore` (`@monadeum/tick`), and `ReadModelStore` (`@monadeum/indexer`), plus the append-only policy-document table (`PgPolicyVersions`) and the database roles and grants. The decisions behind it are in `ARCHITECTURE.md` section 10, database layer entry.

## Use

```ts
import pg from "pg";
import { migrate, pgDatabase, PgAgentWalletStore } from "@monadeum/db";

const db = pgDatabase(new pg.Pool({ connectionString: process.env.DATABASE_URL }));
await migrate(db);
const wallets = new PgAgentWalletStore(db);
```

`migrate` applies `migrations/NNNN_name.sql` in order and refuses to run if an applied file changed. Never edit an applied migration; add a new file.

There is no `SessionKeyVault` here. Session private keys belong in a secrets manager, never in Postgres (`SECURITY.md` section 11).

## Tests

`bun run --filter @monadeum/db test` runs one conformance suite against the in-memory stores and against the Postgres stores on PGlite, in process, with no database service. To run the same suite against a real server, set `DATABASE_URL`; the test creates a throwaway schema and drops it afterwards.

# IndexerModule

The read path described in `ARCHITECTURE.md` sections 1, 9 and 10: a separately deployable process that syncs on-chain events from Monad into the read-model the dashboard and API read. It is not a NestJS module of the API and not part of the worker. It reads the chain through viem 2.56.9, pinned to the version `libs/wallets` uses, and never signs or sends anything.

## What it does

- **Chain sync.** Polls the head, indexes only blocks at least `INDEXER_CONFIRMATIONS` below it, in batches of at most `INDEXER_BATCH_SIZE` blocks, starting at `INDEXER_START_BLOCK` when the store has no cursor. Each batch is written with its cursor atomically, so a restart over a durable store resumes after the last stored block.
- **Reorg handling.** Before each batch the stored cursor hash is compared with the chain. On a mismatch, the stored block hashes (each batch's first and last block, and every block that produced a row) are walked back to the newest one still canonical, every row above it is deleted, tracked accounts first seen above it are dropped, and sync resumes from there, so the replaced blocks are re-indexed. A batch whose logs carry a hash that differs from the canonical block, or whose first block does not extend the cursor, is retried rather than stored. A divergence deeper than `INDEXER_REORG_WINDOW` stops the process with `DeepReorgError`; it needs an operator, and is never skipped.
- **Handlers.** A registry of `EventHandler`s, each declaring its source, its event ABI items, and the row kinds it writes. Two handlers may not declare the same kind. The ones registered today:
  - `agent-spend-policy`: `LimitsSet`, `CallAllowed`, `Spent` from `AgentSpendPolicy`. It discovers accounts: WalletsModule deploys an agent account and sets its limits in the same operation, so an account that sets limits on the configured policy is followed from then on.
  - `entry-point-account-deployed`: EntryPoint v0.7 `AccountDeployed`, only for followed accounts (`sender` is topic 2).
  - `kernel-session-keys`: Kernel v3.1 `PermissionInstalled`, `PermissionUninstalled`, `NonceInvalidated`, emitted by followed accounts: the session key lifecycle WalletsModule produces (enable on first use, uninstall and `invalidateNonce` on revocation).
  Adding the reallocation contract (issue #31) means writing one more handler and registering it; the sync loop, reorg handling, and store do not change. A test registers a stand-in handler to show this.
- **Event signatures** come from installed package ABIs, not from memory: Kernel v3.1 from `@zerodev/sdk` 5.5.10 (`KernelV3_1AccountAbi`) and EntryPoint v0.7 from viem (`entryPoint07Abi`). `AgentSpendPolicy` ships no ABI artifact, so its events are parsed from `contracts/src/IAgentSpendPolicy.sol`'s declarations, and a test fails if the two drift.
- **Read-model.** `ReadModelStore` is the write and read interface; `InMemoryReadModelStore` implements it. `projectAccount` folds an account's rows into a view: deployment, limits, allowlist, last spend, and session permissions.

## Boundaries

- **The indexer is the only writer of chain-sourced rows.** Nothing else inserts, updates, or deletes them. `sql/001_read_model.sql` grants writes to a `monadeum_indexer` role only.
- **The worker never depends on the indexer.** Agent decisions read the chain or their own records, never this read-model, so an indexer outage or lag cannot change what an agent does. `apps/worker/test/boundary.test.ts` fails if `apps/worker` declares or imports this package.
- **Being followed is not ownership.** Anyone can call `setLimits` on the policy from any address, so the followed set is permissionless. The API must join it against its own agent records (`THREAT-MODEL.md` boundary 10), never treat a row here as proof the platform created an account.
- **Session key status here is derived.** `live` in the projection comes from indexed events. The authoritative revocation check reads the account directly (`WalletsService.revocationStatus`).

## Configuration

| Variable | Required | Meaning |
|---|---|---|
| `INDEXER_CHAIN_ID` | yes | Must be `10143`, Monad testnet. Checked against the RPC at start. |
| `INDEXER_RPC_URL` | no | Monad RPC, http(s). Defaults to viem's Monad testnet RPC. |
| `INDEXER_START_BLOCK` | yes | First block indexed when the store has no cursor: the spend policy's deployment block. |
| `INDEXER_SPEND_POLICY_ADDRESS` | yes | Deployed `AgentSpendPolicy`. |
| `INDEXER_ENTRY_POINT_ADDRESS` | no | Defaults to the EntryPoint v0.7 address from viem. |
| `INDEXER_BATCH_SIZE` | no | Blocks per batch, default 100. |
| `INDEXER_CONFIRMATIONS` | no | Blocks below the head before indexing, default 10. |
| `INDEXER_REORG_WINDOW` | no | Blocks of stored hashes kept below the cursor, default 1000. Must exceed the confirmations. |
| `INDEXER_POLL_INTERVAL_MS` | no | Wait between polls once caught up, default 1000, at least 100. |

The defaults for batch size and confirmation depth are working assumptions, not verified Monad properties: the `eth_getLogs` range limit of the RPC in use, and how far a Monad block below the head can still be replaced, have not been measured here. Both should be checked against the chosen RPC provider and Monad's finality documentation before the indexer backs anything security-relevant.

## Running

`bun run --filter @monadeum/indexer test` builds and runs the offline tests against an in-memory chain (`test/mock-chain.ts`), including a reorg that removes an indexed `Spent` event and a tracked account. `test/testnet.test.ts` syncs one batch of Monad testnet and is skipped unless `INDEXER_TESTNET=1`; it needs `INDEXER_SPEND_POLICY_ADDRESS` and optionally `INDEXER_RPC_URL`.

`node dist/src/main.js` runs the service after a build.

## Not done yet

- **Postgres is not wired.** `sql/001_read_model.sql` defines the schema, projections, and grants, and was applied to a local Postgres to check that it parses; no store implements `ReadModelStore` on it, and no migration runner applies it. Until then the service runs on the in-memory store and a restart re-indexes from `INDEXER_START_BLOCK`.
- No run against Monad testnet has been recorded: the spend policy is not yet deployed there.
- No identity registry or genome hash commitment contract exists yet (`ARCHITECTURE.md` section 9), so the indexer has nothing to read for them; each becomes a handler when its contract lands.
- The read API the dashboard will call, and the replacement of `apps/web`'s sample `PopulationSource`, are separate work (issue #42).

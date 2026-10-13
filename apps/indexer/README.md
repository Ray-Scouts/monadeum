# IndexerModule

The read path described in `ARCHITECTURE.md` sections 1, 9 and 10: a separately deployable process that syncs on-chain events from Monad into the read-model the dashboard and API read. It is not a NestJS module of the API and not part of the worker. It reads the chain through viem 2.56.9, pinned to the version `libs/wallets` uses, and never signs or sends anything.

## What it does

- **Chain sync.** By default indexes only blocks at or below the one the node reports for the `finalized` tag (`INDEXER_SYNC_TO=finalized`); with `INDEXER_SYNC_TO=confirmations` it instead indexes blocks at least `INDEXER_CONFIRMATIONS` below the head, for an RPC that does not serve the tag. It never switches mode by itself: if the node reports no finalized block, the batch is retried. It works in batches of at most `INDEXER_BATCH_SIZE` blocks, starting at `INDEXER_START_BLOCK` when the store has no cursor. Each batch is written with its cursor atomically, so a restart over a durable store resumes after the last stored block.
- **Reorg handling.** Kept in both modes. Monad documents finalized blocks as irreversible without a hard fork (see "Finality" below), so in `finalized` mode this is a defence against a node serving inconsistent data rather than an expected path. Before each batch the stored cursor hash is compared with the chain. On a mismatch, the stored block hashes (each batch's first and last block, and every block that produced a row) are walked back to the newest one still canonical, every row above it is deleted, tracked accounts first seen above it are dropped, and sync resumes from there, so the replaced blocks are re-indexed. A batch whose logs carry a hash that differs from the canonical block, or whose first block does not extend the cursor, is retried rather than stored. A divergence deeper than `INDEXER_REORG_WINDOW` stops the process with `DeepReorgError`; it needs an operator, and is never skipped.
- **Handlers.** A registry of `EventHandler`s, each declaring its source, its event ABI items, and the row kinds it writes. Two handlers may not declare the same kind. The ones registered today:
  - `agent-spend-policy`: `LimitsSet`, `CallAllowed`, `Spent` from `AgentSpendPolicy`. It discovers candidate accounts: WalletsModule deploys an agent account and sets its limits in the same operation.
  - Admission: a candidate is followed only if the same transaction in which it first appears on the spend policy also emitted EntryPoint `AccountDeployed` for it with `factory` equal to `INDEXER_KERNEL_FACTORY_ADDRESS`. Rows of candidates that are not admitted are not stored.
  - `entry-point-account-deployed`: EntryPoint v0.7 `AccountDeployed`, only for followed accounts (`sender` is topic 2).
  - `kernel-session-keys`: Kernel v3.1 `PermissionInstalled`, `PermissionUninstalled`, `NonceInvalidated`, emitted by followed accounts: the session key lifecycle WalletsModule produces (enable on first use, uninstall and `invalidateNonce` on revocation).
  - With `INDEXER_REALLOCATION_ADDRESS` set, four handlers on `AgentReallocation`: `reallocation-sent` and `reallocation-received`, its `Reallocated` event once per followed side (kinds `reallocation.sent` for the source, topic 2, and `reallocation.received` for the sink, topic 3, each with `owner`, `source`, `sink`, `amount`, and the contract's `evaluation`); `reallocation-agents`, `AgentRegistered`, `PrincipalSet`, and `AgentRetired` for followed accounts (topic 1); and `reallocation-owners`, `PolicyCommitted`, `PolicyRevoked`, and `EvaluationAdvanced`, stored with no account. Operator and admin changes are not stored. A move between two of one owner's followed agents is stored under both kinds, with the same transaction and log index; the API serves it once.
  Adding a further contract means writing one more handler and registering it; the sync loop, reorg handling, and store do not change.
- **Event signatures** come from installed package ABIs, not from memory: Kernel v3.1 from `@zerodev/sdk` 5.5.10 (`KernelV3_1AccountAbi`) and EntryPoint v0.7 from viem (`entryPoint07Abi`). `AgentSpendPolicy` and `AgentReallocation` ship no ABI artifact, so their events are parsed from the declarations in `contracts/src/IAgentSpendPolicy.sol` and `contracts/src/IAgentReallocation.sol`, and a test fails if either drifts.
- **Read-model.** `ReadModelStore` is the write and read interface, defined in `libs/read-model` and re-exported here; `InMemoryReadModelStore` and, in `libs/db`, `PgReadModelStore` implement it. With `DATABASE_URL` set the service writes Postgres, so a restart resumes after the stored cursor. `projectAccount` folds an account's rows into a view: deployment, limits, allowlist, last spend, and session permissions.

## Boundaries

- **The indexer is the only writer of chain-sourced rows.** Nothing else inserts, updates, or deletes them. The schema in `libs/db` (migration 0004) grants writes to the `monadeum_indexer` role only.
- **The worker never depends on the indexer.** Agent decisions read the chain or their own records, never this read-model, so an indexer outage or lag cannot change what an agent does. `apps/worker/test/boundary.test.ts` fails if `apps/worker` declares or imports this package. The one exception is the worker's principal job, which reads the funding rows through `@monadeum/read-model` (not this package), only up to the finalized bound, and writes each agent's principal to its record; an outage delays a principal change and changes nothing else (`ARCHITECTURE.md` sections 6.1 and 10).
- **Funding rows.** Every `Transfer` of `INDEXER_SETTLEMENT_ASSET_ADDRESS` whose `to` is a followed account is stored as `settlement.transfer-in` and every one whose `from` is a followed account as `settlement.transfer-out`, with `from`, `to`, and `value`. Only that one contract is queried, so a token at any other address is never stored, whatever its symbol (`THREAT-MODEL.md` invariant 16). The rows are facts; `principalFrom` in `@monadeum/read-model` decides what counts as principal.
- **Being followed is not ownership.** The factory rule keeps arbitrary addresses that call `setLimits` out of the followed set, but the Kernel factory is public: anyone can deploy a Kernel account through it and configure the policy in the same operation. The API must join the followed set against its own agent records (`THREAT-MODEL.md` boundary 10), never treat a row here as proof the platform created an account.
- **Session key status here is derived.** `live` in the projection comes from indexed events. The authoritative revocation check reads the account directly (`WalletsService.revocationStatus`).

## Configuration

| Variable | Required | Meaning |
|---|---|---|
| `INDEXER_CHAIN_ID` | yes | Must be `10143`, Monad testnet. Checked against the RPC at start. |
| `INDEXER_RPC_URL` | no | Monad RPC, http(s). Defaults to viem's Monad testnet RPC. |
| `INDEXER_START_BLOCK` | yes | First block indexed when the store has no cursor: the spend policy's deployment block. |
| `INDEXER_SPEND_POLICY_ADDRESS` | yes | Deployed `AgentSpendPolicy`. |
| `INDEXER_SETTLEMENT_ASSET_ADDRESS` | yes | The USDC contract whose transfers to and from followed accounts are indexed. The worker's `WORKER_SETTLEMENT_ASSET_ADDRESS` must name the same contract. The indexer records it in the read-model at start (`indexer_settings`, `libs/db` migration 0010), the worker refuses to start on a mismatch, and the indexer refuses to start over a read-model that records a different one. |
| `INDEXER_REALLOCATION_ADDRESS` | no | Deployed `AgentReallocation`. Unset: its events are not indexed. Set, the indexer records it in the read-model at start (`indexer_contracts`, `libs/db` migration 0016), and the API reports reallocations as indexed only when that record equals its `API_REALLOCATION_CONTRACT`. The indexer refuses to start when it would add the contract to a read-model that already has a cursor (the earlier blocks were read without it), when it names a different contract than the one recorded, or when it is unset over a read-model that records one. |
| `INDEXER_ENTRY_POINT_ADDRESS` | no | Defaults to the EntryPoint v0.7 address from viem. |
| `INDEXER_KERNEL_FACTORY_ADDRESS` | no | Factory an account must be deployed through to be followed. Defaults to Kernel v3.1's meta factory from `@zerodev/sdk` 5.5.10's address map (`0xd703...42d5`), the factory `createKernelAccount` names by default, as WalletsModule uses it. |
| `INDEXER_SYNC_TO` | no | `finalized` (default) or `confirmations`. Only a read-model filled entirely under `finalized` reports a finalized bound, so under `confirmations` the worker never changes a principal. |
| `INDEXER_BATCH_SIZE` | no | Blocks per batch, default 100. |
| `INDEXER_CONFIRMATIONS` | no | With `INDEXER_SYNC_TO=confirmations`: blocks below the head before indexing, default 10. |
| `INDEXER_REORG_WINDOW` | no | Blocks of stored hashes kept below the cursor, default 1000. Must exceed the confirmations. |
| `INDEXER_POLL_INTERVAL_MS` | no | Wait between polls once caught up, default 1000, at least 100. |
| `DATABASE_URL` | in production | Postgres for the read-model. Unset runs the in-memory store, which is logged as not durable and re-indexes from `INDEXER_START_BLOCK` on every start. Connect through a role that is a member of `monadeum_indexer`. |
| `DATABASE_MIGRATIONS` | no | `verify` (default) refuses to start unless every `libs/db` migration is applied; `apply` applies pending ones first. |
| `MONADEUM_ENV` | no | `development` (default) or `production`; production refuses to start without `DATABASE_URL`. |

## HyperSync cross-check

An operator-run script that compares what the indexer stored with the logs an independent source, Envio HyperSync, returns for the same block range. The decision and its limits are in `ARCHITECTURE.md` section 10, indexer entry.

```
ENVIO_API_TOKEN=... DATABASE_URL=... INDEXER_CHAIN_ID=10143 INDEXER_SPEND_POLICY_ADDRESS=... INDEXER_SETTLEMENT_ASSET_ADDRESS=... INDEXER_START_BLOCK=... \
  bun run indexer:crosscheck -- --from 70167444 --to 70168444
```

- **Does.** For `[from, to]`, at or below the stored cursor, it asks HyperSync for the logs the registered handlers select (queries built by the same code as the sync loop), decodes them with the same handlers, keeps rows for followed accounts, and compares them with the stored rows by block number, log index, and kind: the emitting address, account, block hash, transaction hash, and every decoded field. It prints a JSON report with no timestamps, so the same inputs give the same output: `status`, `range`, `counts`, `matched`, `missingInSource`, `missingInIndexer`, `fieldMismatches`, and `reason` when unverified.
- **Exit codes.** 0 `match`, 1 `mismatch` (an alert for a person; nothing is corrected), 2 `unverified` (the comparison could not be made: no token, no database, an unreachable or erroring HyperSync, an archive below `to`, a range above the cursor or wider than `--max-blocks`, default 100000, or more than 200000 logs). `unverified` never means `match`.
- **Does not.** It never writes the read-model (its store type has no write method) and never changes the indexer. It does not check which accounts are followed, because it reads that set from the store. It shares the handlers' decoding, so it checks log delivery and storage, not decoding. It covers the handlers the indexer registers from the same configuration: with `INDEXER_REALLOCATION_ADDRESS` set, the `AgentReallocation` handlers too (offline tests use a fake source for a reallocation log); without it, reallocation is not indexed and not checked. The x402 validator has no handler, so it is not covered.
- **Configuration.** `ENVIO_API_TOKEN` (required, environment only, never printed; error text has it removed), `ENVIO_HYPERSYNC_URL` (optional, https, default `https://10143.hypersync.xyz`), `DATABASE_URL` and the `INDEXER_*` variables above. Connect through a role that can read the read-model; the script only calls `events`, `cursor`, and `trackedAccounts`.
- **Verified on 2026-10-12.** HyperSync for Monad testnet is `https://10143.hypersync.xyz` (Envio's supported networks page). `GET /height` answers without a token; a query is refused without one, and with an unknown token it answers 403 "unknown or pending activation". The offline tests cover matching sets, a missing row, an extra row, a field mismatch, an unreachable source, and the response validation, with fakes only.
- **Not verified.** A run with a real token against the deployment range. Whether the free token's rate limit covers a range of this size, and whether HyperSync's block hashes equal the RPC's for Monad blocks, are hypotheses until that run.

## Finality

Checked against Monad's documentation on 2026-10-10 (`docs.monad.xyz`: Block States, JSON-RPC Overview, Deployment Summary for Developers):

- FACT (documented): the RPC maps `latest` to Proposed (speculative, no consensus vote), `safe` to Voted (supermajority vote; reverting it is described as theoretically possible but very unlikely), and `finalized` to Finalized (irreversible without a hard fork). `pending` behaves like `latest`.
- FACT (documented): blocks are finalized after two blocks, about 600 ms at the documented 300 ms block time. Verified (agreement on execution outputs) follows three blocks after Finalized; the docs advise exchanges, bridges, and issuers with significant off-chain financial logic to wait for Verified.
- FACT (documented): responses that include non-finalized data, `eth_getLogs` among them, can change on an identical later request.
- FACT (observed): on 2026-10-10 `https://testnet-rpc.monad.xyz` answered `eth_getBlockByNumber("finalized")` with a block, and the opt-in testnet test synced one batch against it in `finalized` mode.
- FACT (documented): `eth_getLogs` block-range limits depend on the provider: 100 blocks for QuickNode and the Monad Foundation endpoint, 1,000 for Alchemy (with 10,000 logs) and Ankr. The default batch of 100 fits all of them.
- ASSUMPTION: every RPC provider the indexer is pointed at serves `finalized` with the documented meaning. The startup check does not test this; a provider that reports no finalized block makes every batch retry, and `INDEXER_SYNC_TO=confirmations` is the explicit alternative.
- ASSUMPTION: Finalized, not Verified, is enough for this read-model, because nothing the indexer writes authorizes moving capital (`ARCHITECTURE.md` section 10). An agent's principal is derived from these rows and decides whether the agent trades and how far reallocation may fill it (`slot_ceiling` times principal), but it moves no capital itself: an agent only ever trades the balance already in its own account, and reallocation never crosses owners. A consumer that settles value from this data would need Verified, which is not implemented.
- ASSUMPTION: the `confirmations` default of 10 is a margin over the documented two-block finality, not a measured reorg depth.

## Running

`bun run --filter @monadeum/indexer test` builds and runs the offline tests against an in-memory chain (`test/mock-chain.ts`), including a reorg that removes an indexed `Spent` event and a tracked account and one that removes a funding transfer, and boot tests that run the service from its environment on PGlite, including a restart that resumes from the stored cursor. `test/testnet.test.ts` syncs one batch of Monad testnet and is skipped unless `INDEXER_TESTNET=1`; it needs `INDEXER_SPEND_POLICY_ADDRESS` and `INDEXER_SETTLEMENT_ASSET_ADDRESS` (any address works for a sync check) and optionally `INDEXER_RPC_URL`.

`node dist/src/main.js` runs the service after a build.

## Rebuilding the read-model

Needed to add or change an optional contract such as `INDEXER_REALLOCATION_ADDRESS` on a read-model that has already synced, or to change the settlement asset. It is an operator step, because no process role may delete read-model rows outside a reorg rollback:

1. Stop the indexer and the worker. The worker's principal job reads funding rows up to the finalized bound, so while the read-model is re-indexed from the start block it would see fewer deposits than the chain holds and could lower a principal until the indexer catches up.
2. As the database owner (`monadeum_owner` in the testnet deployment), `TRUNCATE chain_events, indexer_blocks, indexer_cursor, indexer_tracked_accounts, indexer_contracts;`, and also `indexer_settings` when the settlement asset changes.
3. Start the indexer with the new configuration and wait until its cursor (`indexer_cursor`, which the API's `GET /population` serves as `cursor`) reaches the chain's finalized block, then start the worker.

## Not done yet

- The testnet run above synced real blocks but indexed no rows, because the spend policy was not deployed there yet. It was deployed on 2026-10-11 (block 70167444, `contracts/deployments/monad-testnet.json`), and the first agent's `account.deployed`, `spend.limits-set`, and `spend.call-allowed` rows were indexed the same day.
- No identity registry exists yet (`ARCHITECTURE.md` section 9). The genome hash commitment contract, `AgentCommitments`, exists but is not deployed and has no handler: the worker reads it directly before every tick. An `AgentCommitted` handler is added when a read-model consumer needs it.
- The reallocation handlers are tested against an in-memory chain only. The testnet contract has emitted no `Reallocated` event, because reallocation is off there (`MONADEUM_REALLOCATION_ENABLED=false`), and the deployed read-model was synced without the contract, so indexing it there needs the rebuild above.

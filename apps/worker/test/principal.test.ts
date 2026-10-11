import assert from "node:assert/strict";
import { after, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import type { AgentRecord } from "@monadeum/agent-registry";
import { PgAgentStore, PgReadModelStore, migrate, pgliteDatabase, type Database, type Transaction } from "@monadeum/db";
import {
  ACCOUNT_DEPLOYED,
  InMemoryReadModelStore,
  SETTLEMENT_TRANSFER_IN,
  SETTLEMENT_TRANSFER_OUT,
  type ChainEvent,
  type SyncBatch,
} from "@monadeum/read-model";
import { KURU_TESTNET_MON_USDC as M } from "@monadeum/trading";
import type { Address, Hex } from "viem";
import { WorkerJobHandlers } from "../src/consumer/handlers.js";
import { MemoryAgentLocks } from "../src/consumer/locks.js";
import { MemoryJobQueue } from "../src/consumer/queue.js";
import { PrincipalSync } from "../src/principal.js";
import { UNIT, world } from "./harness.js";

// The principal job (EVOLUTION.md section 1.1): it recomputes each agent's principal from the finalized funding rows
// the indexer stores, and writes it as the worker. The first tests run on PGlite under the real roles: the indexer
// role writes the rows, the API role creates the agent, and the job reads and writes only as `monadeum_worker`. The
// last one runs the job through the consumer over the in-process harness and shows funding making an agent trade.

const USDC = "0x754704bc059f8c67012fed69bc8a327a5aafb603" as Address;
const OWNER = "0x00000000000000000000000000000000000000aa" as Address;
const ACCOUNT = "0x00000000000000000000000000000000000000bb" as Address;
const STRANGER = "0x00000000000000000000000000000000000000cc" as Address;
const hash = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as Hex;

let log = 0;
function row(block: number, kind: string, data: Record<string, string> = {}, address: Address = USDC, account: Address = ACCOUNT): ChainEvent {
  return { kind, account, address, blockNumber: BigInt(block), blockHash: hash(block), transactionHash: hash(1_000 + log), logIndex: log++, data };
}
const deployed = (block: number) => row(block, ACCOUNT_DEPLOYED, { factory: STRANGER, paymaster: STRANGER }, STRANGER);
const transferIn = (block: number, from: Address, value: bigint, token: Address = USDC) => row(block, SETTLEMENT_TRANSFER_IN, { from, to: ACCOUNT, value: value.toString() }, token);
const transferOut = (block: number, to: Address, value: bigint) => row(block, SETTLEMENT_TRANSFER_OUT, { from: ACCOUNT, to, value: value.toString() });

function batch(to: number, events: ChainEvent[], finalized = true): SyncBatch {
  const blocks = [...new Set([to, ...events.map((e) => Number(e.blockNumber))])].map((n) => ({ number: BigInt(n), hash: hash(n) }));
  return { events, blocks, discovered: [], cursor: { number: BigInt(to), hash: hash(to) }, pruneBelow: 0n, finalized };
}

function record(agentId: string): AgentRecord {
  return {
    agentId, owner: OWNER, account: ACCOUNT, genomeHash: hash(7),
    genome: { riskTolerance: 0.1, executionFrequency: 24, informationBudget: 0n, informationSources: [], pair: "MON/USDC", assetUniverse: ["MON/USDC"] },
    principal: 0n, status: "active",
  };
}

/** The same database with every statement run as `role`, as a process connecting through that role would. */
function asRole(db: Database, role: string): Database {
  const enter = (tx: Transaction) => tx.query(`SET LOCAL ROLE ${role}`);
  return {
    query: (text, params) => db.transaction(async (tx) => (await enter(tx), tx.query(text, params))),
    transaction: (fn) => db.transaction(async (tx) => (await enter(tx), fn(tx))),
  };
}

const pg = new PGlite();
const db = pgliteDatabase(pg);
await migrate(db);
after(() => pg.close());

async function fresh() {
  await db.query("TRUNCATE chain_events, indexer_blocks, indexer_cursor, indexer_tracked_accounts, worker_agent_states, worker_agents");
  await new PgAgentStore(asRole(db, "monadeum_api")).add(record("1"));
  const indexer = new PgReadModelStore(asRole(db, "monadeum_indexer"));
  const agents = new PgAgentStore(asRole(db, "monadeum_worker"));
  const locks = new MemoryAgentLocks();
  const sync = new PrincipalSync({ agents, readModel: new PgReadModelStore(asRole(db, "monadeum_worker")), settlementAsset: USDC, locks, lockTtlMs: 60_000 });
  return { indexer, agents, locks, sync };
}

test("as the worker role: a finalized owner deposit sets principal, a rerun writes nothing, and a withdrawal lowers it", async () => {
  const { indexer, agents, sync } = await fresh();
  await indexer.apply(batch(10, [
    deployed(5),
    transferIn(6, OWNER, 50n * UNIT),
    // A third party's deposit and another token's transfer from the owner: capital, never principal.
    transferIn(7, STRANGER, 9n * UNIT),
    transferIn(8, OWNER, 1_000n * UNIT, "0x5555555555555555555555555555555555555555"),
  ]));
  assert.deepEqual(await sync.run(), { asOf: 10n, updated: [{ agentId: "1", principal: 50n * UNIT }], skipped: [] });
  let agent = (await agents.get("1"))!;
  assert.equal(agent.principal, 50n * UNIT);
  assert.equal(agent.principalBlock, 10n);

  // Idempotent: the same rows give the same value, and nothing is written.
  await indexer.apply(batch(20, []));
  assert.deepEqual(await sync.run(), { asOf: 20n, updated: [], skipped: [] });
  assert.equal((await agents.get("1"))!.principalBlock, 10n);

  await indexer.apply(batch(30, [transferOut(25, OWNER, 20n * UNIT), transferOut(26, STRANGER, 5n * UNIT)]));
  assert.deepEqual((await sync.run()).updated, [{ agentId: "1", principal: 30n * UNIT }]);
  agent = (await agents.get("1"))!;
  assert.equal(agent.principal, 30n * UNIT);
  assert.equal(agent.principalBlock, 30n);
});

test("writes nothing without a finalized bound, and never a value computed through an earlier block than the last write", async () => {
  const { indexer, agents, sync } = await fresh();
  // Rows read under the confirmations rule are not finalized data.
  await indexer.apply(batch(10, [deployed(5), transferIn(6, OWNER, 50n * UNIT)], false));
  assert.deepEqual(await sync.run(), { asOf: null, updated: [], skipped: [] });
  assert.equal((await agents.get("1"))!.principal, 0n);

  // A record computed through block 100 is not overwritten from a read-model whose finalized bound is 20.
  const { indexer: again, agents: worker, sync: job } = await fresh();
  await worker.update({ ...record("1"), principal: 7n, principalBlock: 100n });
  await again.apply(batch(20, [deployed(5), transferIn(6, OWNER, 50n * UNIT)]));
  assert.deepEqual(await job.run(), { asOf: 20n, updated: [], skipped: ["1"] });
  assert.equal((await worker.get("1"))!.principal, 7n);
});

test("a locked agent is left for the next run", async () => {
  const { indexer, agents, locks, sync } = await fresh();
  await indexer.apply(batch(10, [deployed(5), transferIn(6, OWNER, 50n * UNIT)]));
  const release = (await locks.acquire(["1"]))!;
  assert.deepEqual(await sync.run(), { asOf: 10n, updated: [], skipped: ["1"] });
  await release();
  assert.deepEqual((await sync.run()).updated, [{ agentId: "1", principal: 50n * UNIT }]);
  assert.equal((await agents.get("1"))!.principal, 50n * UNIT);
});

test("end to end: an unfunded agent does not trade; a finalized owner deposit, through the principal job, makes it trade", async () => {
  const w = await world({ agents: [{ agentId: "1", owner: "a", capital: 0n }] });
  const created = (await w.stores.agents.get("1"))!;
  await w.stores.agents.update({ ...created, principal: 0n });
  const { worker } = await w.boot();
  const readModel = new InMemoryReadModelStore();
  const locks = new MemoryAgentLocks();
  const handlers = new WorkerJobHandlers({
    agents: w.stores.agents, runner: worker, queue: new MemoryJobQueue(), locks,
    settings: { tickIntervalMs: 1_000, evaluationDelayMs: 500, lockTtlMs: 60_000, lockRetryMs: 250 },
    clock: () => new Date(1_123),
    principal: new PrincipalSync({ agents: w.stores.agents, readModel, settlementAsset: M.quote, locks, lockTtlMs: 60_000 }),
  });

  await handlers.handle({ kind: "tick", agentId: "1", tick: 1 });
  assert.equal(await w.stores.ticks.get("1:1"), undefined, "an unfunded agent does not tick");
  assert.match((await handlers.handle({ kind: "principal" })).detail, /no finalized bound/);

  // The relayed EIP-3009 allocation lands: USDC moves from the owner wallet to the deployed account, and the indexer
  // stores it as finalized rows of the settlement asset. Here the rows are written as the indexer writes them.
  const account = w.accounts.get("1")!.toLowerCase() as Address;
  const owner = created.owner.toLowerCase() as Address;
  const amount = 50n * UNIT;
  w.token.mint(account, amount);
  const asset = M.quote.toLowerCase() as Address;
  await readModel.apply(batch(40, [
    { ...deployed(30), account },
    { ...transferIn(31, owner, amount, asset), account, data: { from: owner, to: account, value: amount.toString() } },
  ]));

  assert.match((await handlers.handle({ kind: "principal" })).detail, new RegExp(`changed 1=${amount}`));
  assert.equal((await w.stores.agents.get("1"))!.principal, amount);
  await handlers.handle({ kind: "tick", agentId: "1", tick: 2 });
  const tick = await w.stores.ticks.get("1:2");
  assert.ok(tick, "a funded agent ticks");
  assert.ok(w.sessionOps().length > 0, "and trades");
});

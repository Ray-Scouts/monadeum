import assert from "node:assert/strict";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { DatabaseConfigError, PgReadModelStore, pgliteDatabase, type Connect } from "@monadeum/db";
import type { AbiEvent, Address } from "viem";
import { entryPoint07Address } from "viem/account-abstraction";
import { entryPointEvents, spendPolicyEvents } from "../src/handlers/abi.js";
import { bootIndexer } from "../src/main.js";
import { InMemoryReadModelStore } from "../src/store.js";
import { SettlementAssetMismatchError } from "@monadeum/read-model";
import { MockChain, type LogSpec } from "./mock-chain.js";

const POLICY = "0x1111111111111111111111111111111111111111" as Address;
const ACCOUNT = "0x2222222222222222222222222222222222222222" as Address;
const FACTORY = "0xd703aae79538628d27099b8c4f621be4ccd142d5" as Address;
const env = {
  INDEXER_CHAIN_ID: "10143",
  INDEXER_SPEND_POLICY_ADDRESS: POLICY,
  INDEXER_SETTLEMENT_ASSET_ADDRESS: "0x4444444444444444444444444444444444444444",
  INDEXER_START_BLOCK: "1",
  INDEXER_SYNC_TO: "confirmations",
  INDEXER_CONFIRMATIONS: "0",
};

const named = (events: readonly AbiEvent[], name: string) => events.find((e) => e.name === name)!;

/** The deployment operation as WalletsModule sends it: deploy through the factory, then set limits. */
const deployment: LogSpec[] = [
  {
    address: entryPoint07Address.toLowerCase() as Address,
    event: entryPointEvents[0]!,
    args: { userOpHash: `0x${"ab".repeat(32)}`, sender: ACCOUNT, factory: FACTORY, paymaster: "0x0000000000000000000000000000000000000000" },
  },
  { address: POLICY, event: named(spendPolicyEvents, "LimitsSet"), args: { account: ACCOUNT, perTxCap: 5_000_000n, dailyCap: 20_000_000n } },
];

/** Hands out one PGlite instance as if it were the server DATABASE_URL names. */
const onto = (pg: PGlite): Connect => () => ({ db: pgliteDatabase(pg), close: async () => {} });

async function drain(indexer: { syncOnce(): Promise<{ status: string }> }) {
  for (let i = 0; i < 100; i++) if ((await indexer.syncOnce()).status === "idle") return;
  throw new Error("did not converge");
}

test("with DATABASE_URL, the indexer writes Postgres and a restarted indexer resumes after the stored cursor", async () => {
  const pg = new PGlite();
  try {
    const chain = new MockChain().mine(3).mine(1, [deployment]).mine(3);
    const logs: string[] = [];
    const first = await bootIndexer({ env: { ...env, DATABASE_URL: "postgres://test", DATABASE_MIGRATIONS: "apply" }, chain, connect: onto(pg), log: (m) => logs.push(m) });
    assert.equal(first.durable, true);
    assert.ok(first.store instanceof PgReadModelStore);
    assert.match(logs.join("\n"), /applied migrations: 0001_stores\.sql/);
    await drain(first.indexer);
    const cursor = await first.store.cursor();
    assert.equal(cursor?.number, 7n);
    assert.deepEqual((await first.store.events()).map((e) => e.kind), ["account.deployed", "spend.limits-set"]);
    await first.close();

    // A deployed indexer verifies the schema rather than migrating it, and starts from the stored cursor.
    chain.mine(2);
    const second = await bootIndexer({ env: { ...env, DATABASE_URL: "postgres://test" }, chain, connect: onto(pg) });
    assert.deepEqual(await second.store.cursor(), cursor);
    assert.deepEqual(await second.store.trackedAccounts(), [ACCOUNT]);
    assert.deepEqual(await second.indexer.syncOnce(), { status: "indexed", from: 8n, to: 9n, events: 0, caughtUp: true });
    assert.equal((await second.store.events()).length, 2);
    assert.equal(await second.store.settlementAsset(), env.INDEXER_SETTLEMENT_ASSET_ADDRESS);
    await second.close();

    // The same read-model under another settlement asset would mix two tokens' rows: the indexer refuses to start.
    await assert.rejects(
      bootIndexer({ env: { ...env, DATABASE_URL: "postgres://test", INDEXER_SETTLEMENT_ASSET_ADDRESS: "0x5555555555555555555555555555555555555555" }, chain, connect: onto(pg) }),
      SettlementAssetMismatchError,
    );
  } finally {
    await pg.close();
  }
});

test("in verify mode, the indexer refuses to start on an unmigrated database", async () => {
  const pg = new PGlite();
  try {
    await assert.rejects(bootIndexer({ env: { ...env, DATABASE_URL: "postgres://test" }, chain: new MockChain(), connect: onto(pg) }), /migrations not applied/);
  } finally {
    await pg.close();
  }
});

test("without DATABASE_URL, the indexer runs in memory and says so, except in production", async () => {
  const logs: string[] = [];
  const booted = await bootIndexer({ env, chain: new MockChain(), log: (m) => logs.push(m) });
  assert.equal(booted.durable, false);
  assert.ok(booted.store instanceof InMemoryReadModelStore);
  assert.match(logs.join("\n"), /not durable/);
  await booted.close();
  await assert.rejects(bootIndexer({ env: { ...env, MONADEUM_ENV: "production" }, chain: new MockChain() }), DatabaseConfigError);
});

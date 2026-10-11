import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { FakeChain } from "@monadeum/wallets/testing";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { PGlite } from "@electric-sql/pglite";
import { DatabaseConfigError, PgTickStore, PgTradeStore, pgliteDatabase, type Connect } from "@monadeum/db";
import { REALLOCATION_PRODUCTION_ACK, ReallocationService, ReallocationSwitchError } from "@monadeum/reallocation";
import { MemoryTickStore } from "@monadeum/tick";
import { WORKER_STORES, bootWorker, createWorker, type WorkerStores } from "../src/main.js";
import { world } from "./harness.js";

/** Hands out one PGlite instance as if it were the server DATABASE_URL names. */
const onto = (pg: PGlite): Connect => () => ({ db: pgliteDatabase(pg), close: async () => {} });

test("the worker boots as its own Nest context and does not listen for http", async () => {
  const app = await createWorker();
  assert.equal(typeof app.get, "function");
  await app.close();
});

test("the worker provides the reallocation module, which plans nothing without an owner policy", async () => {
  const app = await createWorker();
  const service = app.get(ReallocationService);
  const plan = service.plan(20, [
    { id: "a", owner: "o", status: "active", capital: 10, principal: 10, adjustedFitness: 1, flaggedZeroDownside: false },
    { id: "b", owner: "o", status: "active", capital: 10, principal: 10, adjustedFitness: -1, flaggedZeroDownside: false },
  ]);
  assert.deepEqual(plan.moves, []);
  await app.close();
});

test("without DATABASE_URL, the worker runs on in-memory stores and says state is not durable, except in production", async () => {
  const logs: string[] = [];
  const booted = await bootWorker({ env: {}, log: (m) => logs.push(m) });
  assert.equal(booted.stores.durable, false);
  assert.ok(booted.app.get<WorkerStores>(WORKER_STORES).ticks instanceof MemoryTickStore);
  assert.match(logs.join("\n"), /not durable/);
  await booted.close();
  await assert.rejects(bootWorker({ env: { MONADEUM_ENV: "production" } }), DatabaseConfigError);
});

test("the worker reads the reallocation switch at boot: off by default and said so, on only when set", async () => {
  const logs: string[] = [];
  const off = await bootWorker({ env: {}, log: (m) => logs.push(m) });
  assert.equal(off.reallocation.enabled, false);
  assert.match(off.reallocation.reason ?? "", /pre-registered study/);
  assert.match(logs.join("\n"), /reallocation is off/);
  await off.close();
  const on = await bootWorker({ env: { MONADEUM_REALLOCATION_ENABLED: "true" } });
  assert.equal(on.reallocation.enabled, true);
  await on.close();
  await assert.rejects(bootWorker({ env: { MONADEUM_REALLOCATION_ENABLED: "yes" } }), ReallocationSwitchError);
});

test("in production the worker refuses reallocation on without the study acknowledgement, before opening the database", async () => {
  let connected = false;
  const connect: Connect = () => {
    connected = true;
    throw new Error("must not connect");
  };
  const prod = { MONADEUM_ENV: "production", DATABASE_URL: "postgres://test", MONADEUM_REALLOCATION_ENABLED: "true" };
  await assert.rejects(bootWorker({ env: prod, connect }), /refusing to start without MONADEUM_REALLOCATION_PRODUCTION_ACK/);
  assert.equal(connected, false);
  // With the acknowledgement the switch passes and boot proceeds to the database.
  await assert.rejects(bootWorker({ env: { ...prod, MONADEUM_REALLOCATION_PRODUCTION_ACK: REALLOCATION_PRODUCTION_ACK }, connect }), /must not connect/);
  assert.equal(connected, true);
});

test("in verify mode, the worker refuses to start on an unmigrated database", async () => {
  const pg = new PGlite();
  try {
    await assert.rejects(bootWorker({ env: { DATABASE_URL: "postgres://test" }, connect: onto(pg) }), /migrations not applied/);
  } finally {
    await pg.close();
  }
});

test("with DATABASE_URL, ticks run over the Postgres stores, and a restarted worker reads them back", async () => {
  const pg = new PGlite();
  try {
    const first = await bootWorker({ env: { DATABASE_URL: "postgres://test", DATABASE_MIGRATIONS: "apply" }, connect: onto(pg) });
    assert.equal(first.stores.durable, true);
    const provided = first.app.get<WorkerStores>(WORKER_STORES);
    assert.ok(provided.ticks instanceof PgTickStore);
    assert.ok(provided.trades instanceof PgTradeStore);

    // The integration world, with its account, operation, sponsorship, trade, payment, and tick records in Postgres.
    const w = await world({ agents: [{ agentId: "1", owner: "a" }], stores: first.stores });
    const { worker } = await w.boot();
    for (let tick = 1; tick <= 3; tick++) await worker.tick("1", tick);
    const executed = (await first.stores.trades.get("1:1"))?.status;
    assert.equal(executed, "filled");
    await first.close();

    const second = await bootWorker({ env: { DATABASE_URL: "postgres://test" }, connect: onto(pg) });
    assert.equal((await second.stores.ticks.get("1:3"))?.status, "recorded");
    assert.equal((await second.stores.trades.get("1:1"))?.status, "filled");
    assert.ok(await second.stores.payments.get("1:1:nansen:/signal?pair=MON%2FUSDC"));
    assert.equal((await second.stores.wallets.get("1"))?.deployment.status, "deployed");
    const { rows } = await pgliteDatabase(pg).query<{ n: number }>("SELECT count(*)::int AS n FROM wallet_tick_operations WHERE agent_id = '1'");
    assert.ok(rows[0]!.n >= 1);
    await second.close();
  } finally {
    await pg.close();
  }
});

// WalletsModule over the local encrypted vault (testnet and local development only).

const walletsEnv = (root: string) => ({
  WALLETS_CHAIN_ID: "10143",
  WALLETS_BUNDLER_URL: "https://bundler.example",
  WALLETS_PAYMASTER_URL: "https://paymaster.example",
  WALLETS_SETTLEMENT_ASSET: "0x00000000000000000000000000000000000000a1",
  WALLETS_KURU_ROUTER: "0x00000000000000000000000000000000000000b1",
  WALLETS_KURU_ROUTER_SELECTORS: "0x12345678",
  WALLETS_REALLOCATION_CONTRACT: "0x00000000000000000000000000000000000000c1",
  WALLETS_REALLOCATION_SELECTORS: "0x9abcdef0",
  WALLETS_SPONSORED_OPERATIONS: "10",
  WALLETS_SPONSORED_GAS_WEI: "100000",
  WALLETS_SPEND_POLICY_ADDRESS: "0x00000000000000000000000000000000000000f0",
  WALLETS_SESSION_VAULT_DIR: path.join(root, "session"),
  WALLETS_SESSION_VAULT_PASSPHRASE: "a testnet passphrase, not a real one",
});
const cheap = { N: 2 ** 10, r: 8, p: 1 };

test("without WALLETS_CHAIN_ID the worker has no WalletsModule; with it and a file vault, it builds one over its own stores", async () => {
  const off = await bootWorker({ env: {} });
  assert.equal(off.wallets, null);
  await off.close();

  const root = await mkdtemp(path.join(tmpdir(), "monadeum-worker-vault-"));
  try {
    const logs: string[] = [];
    const booted = await bootWorker({ env: walletsEnv(root), wallets: { chain: new FakeChain(), scrypt: cheap }, log: (m) => logs.push(m) });
    assert.ok(booted.wallets);
    assert.match(logs.join("\n"), /WalletsModule configured/);
    const account = privateKeyToAccount(generatePrivateKey());
    const deployed = await booted.wallets.deploy({ agentId: "agent-1", owner: { address: account.address, signer: account }, index: 0n, limits: { perTxCap: 1n, dailyCap: 1n } });
    assert.equal(deployed.ok, true);
    assert.equal((await booted.stores.wallets.get("agent-1"))?.deployment.status, "deployed", "the service writes the worker's wallet store");
    await booted.close();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the worker refuses the file vault with MONADEUM_ENV=production, before opening the database", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "monadeum-worker-vault-"));
  try {
    let connected = false;
    const connect: Connect = () => {
      connected = true;
      throw new Error("must not connect");
    };
    await assert.rejects(
      bootWorker({ env: { ...walletsEnv(root), MONADEUM_ENV: "production", DATABASE_URL: "postgres://test" }, connect, wallets: { chain: new FakeChain(), scrypt: cheap } }),
      /testnet and local development only/,
    );
    assert.equal(connected, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { DatabaseConfigError, PgTickStore, PgTradeStore, pgliteDatabase, type Connect } from "@monadeum/db";
import { ReallocationService } from "@monadeum/reallocation";
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

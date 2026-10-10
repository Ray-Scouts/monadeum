import assert from "node:assert/strict";
import { test } from "node:test";
import type { SellFill, SellOrder } from "@monadeum/trading";
import { DECIMALS, assertOnlyApprovedPlansSent, world } from "./harness.js";

// Closing a position through the worker loop over the real modules (see harness.ts). A "flat" decision with a
// position open sells all of it through Kuru, under the same plan, policy, signer, and reconciliation path as a buy.

type World = Awaited<ReturnType<typeof world>>;

const one = () => world({ market: "wrapped", information: false, agents: [{ agentId: "1", owner: "a" }] });
const sessions = (w: World) => w.sessionOps().length;
const units = (v: bigint) => Number(v) / 10 ** DECIMALS;

/** Tick 1 buys 10 USDC of the base at the 1.01 ask, against a 1.00 mid. Tick 2 is inside the execution interval. */
async function opened(w: World, booted?: Awaited<ReturnType<World["boot"]>>) {
  const { worker } = booted ?? (await w.boot());
  assert.equal((await worker.tick("1", 1))?.action, "executed");
  assert.equal((await worker.tick("1", 2))?.action, "none");
}

test("round trip: buy, then a flat decision sells the whole position, and fitness gets realized P&L net of costs", async () => {
  const w = await one();
  const account = w.accounts.get("1")!;
  const start = await w.token.balanceOf(account);
  const booted = await w.boot();
  const { worker, trading, risk } = booted;
  await opened(w, booted);
  const bought = await trading.position("1");
  assert.equal(bought.size, w.kuru.baseOf(account));
  assert.ok(bought.size > 0n);

  // The market moves up to 1.09 / 1.11, and the signal turns: the strategy's exit decision.
  w.kuru.bid = 109n * 10n ** 16n;
  w.kuru.ask = 111n * 10n ** 16n;
  w.setSignal("1", -0.01);
  const close = await worker.tick("1", 3);
  assert.equal(close?.action, "executed");
  const record = (await w.stores.trades.get("1:3"))!;
  const order = record.order as SellOrder;
  const fill = record.fill as SellFill;
  assert.deepEqual([order.side, order.baseIn, fill.baseIn], ["sell", bought.size, bought.size], "sold exactly the open size");
  assert.equal(w.kuru.baseOf(account), 0n);
  const position = await trading.position("1");
  assert.deepEqual([position.size, position.basis, position.closing], [0n, 0n, null]);

  // Realized at reference prices: the base is worth 1.10 a unit at the close's mid, and cost 1.00 at the buy's.
  const buy = (await w.stores.trades.get("1:1"))!;
  const expected = (bought.size * 110n) / 10n ** 14n - bought.basis;
  assert.equal(position.realized, expected);
  assert.ok(expected > 0n);

  // Fitness: realized P&L minus fees, slippage, and gas is the settlement asset received minus that paid, less gas.
  const state = await w.stores.agents.state("1");
  const gas = units(buy.costs!.gas + record.costs!.gas);
  const cash = units((await w.token.balanceOf(account)) - start) - gas;
  assert.ok(Math.abs(state.net - cash) < 1e-9, `net ${state.net} vs cash ${cash}`);
  assert.equal(state.tradeCounts.filter((c) => c === 1).length, 2, "the close counts as a trade");
  assert.equal(sessions(w), 2);
  assertOnlyApprovedPlansSent(w, risk.approved);

  // Nothing left to close: the next flat decision (tick 5, after the interval) is no action, and nothing is sent.
  await worker.tick("1", 4);
  const after = await worker.tick("1", 5);
  assert.equal(after?.outcome?.kind, "no-action");
  assert.equal(sessions(w), 2);
});

test("a crash mid-close never sells twice: other ticks wait, and the restart reconciles the one close", async () => {
  const w = await one();
  const account = w.accounts.get("1")!;
  await opened(w);
  w.setSignal("1", -0.01);
  // The bundler accepts the close, then the response is lost.
  w.chain.options.submit = "accepted-then-throw";
  const first = await w.boot();
  assert.equal((await first.worker.tick("1", 3))?.action, "pending");
  w.chain.options.submit = "ok";

  // A later tick decides to close again while the first close's outcome is unknown: refused before any plan exists.
  const second = await w.boot();
  const waiting = await second.worker.tick("1", 4);
  assert.equal(waiting?.outcome?.kind === "failed" && waiting.outcome.step, "plan");
  assert.equal(waiting?.outcome?.kind === "failed" && waiting.outcome.reason, "close-pending");
  assert.equal(await w.stores.trades.get("1:4"), undefined);

  // Still in the mempool: rerunning the close's own key waits, never resends.
  assert.equal((await second.worker.tick("1", 3))?.action, "pending");
  w.chain.mine();
  const third = await w.boot();
  assert.equal((await third.worker.tick("1", 3))?.action, "executed");
  assert.equal(sessions(w), 2, "one buy and one sell were included");
  assert.equal(w.kuru.baseOf(account), 0n);
  const position = await third.trading.position("1");
  assert.deepEqual([position.size, position.closing], [0n, null]);
  await third.worker.tick("1", 6);
  assert.equal((await third.worker.tick("1", 7))?.outcome?.kind, "no-action", "a flat decision with nothing open");
  assert.equal(sessions(w), 2);
});

test("a crash after the close filled, while measuring: the restart realizes the P&L once", async () => {
  const w = await one();
  await opened(w);
  w.kuru.bid = 109n * 10n ** 16n;
  w.kuru.ask = 111n * 10n ** 16n;
  w.setSignal("1", -0.01);
  const first = await w.boot();
  const original = w.stores.ticks.write.bind(w.stores.ticks);
  let crash = true;
  w.stores.ticks.write = async (record) => {
    if (crash && record.key === "1:3" && record.status === "recorded") throw new Error("worker crashed after measuring");
    return original(record);
  };
  await assert.rejects(first.worker.tick("1", 3), /crashed/);
  crash = false;
  const { worker, trading } = await w.boot();
  assert.equal((await worker.tick("1", 3))?.action, "executed");
  const state = await w.stores.agents.state("1");
  assert.equal(state.returns.length, 3, "ticks 1, 2, and 3, each measured once");
  const realized = (await trading.position("1")).realized;
  assert.ok(realized > 0n);
  assert.equal(await trading.settle((await w.stores.trades.get("1:3"))!), realized, "settled once; settling again returns the same figure");
  assert.equal(sessions(w), 2);
});

test("the RiskModule checks a close: a policy without the traded asset rejects it, and nothing is sent", async () => {
  const w = await world({ market: "wrapped", information: false, tradedAssetInPolicy: false, agents: [{ agentId: "1", owner: "a" }] });
  await opened(w);
  w.setSignal("1", -0.01);
  const { worker, risk } = await w.boot();
  const result = await worker.tick("1", 3);
  assert.equal(result?.outcome?.kind === "failed" && result.outcome.step, "policy");
  assert.deepEqual(result?.outcome?.kind === "failed" && result.outcome.violations, ["call-not-allowed"]);
  assert.equal((await w.stores.trades.get("1:3"))?.failure?.kind, "policy");
  assert.equal(sessions(w), 1, "only the buy");
  assert.equal(risk.approved.length, 0);
  const position = await w.stores.positions.get("1");
  assert.ok(position && position.size > 0n && position.closing === null, "the position stays open and unmarked");
});

test("on the configured native-MON market a close is not built: the sell would need native value", async () => {
  const w = await world({ information: false, agents: [{ agentId: "1", owner: "a" }] });
  await opened(w);
  w.setSignal("1", -0.01);
  const { worker } = await w.boot();
  const result = await worker.tick("1", 3);
  assert.equal(result?.outcome?.kind === "failed" && result.outcome.reason, "native-sell");
  assert.equal(sessions(w), 1);
});

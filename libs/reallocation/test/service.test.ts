import assert from "node:assert/strict";
import { test } from "node:test";
import { EVALUATION_CADENCE, RETIREMENT_WINDOWS } from "../src/constants.js";
import type { AgentState } from "../src/plan.js";
import { groupDebits, toBaseUnits } from "../src/debits.js";
import { MemoryPolicyStore, type ReallocationSettlement, type SourceDebit } from "../src/ports.js";
import { ReallocationService } from "../src/reallocation.service.js";
import { belowCapitalFloor, evaluateRetirement } from "../src/retirement.js";

const population: AgentState[] = [
  { id: "top", owner: "o1", status: "active", capital: 10, principal: 10, adjustedFitness: 1, flaggedZeroDownside: false },
  { id: "low", owner: "o1", status: "active", capital: 10, principal: 10, adjustedFitness: -1, flaggedZeroDownside: false },
];

test("planning runs only on the evaluation cadence", () => {
  const service = new ReallocationService();
  assert.throws(() => service.plan(7, population), /off_cadence/);
  assert.throws(() => service.plan(0, population), /off_cadence/);
  assert.doesNotThrow(() => service.plan(EVALUATION_CADENCE, population));
});

test("the default service has no policies, so it plans nothing", () => {
  const plan = new ReallocationService().plan(EVALUATION_CADENCE, population);
  assert.equal(plan.moved, 0);
  assert.deepEqual(plan.moves, []);
});

test("a revoked policy moves nothing from the next evaluation", () => {
  const store = new MemoryPolicyStore();
  store.set({ owner: "o1", agents: ["top", "low"] });
  const service = new ReallocationService(store);
  assert.equal(service.plan(EVALUATION_CADENCE, population).moves.length, 1);
  store.revoke("o1");
  assert.deepEqual(service.plan(2 * EVALUATION_CADENCE, population).moves, []);
});

test("settlement submits one debit per source in base units and records failures without retrying", async () => {
  const store = new MemoryPolicyStore();
  store.set({ owner: "o1", agents: ["top", "low"] });
  const calls: SourceDebit[] = [];
  const ok: ReallocationSettlement = {
    async debit(request) {
      calls.push(request);
    },
  };
  const service = new ReallocationService(store, ok);
  const plan = service.plan(EVALUATION_CADENCE, population);
  const settled = await service.settle(7, plan, 6);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.key, "o1:7:low");
  assert.deepEqual(calls[0]?.credits, [{ sink: "top", amount: 2_000_000n }]);
  assert.equal(calls[0]?.total, 2_000_000n);
  assert.equal(settled[0]?.ok, true);

  const failing = new ReallocationService(store);
  const failed = await failing.settle(8, plan, 6);
  assert.equal(failed.length, 1);
  assert.equal(failed[0]?.ok, false);
  assert.match(failed[0]?.error ?? "", /not configured/);
});

test("a source with several sinks is one debit carrying every credit, rounded down, and conserving capital exactly", () => {
  const plan = {
    owners: [],
    moved: 0.6666666666666666,
    moves: [
      { owner: "o1", source: "a", sink: "x", amount: 0.3333333333333333 },
      { owner: "o1", source: "a", sink: "y", amount: 0.3333333333333333 },
      { owner: "o1", source: "b", sink: "x", amount: 0.0000004 },
      { owner: "o2", source: "c", sink: "z", amount: 1.000000999 },
    ],
  };
  const debits = groupDebits(4, plan, 6);
  assert.deepEqual(debits.map((d) => d.key), ["o1:4:a", "o2:4:c"]);
  assert.deepEqual(debits[0]?.credits, [{ sink: "x", amount: 333_333n }, { sink: "y", amount: 333_333n }]);
  assert.equal(debits[0]?.total, 666_666n);
  assert.equal(debits[1]?.total, 1_000_000n);
  for (const d of debits) assert.equal(d.credits.reduce((s, c) => s + c.amount, 0n), d.total);
});

test("conversion to base units never rounds up", () => {
  assert.equal(toBaseUnits(1.000000999, 6), 1_000_000n);
  assert.equal(toBaseUnits(0, 6), 0n);
  for (let i = 0; i < 1000; i++) {
    const amount = Math.random() * 1000;
    const units = toBaseUnits(amount, 6);
    assert.ok(Number(units) / 1e6 <= amount);
    assert.ok(amount - Number(units) / 1e6 < 2e-6);
  }
  assert.throws(() => toBaseUnits(Number.NaN, 6));
  assert.throws(() => toBaseUnits(-1, 6));
});

test("retirement: below the capital floor", () => {
  assert.equal(belowCapitalFloor(0.059), true);
  assert.equal(belowCapitalFloor(0.06), false);
  const decision = evaluateRetirement({ capital: 0.05, adjustedFitness: 1, nicheFitness: [1, 0], lowFitnessWindows: 0 });
  assert.deepEqual(decision, { retire: true, reason: "capital_floor", lowFitnessWindows: 0 });
});

test("retirement: starvation after K consecutive bottom-decile windows, reset by recovery", () => {
  const niche = Array.from({ length: 20 }, (_, i) => i);
  let low = 0;
  for (let window = 1; window < RETIREMENT_WINDOWS; window++) {
    const decision = evaluateRetirement({ capital: 10, adjustedFitness: 0, nicheFitness: niche, lowFitnessWindows: low });
    assert.equal(decision.retire, false);
    low = decision.lowFitnessWindows;
    assert.equal(low, window);
  }
  const recovered = evaluateRetirement({ capital: 10, adjustedFitness: 10, nicheFitness: niche, lowFitnessWindows: low });
  assert.deepEqual(recovered, { retire: false, reason: null, lowFitnessWindows: 0 });
  const starved = evaluateRetirement({ capital: 10, adjustedFitness: 0, nicheFitness: niche, lowFitnessWindows: low });
  assert.deepEqual(starved, { retire: true, reason: "starvation", lowFitnessWindows: RETIREMENT_WINDOWS });
});

test("retirement: a window without fitness leaves the count unchanged, and the owner can always retire", () => {
  const held = evaluateRetirement({ capital: 10, adjustedFitness: null, nicheFitness: [], lowFitnessWindows: 2 });
  assert.deepEqual(held, { retire: false, reason: null, lowFitnessWindows: 2 });
  const owner = evaluateRetirement({ capital: 10, adjustedFitness: null, nicheFitness: [], lowFitnessWindows: 0, ownerRequested: true });
  assert.equal(owner.reason, "owner");
});

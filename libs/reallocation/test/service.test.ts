import assert from "node:assert/strict";
import { test } from "node:test";
import { EVALUATION_CADENCE, RETIREMENT_WINDOWS } from "../src/constants.js";
import type { AgentState } from "../src/plan.js";
import { MemoryPolicyStore, type ReallocationSettlement, type TransferRequest } from "../src/ports.js";
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

test("settlement submits one idempotent transfer per move and records failures without retrying", () => {
  const store = new MemoryPolicyStore();
  store.set({ owner: "o1", agents: ["top", "low"] });
  const calls: TransferRequest[] = [];
  const ok: ReallocationSettlement = {
    transfer(request) {
      calls.push(request);
      return { amount: request.amount };
    },
  };
  const service = new ReallocationService(store, ok);
  const plan = service.plan(EVALUATION_CADENCE, population);
  const settled = service.settle(7, plan);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.key, "o1:7:low:top");
  assert.equal(settled[0]?.ok, true);

  const failing = new ReallocationService(store);
  const failed = failing.settle(8, plan);
  assert.equal(failed.length, 1);
  assert.equal(failed[0]?.ok, false);
  assert.match(failed[0]?.error ?? "", /not configured/);
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

import assert from "node:assert/strict";
import { test } from "node:test";
import { run, type RunResult } from "../src/index.js";
import { planReallocation } from "../src/reallocation.js";
import { compareSlotCells, runSlotCell, SLOT_ARMS, slotRunConfig } from "../src/slots.js";
import type { Regime } from "../src/types.js";

/** Every change in total capital must come from trading and cost flows, never from replacement or reallocation. */
function assertConserved(result: RunResult): void {
  const { grossPnl, fees, slippage, gas, x402 } = result.ledger;
  const flows = grossPnl - fees - slippage - gas - x402;
  assert.ok(
    Math.abs(result.totalCapital - result.startingCapital - flows) < 1e-6,
    `${result.mode}: ${result.totalCapital - result.startingCapital} vs ${flows}`,
  );
}

const regimes: Regime[] = ["trending", "stress_flash_crash"];

test("capital is conserved in every arm, and no fixed-slot arm creates an account", () => {
  for (const regime of regimes) {
    for (const arm of Object.values(SLOT_ARMS)) {
      const result = run(slotRunConfig(arm, 0.006, 100, regime, 2));
      assertConserved(result);
      if (arm.kind !== "evolving") {
        assert.equal(result.endPopulation, 100);
        assert.equal(result.reproductions, 0);
        assert.ok(result.agents.every((agent) => agent.id.startsWith("a")));
      }
    }
  }
});

test("the mechanisms under test actually fire, so conservation is not vacuous", () => {
  const random = run(slotRunConfig(SLOT_ARMS.C2!, 0.006, 100, "trending", 2));
  const mutant = run(slotRunConfig(SLOT_ARMS.A!, 0.006, 100, "trending", 2));
  const reallocating = run(slotRunConfig(SLOT_ARMS["B-c0.2-x2"]!, 0.006, 100, "trending", 2));
  assert.ok((random.slots?.replacements ?? 0) > 0);
  assert.equal(random.slots?.noDonor, 0);
  assert.ok((mutant.slots?.replacements ?? 0) > 0);
  assert.equal(mutant.slots?.capitalMoved, 0);
  assert.ok(mutant.agents.some((agent) => agent.parent !== null), "a mutant slot records its donor");
  assert.ok((reallocating.slots?.capitalMoved ?? 0) > 0);
  assert.ok((reallocating.slots?.reallocations ?? 0) > 0);
});

test("replacement and reallocation conserve capital even with every cost and edge at zero", () => {
  const zero = { gasUsd: 0, x402Usd: 0, feeBps: 0, slippageBps: 0, infoEdge: 0 };
  for (const arm of [SLOT_ARMS.C2!, SLOT_ARMS.A!, SLOT_ARMS["B-c0.2-x4"]!]) {
    const config = slotRunConfig(arm, 0, 100, "choppy", 3);
    const result = run({ ...config, costs: zero });
    assert.ok(Math.abs(result.ledger.x402 + result.ledger.gas + result.ledger.fees + result.ledger.slippage) === 0);
    assertConserved(result);
  }
});

test("a reallocation plan respects the cap, the floor, and the ceiling, and moves equal debits and credits", () => {
  const cases: [number[], { capital: number; principal: number }[], number, number][] = [
    [[10, 4, 0.07, 0.06, 0], [{ capital: 12, principal: 10 }, { capital: 19.9, principal: 10 }], 0.2, 2],
    [[10, 10, 10], [{ capital: 39, principal: 10 }], 0.05, 4],
    [[1, 2, 3], [{ capital: 25, principal: 10 }], 0.2, 2],
    [[5, 8], [{ capital: 10, principal: 10 }, { capital: 11, principal: 10 }, { capital: 30, principal: 10 }], 0.2, 4],
  ];
  for (const [sources, sinks, cap, ceiling] of cases) {
    const plan = planReallocation(sources, sinks, cap, ceiling, 0.06);
    const debits = plan.debits.reduce((sum, value) => sum + value, 0);
    const credits = plan.credits.reduce((sum, value) => sum + value, 0);
    assert.ok(Math.abs(debits - plan.moved) < 1e-12 && Math.abs(credits - plan.moved) < 1e-12);
    sources.forEach((capital, index) => {
      const debit = plan.debits[index] ?? 0;
      assert.ok(debit >= 0 && debit <= cap * capital + 1e-12);
      if (debit > 0) assert.ok(capital - debit >= 0.06 - 1e-12);
    });
    sinks.forEach((sink, index) => {
      const credit = plan.credits[index] ?? 0;
      assert.ok(credit >= 0);
      assert.ok(sink.capital + credit <= Math.max(sink.capital, ceiling * sink.principal) + 1e-12);
    });
  }
  assert.equal(planReallocation([10], [{ capital: 25, principal: 10 }], 0.2, 2, 0.06).moved, 0);
});

test("the slots setting is ignored outside slots mode, and slots mode rejects a bad configuration", () => {
  const base = slotRunConfig(SLOT_ARMS.C1!, 0.006, 20, "choppy", 1);
  assert.deepEqual(run({ ...base, slots: { refill: "mutant", reallocationCap: 0.2, slotCeiling: 2 } }), run(base));
  assert.throws(() => run({ ...base, mode: "slots" }), RangeError);
  assert.throws(() => run({ ...base, mode: "slots", slots: { refill: "mutant", reallocationCap: 0.2 } }), RangeError);
  assert.throws(() => run({ ...base, mode: "slots", slots: { refill: "mutant", reallocationCap: 2, slotCeiling: 2 } }), RangeError);
});

test("every arm shares founders and the market path on a seed, and the comparison pairs them", () => {
  const c1 = runSlotCell(SLOT_ARMS.C1!, 0.006, 10, "choppy", 3);
  const a = runSlotCell(SLOT_ARMS.A!, 0.006, 10, "choppy", 3);
  assert.deepEqual(
    c1.seeds.map((seed) => seed.trace[0]),
    a.seeds.map((seed) => seed.trace[0]),
  );
  const row = compareSlotCells(a, c1);
  assert.equal(row.seeds, 3);
  assert.ok(Math.abs(row.gap - (row.armMean - row.controlMean)) < 1e-12);
});

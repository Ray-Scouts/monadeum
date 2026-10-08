import assert from "node:assert/strict";
import { test } from "node:test";
import { createReproductionModule, run, type ReproductionModule, type RunResult } from "../src/index.js";
import { treasuryFor } from "../src/rerun.js";

// Issue #82 settings (PR #81 arm A at h = 1) at a size where reproduction occurs.
const base = {
  seed: 5,
  population: 100,
  ticks: 300,
  regime: "trending" as const,
  mode: "evolving" as const,
  genome: { riskTolerance: 0.25, executionFrequency: 1 },
  costs: { x402Usd: 0.01 },
  reproduction: createReproductionModule({ profitThresholdFraction: 0.1 }),
  skillHeritability: 1,
};

const children = (result: RunResult) => result.agents.filter((agent) => agent.parent !== null);

/** Every change in total capital must come from trading and cost flows, never from reproduction or the treasury. */
function assertConserved(result: RunResult): void {
  const { grossPnl, fees, slippage, gas, x402 } = result.ledger;
  const flows = grossPnl - fees - slippage - gas - x402;
  assert.ok(Math.abs(result.totalCapital - result.startingCapital - flows) < 1e-6);
  assert.ok(Math.abs(result.treasury.initial - result.treasury.remaining - result.treasury.spent) < 1e-9);
}

test("fraction 0.5, m = 0, and no treasury are identical to leaving them unset", () => {
  const unset = run(base);
  assert.ok(unset.reproductions > 0, "the fixture must reproduce for this test to mean anything");
  assert.deepEqual(run({ ...base, reproductionFraction: 0.5, minChildCapital: 0, treasury: 0 }), unset);
  assert.equal(unset.gates.failed.min_child_capital, undefined);
});

test("the m gate holds every child at or above m and is recorded in the gate accounting", () => {
  const result = run({ ...base, minChildCapital: 1 });
  assert.ok(children(result).length > 0);
  for (const child of children(result)) assert.ok(child.principal >= 1);
  assert.ok((result.gates.failed.min_child_capital ?? 0) > 0);
  assert.ok(result.reproductions < run(base).reproductions);
});

test("fraction 1 gives the child the whole profit and never takes a parent below its principal", () => {
  const real = createReproductionModule({ profitThresholdFraction: 0.1 });
  let funded = 0;
  const wrapped: ReproductionModule = {
    evaluate: (input) => real.evaluate(input),
    allocate(input) {
      const out = real.allocate(input);
      assert.equal(input.fraction, 1);
      if (out.childCapital > 0) {
        funded += 1;
        assert.ok(out.parentCapitalAfter >= input.principal);
        const profit = input.capital - input.principal;
        assert.equal(out.childCapital, Math.min(profit, input.maxChildCapital));
      }
      return out;
    },
    mutate: (input) => real.mutate(input),
  };
  const result = run({ ...base, reproduction: wrapped, reproductionFraction: 1 });
  assert.ok(funded > 0 && result.reproductions > 0);
  assertConserved(result);
});

test("the treasury tops every child up to m and conserves total capital in both modes", () => {
  const treasury = treasuryFor(2.5, base.population);
  assert.equal(treasury, 250);
  const evolving = run({ ...base, minChildCapital: 2.5, treasury });
  const idle = run({ ...base, mode: "static", minChildCapital: 2.5, treasury });
  assert.equal(evolving.startingCapital, idle.startingCapital);
  assert.equal(evolving.startingCapital, 1000 + 250);
  assert.ok(evolving.treasury.topUps > 0 && evolving.treasury.spent > 0);
  for (const child of children(evolving)) assert.ok(Math.abs(child.principal - 2.5) < 1e-9 || child.principal > 2.5);
  assert.deepEqual(idle.treasury, { initial: 250, remaining: 250, spent: 0, topUps: 0 });
  assertConserved(evolving);
  assertConserved(idle);
  // The static run is the PR #81 static run plus idle cash.
  const plain = run({ ...base, mode: "static" });
  assert.ok(Math.abs(idle.totalCapital - plain.totalCapital - 250) < 1e-9);
});

test("an exhausted treasury falls back to the plain m gate", () => {
  const result = run({ ...base, minChildCapital: 2.5, treasury: 3 });
  assert.ok(result.treasury.topUps > 0);
  assert.ok(result.treasury.remaining >= 0 && result.treasury.spent <= 3);
  for (const child of children(result)) assert.ok(child.principal >= 2.5 - 1e-9);
  assertConserved(result);
});

test("out-of-range experiment parameters are rejected", () => {
  const short = { ...base, ticks: 1 };
  for (const bad of [0, -0.1, 1.01, Number.NaN]) assert.throws(() => run({ ...short, reproductionFraction: bad }), RangeError);
  for (const bad of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => run({ ...short, minChildCapital: bad }), RangeError);
    assert.throws(() => run({ ...short, treasury: bad }), RangeError);
  }
});

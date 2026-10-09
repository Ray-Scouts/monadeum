import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createReproductionModule,
  run,
  type AgentSnapshot,
  type Genome,
  type ReproductionModule,
} from "../src/index.js";
import { runThresholdGrid } from "../src/threshold.js";

const genome: Genome = {
  strategyType: "trading",
  assetUniverse: ["PAIR_A"],
  riskTolerance: 0.1,
  executionFrequency: 5,
  timeHorizon: 20,
  entryThreshold: 0,
  exitThreshold: 0,
  informationSources: ["nansen"],
  informationBudget: 0.05,
  modelConfiguration: "low",
};

const agent: AgentSnapshot = {
  id: "a",
  capital: 12,
  principal: 10,
  adjustedFitness: 1,
  rawSortino: 1,
  flaggedZeroDownside: false,
  tradeCount: 30,
  status: "active",
  descendants: 0,
  ticksSinceReproduction: 80,
  genome,
};

test("the profit threshold override moves only the profit gate", () => {
  const input = { agent, reference: [agent], populationSize: 4, populationCap: 50, nowTick: 100, requiredPercentile: 0.5 };
  const strict = createReproductionModule().evaluate(input);
  const loose = createReproductionModule({ profitThresholdFraction: 0.1 }).evaluate(input);
  assert.deepEqual(strict.failed, ["profit"]);
  assert.deepEqual(loose.failed, []);
  assert.equal(loose.eligible, true);
});

test("the runner counts each failed gate and the sole blocker for active parents", () => {
  const inner = createReproductionModule();
  const blocked: ReproductionModule = {
    evaluate: () => ({ eligible: false, failed: ["profit"] }),
    allocate: (input) => inner.allocate(input),
    mutate: (input) => inner.mutate(input),
  };
  const out = run({ seed: 2, population: 4, ticks: 60, regime: "choppy", mode: "evolving", reproduction: blocked });
  assert.equal(out.gates.evaluations, 12);
  assert.equal(out.gates.failed.profit, 12);
  assert.equal(out.gates.sole.profit, 12);

  const both: ReproductionModule = { ...blocked, evaluate: () => ({ eligible: false, failed: ["profit", "n_min"] }) };
  const two = run({ seed: 2, population: 4, ticks: 60, regime: "choppy", mode: "evolving", reproduction: both });
  assert.equal(two.gates.failed.n_min, 12);
  assert.equal(two.gates.sole.profit, undefined);

  const still = run({ seed: 2, population: 4, ticks: 60, regime: "choppy", mode: "static" });
  assert.equal(still.gates.evaluations, 0);
});

test("an eligible parent with no profit to give is counted as an allocation failure", () => {
  const inner = createReproductionModule();
  const open: ReproductionModule = {
    evaluate: () => ({ eligible: true, failed: [] }),
    allocate: () => ({ childCapital: 0, parentCapitalAfter: 10 }),
    mutate: (input) => inner.mutate(input),
  };
  const out = run({ seed: 2, population: 4, ticks: 20, regime: "choppy", mode: "evolving", reproduction: open });
  assert.equal(out.reproductions, 0);
  assert.equal(out.gates.failed.allocation, out.gates.evaluations);
});

test("the threshold grid writes one cell per population, regime, fraction, and price", () => {
  const cells = runThresholdGrid({
    populations: [4],
    regimes: ["trending", "stress_flash_crash"],
    profitThresholdFractions: [0, 0.5],
    x402Prices: [0.01, 0.1],
    seeds: 2,
    ticks: 60,
  });
  assert.equal(cells.length, 8);
  for (const cell of cells) {
    assert.ok(cell.reproducingShare >= 0 && cell.reproducingShare <= 1);
    assert.ok(cell.evaluations > 0);
  }
});

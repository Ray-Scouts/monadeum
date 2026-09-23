import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createReproductionModule,
  nichePressure,
  run,
  type AgentSnapshot,
  type Genome,
  type ReproductionModule,
} from "../src/index.js";

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

function snap(id: string, fitness: number): AgentSnapshot {
  return {
    id,
    capital: 20,
    principal: 10,
    adjustedFitness: fitness,
    rawSortino: fitness,
    flaggedZeroDownside: false,
    tradeCount: 30,
    status: "active",
    descendants: 0,
    ticksSinceReproduction: 80,
    genome,
  };
}

test("an agent can clear its own niche and fail a stronger reference set", () => {
  const reproduction = createReproductionModule();
  const local = reproduction.evaluate({
    agent: snap("a", 1),
    reference: [snap("a", 1), snap("b", 0)],
    populationSize: 10,
    populationCap: 50,
    nowTick: 100,
    requiredPercentile: 0.5,
  });
  const broader = reproduction.evaluate({
    agent: snap("a", 0),
    reference: [snap("a", 0), snap("b", 1), snap("c", 2)],
    populationSize: 10,
    populationCap: 50,
    nowTick: 100,
    requiredPercentile: 0.5,
  });
  assert.equal(local.failed.includes("percentile"), false);
  assert.equal(broader.failed.includes("percentile"), true);
});

test("a crowded niche raises the bar from the median to the 75th percentile and doubles mutation", () => {
  const open = nichePressure(0.4, true);
  const crowded = nichePressure(0.41, true);
  const off = nichePressure(0.9, false);
  assert.equal(open.requiredPercentile, 0.5);
  assert.equal(open.pMut, 0.15);
  assert.equal(crowded.requiredPercentile, 0.75);
  assert.equal(crowded.pMut, 0.3);
  assert.equal(off.requiredPercentile, 0.5);

  const reproduction = createReproductionModule();
  const tied = reproduction.evaluate({
    agent: snap("a", 1),
    reference: [snap("a", 1), snap("b", 1)],
    populationSize: 4,
    populationCap: 50,
    nowTick: 100,
    requiredPercentile: crowded.requiredPercentile,
  });
  assert.equal(tied.failed.includes("percentile"), true);
});

test("one shared niche makes the runner demand the crowded percentile", () => {
  let required = -1;
  const inner = createReproductionModule();
  const wrapped: ReproductionModule = {
    evaluate(input) {
      required = input.requiredPercentile;
      return { eligible: false, failed: ["hold"] };
    },
    allocate: (input) => inner.allocate(input),
    mutate: (input) => inner.mutate(input),
  };
  run({
    seed: 1,
    population: 4,
    ticks: 20,
    regime: "choppy",
    mode: "evolving",
    diversity: true,
    reproduction: wrapped,
  });
  assert.equal(required, 0.75);
});

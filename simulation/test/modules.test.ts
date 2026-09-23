import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createFitnessModule,
  createReproductionModule,
  nicheKey,
  run,
  type FitnessModule,
  type Genome,
} from "../src/index.js";

test("runner uses the injected fitness module", () => {
  const custom: FitnessModule = {
    evaluate: () => ({
      adjustedFitness: null,
      rawSortino: null,
      downsideDeviation: 0,
      flaggedZeroDownside: true,
      tradeCount: 3,
    }),
  };
  const out = run({
    seed: 1,
    population: 4,
    ticks: 20,
    regime: "trending",
    mode: "static",
    fitness: custom,
  });
  assert.equal(out.agents[0]?.flaggedZeroDownside, true);
});

test("allocation never spends principal and never creates capital", () => {
  const reproduction = createReproductionModule();
  const allocation = reproduction.allocate({
    capital: 20,
    principal: 10,
    fraction: 0.5,
    maxChildCapital: 10,
  });
  assert.equal(allocation.childCapital, 5);
  assert.equal(allocation.parentCapitalAfter, 15);
  assert.ok(allocation.parentCapitalAfter >= 10);
  assert.equal(allocation.childCapital + allocation.parentCapitalAfter, 20);

  const broke = reproduction.allocate({
    capital: 10,
    principal: 10,
    fraction: 0.5,
    maxChildCapital: 10,
  });
  assert.equal(broke.childCapital, 0);
  assert.equal(broke.parentCapitalAfter, 10);
});

test("shrinkage pulls a short record toward the population median", () => {
  const fitness = createFitnessModule();
  const returns = [0.02, -0.01];
  const own = fitness.evaluate({
    returns,
    tradeCounts: [1, 1],
    populationMedianSortino: 0,
    k: 20,
  });
  assert.ok(own.adjustedFitness !== null);
  assert.ok(Math.abs(own.adjustedFitness) < Math.abs(own.rawSortino ?? 0));
});

test("niche key uses an exact asset set and a risk band", () => {
  const left: Genome = {
    strategyType: "trading",
    assetUniverse: ["PAIR_B", "PAIR_A"],
    riskTolerance: 0.04,
    executionFrequency: 5,
    timeHorizon: 20,
    entryThreshold: 0,
    exitThreshold: 0,
    informationSources: ["nansen"],
    informationBudget: 0.05,
    modelConfiguration: "low",
  };
  const right: Genome = { ...left, assetUniverse: ["PAIR_A", "PAIR_B"] };
  const other: Genome = { ...left, assetUniverse: ["PAIR_A"] };
  assert.equal(nicheKey(left), nicheKey(right));
  assert.notEqual(nicheKey(left), nicheKey(other));
});

test("mutation stays inside the protocol bounds", () => {
  const reproduction = createReproductionModule();
  let seed = 7;
  const rng = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const start: Genome = {
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
  for (let i = 0; i < 40; i++) {
    const child = reproduction.mutate({ genome: start, rng, pMut: 1 });
    assert.ok(child.riskTolerance >= 0.01 && child.riskTolerance <= 0.25);
    assert.ok(child.executionFrequency >= 1 && child.executionFrequency <= 50);
    assert.ok(child.assetUniverse.length > 0);
    assert.equal(child.strategyType, "trading");
    assert.equal("k" in child, false);
  }
});

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createFitnessModule,
  createReproductionModule,
  run,
  type ReproductionModule,
} from "../src/index.js";

test("a book of only winning ticks is flagged and not scored", () => {
  const fitness = createFitnessModule();
  const result = fitness.evaluate({
    returns: [0.01, 0.002, 0.004, 0.001],
    tradeCounts: [1, 1, 1, 1],
    populationMedianSortino: 0,
    k: 20,
  });
  assert.equal(result.flaggedZeroDownside, true);
  assert.equal(result.adjustedFitness, null);
});

test("forced eligibility still cannot mint capital or exceed the descendant cap", () => {
  const real = createReproductionModule();
  let checks = 0;
  const wrapped: ReproductionModule = {
    evaluate: () => ({ eligible: true, failed: [] }),
    allocate(input) {
      const out = real.allocate(input);
      checks += 1;
      const profit = Math.max(0, input.capital - input.principal);
      assert.ok(out.childCapital <= profit + 1e-6);
      assert.ok(Math.abs(out.childCapital + out.parentCapitalAfter - input.capital) < 1e-6);
      if (input.capital >= input.principal) {
        assert.ok(out.parentCapitalAfter + 1e-9 >= input.principal);
      } else {
        assert.equal(out.childCapital, 0);
      }
      return out;
    },
    mutate: (input) => real.mutate(input),
  };
  const result = run({
    seed: 4,
    population: 6,
    ticks: 120,
    regime: "trending",
    mode: "evolving",
    diversity: false,
    reproduction: wrapped,
    genome: { riskTolerance: 0.25, executionFrequency: 1, entryThreshold: -1 },
    costs: {
      gasUsd: 0,
      x402Usd: 0,
      feeBps: 0,
      slippageBps: 0,
      infoPurchaseProbability: 1,
      infoEdge: 0.02,
    },
  });
  assert.ok(checks > 0);
  assert.ok(result.reproductions > 0);
  assert.ok(result.endPopulation <= 50);
  for (const agent of result.agents) assert.ok(agent.descendants <= 5);
  const parentCapital = result.agents
    .filter((agent) => agent.id.startsWith("a"))
    .reduce((sum, agent) => sum + agent.capital, 0);
  const childCapital = result.agents
    .filter((agent) => agent.id.startsWith("c"))
    .reduce((sum, agent) => sum + agent.capital, 0);
  assert.ok(parentCapital + childCapital <= result.totalCapital + 1e-6);
});

test("the population cap rejects another birth when the cap is already met", () => {
  const reproduction = createReproductionModule();
  const decision = reproduction.evaluate({
    agent: {
      id: "a",
      capital: 30,
      principal: 10,
      adjustedFitness: 2,
      rawSortino: 2,
      flaggedZeroDownside: false,
      tradeCount: 40,
      status: "active",
      descendants: 0,
      ticksSinceReproduction: 100,
      genome: {
        strategyType: "trading",
        assetUniverse: ["PAIR_A"],
        riskTolerance: 0.1,
        executionFrequency: 1,
        timeHorizon: 20,
        entryThreshold: -1,
        exitThreshold: 0,
        informationSources: ["nansen"],
        informationBudget: 0.05,
        modelConfiguration: "low",
      },
    },
    reference: [],
    populationSize: 50,
    populationCap: 50,
    nowTick: 100,
    requiredPercentile: 0,
  });
  assert.equal(decision.failed.includes("population_cap"), true);
});

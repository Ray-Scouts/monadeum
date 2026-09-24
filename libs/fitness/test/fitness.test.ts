import assert from "node:assert/strict";
import { test } from "node:test";
import { FitnessService } from "../src/fitness.service.js";
import { shrinkageWeight } from "../src/math.js";

const returns = [0.02, -0.01, 0.01, -0.005];
const marks = [1, 1, 1, 1];

test("shrinkage trusts the record only as trade count grows", () => {
  assert.equal(shrinkageWeight(0, 20), 0);
  assert.equal(shrinkageWeight(20, 20), 0.5);
  assert.ok(shrinkageWeight(200, 20) > 0.9);
});

test("a short record sits near the population median and a long one does not", () => {
  const service = new FitnessService();
  const short = service.evaluate({
    returns: [0.2, -0.01],
    tradeCounts: [1, 1],
    populationMedianSortino: 0,
    k: 20,
  });
  const longMarks = Array.from({ length: 200 }, () => 0.01);
  const long = service.evaluate({
    returns: longMarks.map((value, index) => (index % 5 === 0 ? -0.002 : value)),
    tradeCounts: longMarks.map(() => 1),
    populationMedianSortino: 0,
    k: 20,
  });
  assert.ok(short.adjustedFitness !== null && short.rawSortino !== null);
  assert.ok(Math.abs(short.adjustedFitness) < Math.abs(short.rawSortino) * 0.2);
  assert.ok(long.adjustedFitness !== null && long.rawSortino !== null);
  assert.ok(Math.abs(long.adjustedFitness - long.rawSortino) < Math.abs(long.rawSortino) * 0.15);
});

test("net economic performance subtracts every logged cost and refuses a missing one", () => {
  const service = new FitnessService();
  const nep = service.net([{ realizedPnl: 10, x402: 1, gas: 0.5, fees: 2, slippage: 0.5 }]);
  assert.equal(nep, 6);
  assert.throws(() => service.net([{ realizedPnl: 10, x402: 1, gas: 0, fees: 0 } as never]));
});

test("a window of only wins is an actionable flag and does not score", () => {
  const service = new FitnessService();
  const flagged = service.evaluate({
    returns,
    tradeCounts: marks,
    populationMedianSortino: 0,
    k: 20,
  });
  const wins = service.evaluate({
    returns: [0.01, 0.02],
    tradeCounts: [1, 1],
    populationMedianSortino: 0,
    k: 20,
  });
  assert.equal(flagged.flaggedZeroDownside, false);
  assert.equal(wins.flaggedZeroDownside, true);
  assert.equal(wins.adjustedFitness, null);
  assert.equal(wins.tradingContinues, true);
  assert.equal(wins.reproductionPaused, true);
});

test("niche key matches an exact asset set and the five risk bands", () => {
  const service = new FitnessService();
  assert.equal(service.niche(["PAIR_B", "PAIR_A"], 0.04), service.niche(["PAIR_A", "PAIR_B"], 0.04));
  assert.notEqual(service.niche(["PAIR_A"], 0.04), service.niche(["PAIR_A", "PAIR_B"], 0.04));
  assert.notEqual(service.niche(["PAIR_A"], 0.04), service.niche(["PAIR_A"], 0.12));
  assert.equal(service.k, 20);
  assert.equal(service.trailingWindow, 100);
});

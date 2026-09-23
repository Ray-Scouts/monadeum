import assert from "node:assert/strict";
import { test } from "node:test";
import { run } from "../src/index.js";

const shared = {
  seed: 7,
  population: 6,
  ticks: 80,
  regime: "trending" as const,
  mode: "static" as const,
  genome: { entryThreshold: -1, executionFrequency: 1, riskTolerance: 0.2 },
};

test("a higher fee rate lowers ending capital on the same seed", () => {
  const cheap = run({
    ...shared,
    costs: { feeBps: 0, slippageBps: 0, gasUsd: 0, x402Usd: 0, infoPurchaseProbability: 0 },
  });
  const costly = run({
    ...shared,
    costs: { feeBps: 100, slippageBps: 0, gasUsd: 0, x402Usd: 0, infoPurchaseProbability: 0 },
  });
  assert.ok(costly.totalCapital < cheap.totalCapital);
  assert.ok(costly.ledger.fees > cheap.ledger.fees);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { run } from "../src/index.js";
import { ARMS, compareCell, decide, outcome, runRerunCell, type RerunRow } from "../src/rerun.js";
import type { RunResult } from "../src/types.js";

const base = { seed: 3, population: 10, ticks: 120, regime: "trending" as const, mode: "static" as const };

test("information purchases off means no x402 spend", () => {
  const off = run({ ...base, costs: { x402Usd: 0.01 }, informationPurchases: false });
  const on = run({ ...base, costs: { x402Usd: 0.01 } });
  assert.equal(off.ledger.x402, 0);
  assert.ok(on.ledger.x402 > 0);
});

test("purchases off matches a price above every information budget, so the agent RNG stream is unchanged", () => {
  const off = run({ ...base, mode: "evolving", informationPurchases: false });
  const priced = run({ ...base, mode: "evolving", costs: { x402Usd: 1 } });
  assert.deepEqual(off.agents, priced.agents);
  assert.equal(off.roiPct, priced.roiPct);
});

test("purchases default to on", () => {
  assert.deepEqual(run({ ...base }).agents, run({ ...base, informationPurchases: true }).agents);
});

test("child outcome pools only agents whose id marks them as children", () => {
  const result = {
    seed: 1,
    roiPct: 0,
    reproductions: 2,
    agents: [
      { id: "a0000", capital: 20, principal: 10, status: "active" },
      { id: "c0000", capital: 0.5, principal: 1, status: "active" },
      { id: "c0001", capital: 0.05, principal: 0.5, status: "retired" },
    ],
  } as unknown as RunResult;
  const seed = outcome(result);
  assert.equal(seed.children, 2);
  assert.equal(seed.childrenActive, 1);
  assert.equal(seed.childCapitalSum, 0.55);
  assert.ok(Math.abs(seed.childRoiPctSum - (-50 + -90)) < 1e-9);
});

test("a cell with no reproduction has a zero gap and no child statistics", () => {
  const row = compareCell(runRerunCell(ARMS.C!, 10, "choppy", 3));
  assert.equal(row.gap, 0);
  assert.equal(row.children, 0);
  assert.equal(row.childActiveShare, null);
});

const row = (gap: number, p: number): RerunRow => ({
  arm: "X",
  population: 10,
  regime: "trending",
  seeds: 50,
  evolvingMean: gap,
  staticMean: 0,
  gap,
  p,
  reproductionsMean: 0,
  reproducingShare: 0,
  children: 0,
  childActiveShare: null,
  childRoiMean: null,
  childCapitalMean: null,
  childPrincipalMean: null,
});

test("the decision rule follows the pre-registered section 8 wording", () => {
  const twelve = (higher: number, lower: number, flat: number): RerunRow[] => [
    ...Array.from({ length: higher }, () => row(1, 0.01)),
    ...Array.from({ length: lower }, () => row(-1, 0.01)),
    ...Array.from({ length: flat }, () => row(0.1, 0.5)),
  ];
  assert.equal(decide(twelve(7, 0, 5)).call, "outperforms");
  assert.equal(decide(twelve(6, 0, 6)).call, "mixed");
  assert.equal(decide(twelve(0, 7, 5)).call, "underperforms");
  assert.equal(decide(twelve(3, 2, 7)).call, "inconclusive");
  assert.equal(decide(twelve(0, 0, 12)).call, "inconclusive");
  assert.equal(decide([...Array.from({ length: 7 }, () => row(1, 0.01)), ...Array.from({ length: 5 }, () => row(-2, 0.01))]).call, "outperforms");
});

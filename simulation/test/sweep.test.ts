import assert from "node:assert/strict";
import { test } from "node:test";
import { runSweep } from "../src/sweep.js";

test("a small grid writes one row per policy", () => {
  const rows = runSweep({
    populations: [4],
    regimes: ["choppy"],
    modes: ["static"],
    risks: [0.05, 0.25],
    frequencies: [1],
    ticks: 30,
    seed: 3,
    includeAllIn: true,
    includeZeroCost: false,
  });
  assert.equal(rows.length, 3);
  assert.equal(rows.filter((row) => row.legal).length, 2);
  assert.equal(rows.filter((row) => !row.legal).length, 1);
});

test("all-in pays more fees than a small position on the same seed", () => {
  const rows = runSweep({
    populations: [4],
    regimes: ["trending"],
    modes: ["static"],
    risks: [0.05],
    frequencies: [1],
    ticks: 40,
    seed: 9,
    includeAllIn: true,
    includeZeroCost: true,
  });
  const legal = rows.find((row) => row.legal && !row.zeroCost);
  const allIn = rows.find((row) => !row.legal);
  const zero = rows.find((row) => row.zeroCost);
  assert.ok(legal && allIn && zero);
  assert.ok(allIn.fees > legal.fees);
  assert.equal(zero.fees, 0);
  const sizing = legal.roiPct - allIn.roiPct;
  assert.equal(Number.isFinite(sizing), true);
});

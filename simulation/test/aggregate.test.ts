import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { distribution, welch } from "../src/aggregate.js";
import { fileURLToPath } from "node:url";

test("mean and sample standard deviation match a hand fixture", () => {
  const stats = distribution([2, 4, 4, 4, 5, 5, 7, 9]);
  assert.equal(stats.n, 8);
  assert.equal(stats.mean, 5);
  assert.ok(Math.abs(stats.stdev - 2.138089935) < 1e-6);
});

test("identical samples are not a difference, and a wide gap is", () => {
  const same = welch([1, 2, 3, 4], [1, 2, 3, 4]);
  assert.ok(same.p > 0.99);
  const gap = welch([2, 3, 4], [6, 7, 8]);
  assert.ok(Math.abs(gap.t) > 4);
  assert.ok(gap.df > 3.9 && gap.df < 4.1);
  assert.ok(gap.p < 0.01);
});

test("the committed multi-seed artifact has 50 seeds in every cell", () => {
  const path = fileURLToPath(new URL("../../results/multiseed.json", import.meta.url));
  const payload = JSON.parse(readFileSync(path, "utf8")) as {
    summary: { n: number }[];
  };
  assert.equal(payload.summary.length, 24);
  for (const row of payload.summary) assert.ok(row.n >= 50);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { run } from "../src/index.js";

const base = {
  population: 8,
  ticks: 40,
  regime: "choppy" as const,
  mode: "evolving" as const,
};

test("same seed yields identical output", () => {
  const a = run({ ...base, seed: 42 });
  const b = run({ ...base, seed: 42 });
  assert.deepEqual(a, b);
});

test("a different seed changes the price path", () => {
  const a = run({ ...base, seed: 1 });
  const b = run({ ...base, seed: 2 });
  assert.notDeepEqual(a.prices, b.prices);
});

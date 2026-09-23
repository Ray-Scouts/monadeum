import assert from "node:assert/strict";
import { test } from "node:test";
import { expectedDrift } from "../src/index.js";

test("trending drift is positive", () => {
  assert.ok(expectedDrift("trending", 10, 1, 300) > 0);
});

test("choppy drift is zero", () => {
  assert.equal(expectedDrift("choppy", 10, 1, 300), 0);
});

test("mean reversion pulls toward 1", () => {
  assert.ok(expectedDrift("mean_reverting", 10, 0.5, 300) > 0);
  assert.ok(expectedDrift("mean_reverting", 10, 1.5, 300) < 0);
});

test("stress shock is a single large negative drift", () => {
  const ticks = 300;
  const shock = Math.floor(ticks * 0.5);
  assert.ok(expectedDrift("stress_flash_crash", shock, 1, ticks) <= -0.2);
  assert.equal(expectedDrift("stress_flash_crash", shock - 1, 1, ticks), 0);
  assert.equal(expectedDrift("stress_flash_crash", shock + 1, 1, ticks), 0);
});

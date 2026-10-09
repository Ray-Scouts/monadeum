import assert from "node:assert/strict";
import { test } from "node:test";
import { createReproductionModule, run } from "../src/index.js";

// Arm A settings at a small size where reproduction occurs, so the child skill path is exercised.
const base = {
  seed: 5,
  population: 10,
  ticks: 300,
  regime: "trending" as const,
  mode: "evolving" as const,
  genome: { riskTolerance: 0.25, executionFrequency: 1 },
  costs: { x402Usd: 0.01 },
  reproduction: createReproductionModule({ profitThresholdFraction: 0.1 }),
};

test("h = 0 is identical to leaving heritability unset", () => {
  const unset = run(base);
  assert.ok(unset.reproductions > 0, "the fixture must reproduce for this test to mean anything");
  assert.deepEqual(run({ ...base, skillHeritability: 0 }), unset);
});

test("h = 1 gives every child exactly its parent's skill", () => {
  const result = run({ ...base, skillHeritability: 1 });
  const byId = new Map(result.agents.map((agent) => [agent.id, agent]));
  const children = result.agents.filter((agent) => agent.parent !== null);
  assert.ok(children.length > 0);
  for (const child of children) assert.equal(child.skill, byId.get(child.parent ?? "")?.skill);
});

test("intermediate h keeps every child inside the founder skill range", () => {
  const result = run({ ...base, skillHeritability: 0.5 });
  const children = result.agents.filter((agent) => agent.parent !== null);
  assert.ok(children.length > 0);
  for (const child of children) assert.ok(child.skill >= -0.002 && child.skill <= 0.004);
});

test("h does not change the founders", () => {
  const founders = (h: number): number[] =>
    run({ ...base, skillHeritability: h })
      .agents.filter((agent) => agent.parent === null)
      .map((agent) => agent.skill);
  assert.deepEqual(founders(0), founders(1));
});

test("h outside [0, 1] is rejected", () => {
  for (const bad of [-0.01, 1.01, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => run({ ...base, ticks: 1, skillHeritability: bad }), RangeError);
  }
});

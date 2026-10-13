import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluationOutcomes } from "../src/outcomes.js";
import { planEvaluation, type AgentState, type ReallocationPolicy } from "../src/plan.js";

function agent(id: string, fitness: number | null, capital = 10, extra: Partial<AgentState> = {}): AgentState {
  return { id, owner: "o1", status: "active", capital, principal: 10, adjustedFitness: fitness, flaggedZeroDownside: false, ...extra };
}

const explain = (population: AgentState[], policies: ReallocationPolicy[]) => {
  const out = evaluationOutcomes(population, policies, planEvaluation(population, policies));
  return Object.fromEntries([...out].map(([id, e]) => [id, e]));
};

test("a source and a sink name their rank; the middle of the pool is held as middle", () => {
  const pop = [agent("a", 1), agent("b", 2), agent("c", 3)];
  const out = explain(pop, [{ owner: "o1", agents: ["a", "b", "c"] }]);
  assert.deepEqual(out.a, { outcome: { kind: "sent" }, rank: { position: 1, of: 3, quota: 1 } });
  assert.deepEqual(out.b, { outcome: { kind: "held", reason: "middle" }, rank: { position: 2, of: 3, quota: 1 } });
  assert.deepEqual(out.c, { outcome: { kind: "received" }, rank: { position: 3, of: 3, quota: 1 } });
});

test("names the binding reason when a ranked agent moved nothing", () => {
  // The lowest is at the floor, so it offers nothing and the highest receives nothing for want of a counterpart.
  let out = explain([agent("a", 1, 0.06), agent("b", 2)], [{ owner: "o1", agents: ["a", "b"] }]);
  assert.deepEqual(out.a?.outcome, { kind: "held", reason: "floor" });
  assert.deepEqual(out.b?.outcome, { kind: "held", reason: "counterpart" });
  // The highest is at its ceiling.
  out = explain([agent("a", 1), agent("b", 2, 40)], [{ owner: "o1", agents: ["a", "b"] }]);
  assert.deepEqual(out.b?.outcome, { kind: "held", reason: "ceiling" });
  assert.deepEqual(out.a?.outcome, { kind: "held", reason: "counterpart" });
  // The highest is flagged for zero downside.
  out = explain([agent("a", 1), agent("b", 2, 10, { flaggedZeroDownside: true })], [{ owner: "o1", agents: ["a", "b"] }]);
  assert.deepEqual(out.b?.outcome, { kind: "held", reason: "zero-downside" });
  // Only one ranked agent: the other has no fitness.
  out = explain([agent("a", 1), agent("b", null)], [{ owner: "o1", agents: ["a", "b"] }]);
  assert.deepEqual(out.a, { outcome: { kind: "held", reason: "alone" }, rank: { position: 1, of: 1, quota: 0 } });
  assert.deepEqual(out.b, { outcome: { kind: "unranked", reason: "no-fitness" }, rank: null });
});

test("states why reallocation was off for an agent", () => {
  assert.deepEqual(explain([agent("a", 1)], [])["a"]?.outcome, { kind: "off", reason: "one-agent" });
  assert.deepEqual(explain([agent("a", 1), agent("b", 2)], [])["a"]?.outcome, { kind: "off", reason: "no-policy" });
  const three = [agent("a", 1), agent("b", 2), agent("c", 3)];
  assert.deepEqual(explain(three, [{ owner: "o1", agents: ["a", "b"] }])["c"]?.outcome, { kind: "off", reason: "not-covered" });
  assert.deepEqual(explain(three, [{ owner: "o1", agents: ["a"] }])["a"]?.outcome, { kind: "off", reason: "too-few-covered" });
  assert.deepEqual(explain(three, [{ owner: "o1", agents: ["a", "b"], slotCeiling: 99 }])["a"]?.outcome, { kind: "off", reason: "policy-invalid" });
  assert.deepEqual(explain([agent("a", 1, 10, { status: "retired" }), agent("b", 2), agent("c", 3)], [])["a"]?.outcome, { kind: "retired" });
});

test("a move the caller dropped does not read as sent", () => {
  const pop = [agent("a", 1), agent("b", 2)];
  const policies = [{ owner: "o1", agents: ["a", "b"] }];
  const out = evaluationOutcomes(pop, policies, planEvaluation(pop, policies), { sent: new Set(), received: new Set() });
  assert.deepEqual(out.get("a")?.outcome, { kind: "held", reason: "counterpart" });
});

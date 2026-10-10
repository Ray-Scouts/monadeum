import assert from "node:assert/strict";
import { test } from "node:test";
import { CAPITAL_FLOOR, REALLOCATION_CAP, SLOT_CEILING } from "../src/constants.js";
import {
  PROTOCOL_BOUNDS,
  planEvaluation,
  planReallocation,
  reallocationQuota,
  resolvePolicy,
  type AgentState,
  type ReallocationPolicy,
} from "../src/plan.js";

function agent(id: string, fitness: number | null, capital = 10, extra: Partial<AgentState> = {}): AgentState {
  return {
    id,
    owner: "o1",
    status: "active",
    capital,
    principal: 10,
    adjustedFitness: fitness,
    flaggedZeroDownside: false,
    ...extra,
  };
}

function policy(agents: string[], extra: Partial<ReallocationPolicy> = {}): ReallocationPolicy {
  return { owner: "o1", agents, ...extra };
}

const close = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-12, `${actual} vs ${expected}`);

test("the constants are the section 3.1 and section 6 values", () => {
  assert.equal(REALLOCATION_CAP, 0.2);
  assert.equal(SLOT_CEILING, 4);
  assert.equal(CAPITAL_FLOOR, 0.06);
  assert.deepEqual({ ...PROTOCOL_BOUNDS }, { reallocationCap: 0.2, slotCeiling: 4, capitalFloor: 0.06 });
});

test("small-pool rule: none below 2, one from 2 to 19, deciles from 20", () => {
  const expected: [number, number][] = [
    [0, 0], [1, 0], [2, 1], [3, 1], [5, 1], [10, 1], [19, 1], [20, 2], [29, 2], [30, 3], [100, 10],
  ];
  for (const [ranked, quota] of expected) assert.equal(reallocationQuota(ranked), quota, `pool ${ranked}`);
  for (let ranked = 0; ranked <= 200; ranked++) assert.ok(2 * reallocationQuota(ranked) <= ranked, "no overlap");
});

test("the bottom agent is the source and the top agent the sink", () => {
  const plan = planEvaluation([agent("a", 1), agent("b", 0), agent("c", -1)], [policy(["a", "b", "c"])]);
  assert.deepEqual(plan.owners[0]?.ranked, ["a", "b", "c"]);
  assert.deepEqual(plan.moves.map((move) => [move.source, move.sink]), [["c", "a"]]);
});

test("cap limit: a source loses exactly reallocation_cap of its capital when the sink has room", () => {
  const plan = planEvaluation([agent("top", 2, 10), agent("low", -2, 10)], [policy(["top", "low"])]);
  close(plan.moved, 2);
  close(plan.owners[0]?.sources[0]?.debit ?? 0, 0.2 * 10);
});

test("floor limit: a source never goes below the capital floor, and a source at the floor gives nothing", () => {
  const near = planEvaluation([agent("top", 2, 10), agent("low", -2, 0.07)], [policy(["top", "low"])]);
  close(near.moved, 0.07 - CAPITAL_FLOOR);
  const at = planEvaluation([agent("top", 2, 10), agent("low", -2, CAPITAL_FLOOR)], [policy(["top", "low"])]);
  assert.equal(at.moved, 0);
  assert.deepEqual(at.moves, []);
});

test("ceiling limit: a sink never rises above slot_ceiling times its principal, and a sink at the ceiling takes nothing", () => {
  const near = planEvaluation([agent("top", 2, 39), agent("low", -2, 10)], [policy(["top", "low"])]);
  close(near.moved, 1);
  close(39 + (near.owners[0]?.sinks[0]?.credit ?? 0), SLOT_CEILING * 10);
  const at = planEvaluation([agent("top", 2, 40), agent("low", -2, 10)], [policy(["top", "low"])]);
  assert.equal(at.moved, 0);
});

test("the ceiling uses principal, so capital received earlier does not raise it", () => {
  const plan = planEvaluation([agent("top", 2, 39.5, { principal: 10 }), agent("low", -2, 10)], [policy(["top", "low"])]);
  close(plan.moved, 0.5);
});

test("an owner's policy can tighten each bound, and the tighter value binds", () => {
  const cap = planEvaluation([agent("top", 2), agent("low", -2)], [policy(["top", "low"], { reallocationCap: 0.1 })]);
  close(cap.moved, 1);
  const ceiling = planEvaluation([agent("top", 2, 15), agent("low", -2)], [policy(["top", "low"], { slotCeiling: 1.6 })]);
  close(ceiling.moved, 1);
  const floor = planEvaluation([agent("top", 2), agent("low", -2, 1)], [policy(["top", "low"], { capitalFloor: 0.9 })]);
  close(floor.moved, 0.1);
});

test("a policy that loosens any bound is not in force, so nothing moves", () => {
  const agents = [agent("top", 2), agent("low", -2)];
  const cases: [Partial<ReallocationPolicy>, string][] = [
    [{ reallocationCap: 0.21 }, "loosens_cap"],
    [{ slotCeiling: 4.5 }, "loosens_ceiling"],
    [{ capitalFloor: 0.05 }, "loosens_floor"],
    [{ reallocationCap: Number.NaN }, "invalid_bound"],
    [{ slotCeiling: -1 }, "invalid_bound"],
  ];
  for (const [extra, reason] of cases) {
    const plan = planEvaluation(agents, [policy(["top", "low"], extra)]);
    assert.equal(plan.owners[0]?.outcome, reason);
    assert.deepEqual(plan.moves, []);
  }
});

test("reallocation is off by default, and a revoked policy moves nothing", () => {
  const agents = [agent("top", 2), agent("low", -2)];
  const none = planEvaluation(agents, []);
  assert.equal(none.owners[0]?.outcome, "no_policy");
  assert.deepEqual(none.moves, []);
  const revoked = planEvaluation(agents, [policy(["top", "low"], { revoked: true })]);
  assert.equal(revoked.owners[0]?.outcome, "revoked");
  assert.deepEqual(revoked.moves, []);
});

test("a policy must name at least two of the owner's own agents, each once", () => {
  const agents = [agent("top", 2), agent("low", -2), agent("theirs", 0, 10, { owner: "o2" })];
  assert.equal(resolvePolicy(policy(["top"]), agents).inForce, false);
  assert.deepEqual(resolvePolicy(policy(["top"]), agents), { inForce: false, reason: "too_few_agents" });
  assert.deepEqual(resolvePolicy(policy(["top", "theirs"]), agents), { inForce: false, reason: "foreign_agent" });
  assert.deepEqual(resolvePolicy(policy(["top", "ghost"]), agents), { inForce: false, reason: "unknown_agent" });
  assert.deepEqual(resolvePolicy(policy(["top", "top"]), agents), { inForce: false, reason: "duplicate_agent" });
  assert.equal(resolvePolicy(policy(["top", "low"]), agents).inForce, true);
});

test("only the agents a policy names take part", () => {
  const agents = [agent("top", 2), agent("mid", 0), agent("low", -2)];
  const plan = planEvaluation(agents, [policy(["top", "mid"])]);
  assert.deepEqual(plan.owners[0]?.ranked, ["top", "mid"]);
  assert.deepEqual(plan.moves.map((move) => [move.source, move.sink]), [["mid", "top"]]);
});

test("retired agents and agents without a fitness are never a source or a sink", () => {
  const agents = [
    agent("top", 2, 10, { status: "retired" }),
    agent("mid", 1),
    agent("none", null),
    agent("low", -2, 10, { status: "retired" }),
    agent("next", 0),
  ];
  const plan = planEvaluation(agents, [policy(["top", "mid", "none", "low", "next"])]);
  assert.deepEqual(plan.owners[0]?.ranked, ["mid", "next"]);
  assert.deepEqual(plan.moves.map((move) => [move.source, move.sink]), [["next", "mid"]]);
});

test("a zero-downside flagged agent is never a sink, and is not replaced by the next one", () => {
  const agents = [agent("top", 2, 10, { flaggedZeroDownside: true }), agent("mid", 1), agent("low", -2)];
  const plan = planEvaluation(agents, [policy(["top", "mid", "low"])]);
  assert.equal(plan.moved, 0);
  assert.deepEqual(plan.moves, []);
});

test("ties in fitness break by agent ID", () => {
  const plan = planEvaluation([agent("b", 1), agent("a", 1), agent("c", 1)], [policy(["a", "b", "c"])]);
  assert.deepEqual(plan.owners[0]?.ranked, ["a", "b", "c"]);
});

test("pairwise moves add up to each source's debit and each sink's credit", () => {
  const agents = Array.from({ length: 30 }, (_, i) => agent(`a${String(i).padStart(2, "0")}`, i, 5 + i));
  const plan = planEvaluation(agents, [policy(agents.map((item) => item.id))]);
  const owner = plan.owners[0];
  assert.ok(owner && owner.sources.length === 3 && owner.sinks.length === 3);
  assert.equal(plan.moves.length, 9);
  for (const source of owner.sources) {
    const sum = plan.moves.filter((move) => move.source === source.id).reduce((total, move) => total + move.amount, 0);
    close(sum, source.debit);
  }
  for (const sink of owner.sinks) {
    const sum = plan.moves.filter((move) => move.sink === sink.id).reduce((total, move) => total + move.amount, 0);
    close(sum, sink.credit);
  }
});

test("planReallocation moves the smaller of total offer and total room", () => {
  const plan = planReallocation([10, 10], [{ capital: 39, principal: 10 }], 0.2, 4, 0.06);
  close(plan.moved, 1);
  close(plan.debits[0] ?? 0, 0.5);
  close(plan.credits[0] ?? 0, 1);
});

test("invalid inputs fail closed", () => {
  assert.throws(() => planEvaluation([agent("a", 1), agent("a", 0)], []), RangeError);
  assert.throws(() => planEvaluation([agent("a", 1, Number.NaN)], []), RangeError);
  assert.throws(() => planEvaluation([agent("a", Number.POSITIVE_INFINITY)], []), RangeError);
  assert.throws(() => planEvaluation([agent("a", 1)], [policy(["a"]), policy(["a"])]), RangeError);
});

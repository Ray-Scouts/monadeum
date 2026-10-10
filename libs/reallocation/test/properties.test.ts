import assert from "node:assert/strict";
import { test } from "node:test";
import { PROTOCOL_BOUNDS, planEvaluation, type AgentState, type EvaluationPlan, type ReallocationPolicy } from "../src/plan.js";

/** Seeded generator (mulberry32), so every property run is reproducible. */
function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Scenario {
  population: AgentState[];
  policies: ReallocationPolicy[];
}

/** A random population across owners of mixed size, with retired, unranked, and flagged agents and mixed policies. */
function scenario(seed: number): Scenario {
  const next = rng(seed);
  const pick = <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)] as T;
  const population: AgentState[] = [];
  const policies: ReallocationPolicy[] = [];
  const owners = 1 + Math.floor(next() * 8);
  for (let o = 0; o < owners; o++) {
    const owner = `o${o}`;
    const size = pick([1, 1, 2, 3, 5, 10, 19, 20, 25, 40]);
    const ids: string[] = [];
    for (let i = 0; i < size; i++) {
      const principal = pick([0.5, 1, 10, 50]);
      const capital = pick([0, 0.06, 0.07, principal * next() * 5, principal * 4, principal * 4.2, principal]);
      const id = `${owner}-a${String(i).padStart(3, "0")}`;
      ids.push(id);
      population.push({
        id,
        owner,
        status: next() < 0.15 ? "retired" : "active",
        capital,
        principal,
        adjustedFitness: next() < 0.1 ? null : next() < 0.1 ? 0 : next() * 4 - 2,
        flaggedZeroDownside: next() < 0.05,
      });
    }
    const roll = next();
    if (roll < 0.15) continue;
    const named = ids.filter(() => next() < 0.85);
    const policy: ReallocationPolicy = { owner, agents: named };
    if (next() < 0.3) policy.reallocationCap = next() * 0.2;
    if (next() < 0.3) policy.slotCeiling = 1 + next() * 3;
    if (next() < 0.3) policy.capitalFloor = 0.06 + next();
    if (next() < 0.1) policy.revoked = true;
    policies.push(policy);
  }
  return { population, policies };
}

const SEEDS = Array.from({ length: 400 }, (_, i) => i + 1);
const EPS = 1e-9;

function apply(population: readonly AgentState[], plan: EvaluationPlan): Map<string, number> {
  const balances = new Map(population.map((agent) => [agent.id, agent.capital]));
  for (const move of plan.moves) {
    balances.set(move.source, (balances.get(move.source) ?? Number.NaN) - move.amount);
    balances.set(move.sink, (balances.get(move.sink) ?? Number.NaN) + move.amount);
  }
  return balances;
}

test("the property scenarios actually move capital, so the properties are not vacuous", () => {
  let moving = 0;
  for (const seed of SEEDS) {
    const { population, policies } = scenario(seed);
    if (planEvaluation(population, policies).moved > 0) moving += 1;
  }
  assert.ok(moving > SEEDS.length / 4, `${moving} of ${SEEDS.length} scenarios moved capital`);
});

test("conservation: total capital and each owner's total are unchanged by a plan", () => {
  for (const seed of SEEDS) {
    const { population, policies } = scenario(seed);
    const plan = planEvaluation(population, policies);
    const after = apply(population, plan);
    const totals = new Map<string, [number, number]>();
    for (const agent of population) {
      const [before, now] = totals.get(agent.owner) ?? [0, 0];
      totals.set(agent.owner, [before + agent.capital, now + (after.get(agent.id) ?? Number.NaN)]);
    }
    let all = 0;
    for (const [owner, [before, now]] of totals) {
      assert.ok(Math.abs(now - before) <= EPS * Math.max(1, before), `seed ${seed} owner ${owner}`);
      all += now - before;
    }
    assert.ok(Math.abs(all) <= EPS * population.length, `seed ${seed} total`);
    const debits = plan.owners.reduce((sum, owner) => sum + owner.sources.reduce((s, x) => s + x.debit, 0), 0);
    const credits = plan.owners.reduce((sum, owner) => sum + owner.sinks.reduce((s, x) => s + x.credit, 0), 0);
    assert.ok(Math.abs(debits - credits) <= EPS * Math.max(1, debits), `seed ${seed} debits and credits`);
  }
});

test("no move crosses an owner boundary, and every move is between two named, active, ranked agents", () => {
  for (const seed of SEEDS) {
    const { population, policies } = scenario(seed);
    const byId = new Map(population.map((agent) => [agent.id, agent]));
    const named = new Map(policies.map((policy) => [policy.owner, new Set(policy.agents)]));
    const plan = planEvaluation(population, policies);
    for (const move of plan.moves) {
      const source = byId.get(move.source);
      const sink = byId.get(move.sink);
      assert.ok(source && sink, `seed ${seed}`);
      assert.equal(source.owner, move.owner);
      assert.equal(sink.owner, move.owner);
      assert.notEqual(move.source, move.sink);
      for (const party of [source, sink]) {
        assert.equal(party.status, "active", `seed ${seed}: retired ${party.id} moved`);
        assert.notEqual(party.adjustedFitness, null);
        assert.ok(named.get(move.owner)?.has(party.id), `seed ${seed}: ${party.id} not named`);
      }
      assert.equal(sink.flaggedZeroDownside, false, `seed ${seed}: flagged sink`);
      assert.ok(move.amount > 0);
    }
  }
});

test("bounds: no source loses more than the cap or ends below the floor, no sink ends above the ceiling", () => {
  for (const seed of SEEDS) {
    const { population, policies } = scenario(seed);
    const plan = planEvaluation(population, policies);
    const byId = new Map(population.map((agent) => [agent.id, agent]));
    const after = apply(population, plan);
    for (const owner of plan.owners) {
      if (owner.moved === 0) continue;
      const bounds = owner.bounds;
      assert.ok(bounds, `seed ${seed}`);
      assert.ok(bounds.reallocationCap <= PROTOCOL_BOUNDS.reallocationCap);
      assert.ok(bounds.slotCeiling <= PROTOCOL_BOUNDS.slotCeiling);
      assert.ok(bounds.capitalFloor >= PROTOCOL_BOUNDS.capitalFloor);
      for (const { id, debit } of owner.sources) {
        const agent = byId.get(id);
        assert.ok(agent);
        const end = after.get(id) ?? Number.NaN;
        assert.ok(debit <= bounds.reallocationCap * agent.capital + EPS, `seed ${seed}: cap on ${id}`);
        if (debit > 0) assert.ok(end >= bounds.capitalFloor - EPS, `seed ${seed}: floor on ${id}`);
      }
      for (const { id, credit } of owner.sinks) {
        const agent = byId.get(id);
        assert.ok(agent);
        const end = after.get(id) ?? Number.NaN;
        if (credit > 0) assert.ok(end <= bounds.slotCeiling * agent.principal + EPS, `seed ${seed}: ceiling on ${id}`);
      }
    }
  }
});

test("no policy in force, no moves: without policies, with every policy revoked, or with every policy loosened", () => {
  for (const seed of SEEDS) {
    const { population, policies } = scenario(seed);
    assert.deepEqual(planEvaluation(population, []).moves, [], `seed ${seed}`);
    const revoked = policies.map((policy) => ({ ...policy, revoked: true }));
    assert.deepEqual(planEvaluation(population, revoked).moves, [], `seed ${seed}`);
    const loosened = policies.map((policy) => ({ ...policy, reallocationCap: 0.5 }));
    assert.deepEqual(planEvaluation(population, loosened).moves, [], `seed ${seed}`);
  }
});

test("an owner without a policy in force moves nothing while other owners' plans are unaffected", () => {
  for (const seed of SEEDS) {
    const { population, policies } = scenario(seed);
    const full = planEvaluation(population, policies);
    const [dropped, ...rest] = policies;
    if (!dropped) continue;
    const partial = planEvaluation(population, rest);
    assert.ok(partial.moves.every((move) => move.owner !== dropped.owner), `seed ${seed}`);
    const others = (plan: EvaluationPlan) => plan.moves.filter((move) => move.owner !== dropped.owner);
    assert.deepEqual(others(partial), others(full), `seed ${seed}`);
  }
});

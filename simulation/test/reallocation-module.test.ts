import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CAPITAL_FLOOR,
  EVALUATION_CADENCE,
  REALLOCATION_CAP,
  RETIREMENT_WINDOWS,
  SLOT_CEILING,
  STARVATION_PERCENTILE,
} from "@monadeum/reallocation/constants";
import {
  planEvaluation,
  planReallocation as modulePlan,
  reallocationQuota as moduleQuota,
  type AgentState,
} from "@monadeum/reallocation/plan";
import { PROTOCOL } from "../src/protocol.js";
import { planReallocation as simulationPlan, reallocationQuota as simulationQuota } from "../src/reallocation.js";
import { SLOT_ARMS } from "../src/slots.js";

/**
 * Issue #99: the ReallocationModule (`libs/reallocation`) must reproduce the simulation's reallocation planner on the
 * same inputs, and both must read their constants from one place.
 */

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

test("the simulation reads the reallocation and retirement constants from the module", () => {
  assert.equal(PROTOCOL.reallocationCap, REALLOCATION_CAP);
  assert.equal(PROTOCOL.slotCeiling, SLOT_CEILING);
  assert.equal(PROTOCOL.capitalFloor, CAPITAL_FLOOR);
  assert.equal(PROTOCOL.evalEvery, EVALUATION_CADENCE);
  assert.equal(PROTOCOL.retirementWindows, RETIREMENT_WINDOWS);
  assert.equal(PROTOCOL.starvationPercentile, STARVATION_PERCENTILE);
  const primary = SLOT_ARMS["Omix-RT-c0.2-x4"];
  assert.ok(primary, "the issue #92 primary arm exists");
  assert.equal(primary.reallocationCap, REALLOCATION_CAP);
  assert.equal(primary.slotCeiling, SLOT_CEILING);
});

test("the small-pool quota matches the simulation's owner-pool rule", () => {
  for (let ranked = 0; ranked <= 500; ranked++) assert.equal(moduleQuota(ranked), simulationQuota(ranked, true), `${ranked}`);
});

test("planReallocation returns identical numbers to the simulation planner", () => {
  const next = rng(99);
  for (let trial = 0; trial < 2000; trial++) {
    const sources = Array.from({ length: Math.floor(next() * 6) }, () => (next() < 0.1 ? CAPITAL_FLOOR : next() * 50));
    const sinks = Array.from({ length: Math.floor(next() * 6) }, () => {
      const principal = next() < 0.5 ? 10 : next() * 20;
      return { capital: next() * principal * 5, principal };
    });
    const cap = next() < 0.5 ? REALLOCATION_CAP : next() * REALLOCATION_CAP;
    const ceiling = next() < 0.5 ? SLOT_CEILING : 1 + next() * 3;
    assert.deepEqual(
      modulePlan(sources, sinks, cap, ceiling, CAPITAL_FLOOR),
      simulationPlan(sources, sinks, cap, ceiling, CAPITAL_FLOOR),
      `trial ${trial}`,
    );
  }
});

interface SimSlot {
  id: string;
  owner: number;
  status: "active" | "retired";
  capital: number;
  principal: number;
  adjustedFitness: number | null;
}

/**
 * The owner-scoped branch of `reallocate()` in `src/runner.ts`, step for step: rank active slots with a fitness, split
 * by owner in owner order, take sinks from the top and sources from the bottom by the owner-pool quota, and plan with
 * the protocol cap, ceiling, and floor. Returns each slot's net change.
 */
function simulationReallocate(slots: readonly SimSlot[]): Map<string, number> {
  const ranked = slots
    .filter((slot) => slot.status === "active" && slot.adjustedFitness !== null)
    .sort((a, b) => (b.adjustedFitness ?? 0) - (a.adjustedFitness ?? 0) || (a.id < b.id ? -1 : 1));
  const byOwner = new Map<number, SimSlot[]>();
  for (const slot of ranked) {
    const pool = byOwner.get(slot.owner);
    if (pool) pool.push(slot);
    else byOwner.set(slot.owner, [slot]);
  }
  const change = new Map<string, number>();
  for (const pool of [...byOwner.entries()].sort((a, b) => a[0] - b[0]).map((entry) => entry[1])) {
    const q = simulationQuota(pool.length, true);
    if (q < 1) continue;
    const sinks = pool.slice(0, q);
    const sources = pool.slice(pool.length - q);
    const plan = simulationPlan(
      sources.map((slot) => slot.capital),
      sinks.map((slot) => ({ capital: slot.capital, principal: slot.principal })),
      PROTOCOL.reallocationCap,
      PROTOCOL.slotCeiling,
      PROTOCOL.capitalFloor,
    );
    if (!(plan.moved > 0)) continue;
    sources.forEach((slot, index) => change.set(slot.id, -(plan.debits[index] ?? 0)));
    sinks.forEach((slot, index) => change.set(slot.id, plan.credits[index] ?? 0));
  }
  return change;
}

test("planEvaluation reproduces the simulation's owner-scoped reallocation on the same population", () => {
  const sizes = [1, 1, 1, 2, 2, 3, 5, 10, 25];
  let moving = 0;
  for (let seed = 1; seed <= 200; seed++) {
    const next = rng(seed);
    const slots: SimSlot[] = [];
    sizes.forEach((size, owner) => {
      for (let i = 0; i < size; i++) {
        const principal = PROTOCOL.principal;
        slots.push({
          id: `a${String(slots.length).padStart(4, "0")}`,
          owner,
          status: next() < 0.1 ? "retired" : "active",
          capital: next() < 0.1 ? CAPITAL_FLOOR : next() * principal * 4.5,
          principal,
          adjustedFitness: next() < 0.1 ? null : next() < 0.05 ? 0 : next() * 2 - 1,
        });
      }
    });
    const expected = simulationReallocate(slots);
    const population: AgentState[] = slots.map((slot) => ({
      id: slot.id,
      owner: `o${String(slot.owner).padStart(2, "0")}`,
      status: slot.status,
      capital: slot.capital,
      principal: slot.principal,
      adjustedFitness: slot.adjustedFitness,
      flaggedZeroDownside: false,
    }));
    // Every owner's policy names every agent at the protocol bounds, the setting the simulation assumed.
    const policies = sizes.map((_, owner) => ({
      owner: `o${String(owner).padStart(2, "0")}`,
      agents: population.filter((agent) => agent.owner === `o${String(owner).padStart(2, "0")}`).map((agent) => agent.id),
    }));
    const plan = planEvaluation(population, policies);
    const actual = new Map<string, number>();
    for (const owner of plan.owners) {
      for (const source of owner.sources) actual.set(source.id, -source.debit);
      for (const sink of owner.sinks) actual.set(sink.id, sink.credit);
    }
    assert.deepEqual(actual, expected, `seed ${seed}`);
    if (plan.moved > 0) moving += 1;
  }
  assert.ok(moving > 100, `${moving} of 200 populations moved capital`);
});

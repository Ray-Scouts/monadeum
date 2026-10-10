import { describe, expect, test } from "bun:test";
import { CAPITAL_FLOOR, REALLOCATION_CAP, RETIREMENT_WINDOWS } from "@monadeum/reallocation/constants";
import { runEvaluation } from "./evaluate";
import { agent, owner } from "./test-helpers";
import type { Agent, AgentEvaluation } from "./types";

const outcomeOf = (r: { outcomes: AgentEvaluation[] }, a: Agent) => r.outcomes.find((v) => v.agentId === a.id)!.outcome;
const total = (as: Agent[]) => as.reduce((s, a) => s + a.capital, 0);

describe("runEvaluation", () => {
  test("moves a capped share from the lowest to the highest ranked agent and keeps the owner's total", () => {
    const low = agent({ fitnessPercentile: 20, capital: 6 });
    const mid = agent({ fitnessPercentile: 50 });
    const high = agent({ fitnessPercentile: 80, capital: 13 });
    const all = [low, mid, high];
    const before = total(all);
    const r = runEvaluation(all, [owner(all)], 1);
    expect(r.moves).toEqual([{ evaluation: 1, ownerId: "o", sourceId: low.id, sinkId: high.id, amount: 1.2 }]);
    expect(outcomeOf(r, low)).toEqual({ kind: "sent", amount: 1.2 });
    expect(outcomeOf(r, high)).toEqual({ kind: "received", amount: 1.2 });
    expect(outcomeOf(r, mid)).toEqual({ kind: "held", reason: "middle" });
    expect(total(all)).toBeCloseTo(before, 9);
    expect(r.outcomes.find((v) => v.agentId === low.id)!.rank).toEqual({ position: 1, of: 3, quota: 1 });
  });

  test("can take a source below its own principal", () => {
    const low = agent({ fitnessPercentile: 20, capital: 9 });
    const high = agent({ fitnessPercentile: 80 });
    runEvaluation([low, high], [owner([low, high])], 1);
    expect(low.capital).toBeLessThan(low.principal);
  });

  test("never moves capital across owners, and owners without a policy or with one agent move nothing", () => {
    const a = agent({ ownerId: "x", fitnessPercentile: 10 });
    const b = agent({ ownerId: "y", fitnessPercentile: 90 });
    const c = agent({ ownerId: "z", fitnessPercentile: 15 });
    const d = agent({ ownerId: "z", fitnessPercentile: 95 });
    const all = [a, b, c, d];
    const r = runEvaluation(all, [owner(all, {}, "x"), owner(all, {}, "y"), owner(all, null, "z")], 1);
    expect(r.moves).toEqual([]);
    expect(outcomeOf(r, a)).toEqual({ kind: "off", reason: "one-agent" });
    expect(outcomeOf(r, c)).toEqual({ kind: "off", reason: "no-policy" });
  });

  test("an agent the policy does not name is never moved, and a policy naming one live agent moves nothing", () => {
    const a = agent({ fitnessPercentile: 10 });
    const b = agent({ fitnessPercentile: 90 });
    const r = runEvaluation([a, b], [owner([a, b], { agentIds: [b.id] })], 1);
    expect(r.moves).toEqual([]);
    expect(outcomeOf(r, a)).toEqual({ kind: "off", reason: "not-covered" });
    expect(outcomeOf(r, b)).toEqual({ kind: "off", reason: "too-few-covered" });
  });

  test("a flagged top agent receives nothing, so its source holds", () => {
    const low = agent({ fitnessPercentile: 20 });
    const high = agent({ fitnessPercentile: 90, zeroDownsideFlag: true });
    const r = runEvaluation([low, high], [owner([low, high])], 1);
    expect(r.moves).toEqual([]);
    expect(outcomeOf(r, high)).toEqual({ kind: "held", reason: "zero-downside" });
    expect(outcomeOf(r, low)).toEqual({ kind: "held", reason: "counterpart" });
  });

  test("a sink at its ceiling and a source at the floor hold", () => {
    const low = agent({ fitnessPercentile: 20 });
    const high = agent({ fitnessPercentile: 90, capital: 40 });
    const r1 = runEvaluation([low, high], [owner([low, high])], 1);
    expect(outcomeOf(r1, high)).toEqual({ kind: "held", reason: "ceiling" });

    const floor = agent({ fitnessPercentile: 20, capital: CAPITAL_FLOOR });
    const top = agent({ fitnessPercentile: 90 });
    const r2 = runEvaluation([floor, top], [owner([floor, top])], 1);
    expect(outcomeOf(r2, floor)).toEqual({ kind: "held", reason: "floor" });
    expect(outcomeOf(r2, top)).toEqual({ kind: "held", reason: "counterpart" });
  });

  test("a policy can tighten the bounds; one that tries to loosen them is rejected as a whole", () => {
    const mk = () => [agent({ fitnessPercentile: 20 }), agent({ fitnessPercentile: 80 })];
    const tight = mk();
    expect(runEvaluation(tight, [owner(tight, { reallocationCap: 0.1 })], 1).moves[0]!.amount).toBeCloseTo(1, 9);
    const loose = mk();
    const r = runEvaluation(loose, [owner(loose, { reallocationCap: REALLOCATION_CAP * 2 })], 1);
    expect(r.moves).toEqual([]);
    expect(outcomeOf(r, loose[0]!)).toEqual({ kind: "off", reason: "policy-invalid" });
  });

  test("retires starved agents and agents below the floor, leaving their capital where it is", () => {
    const starved = agent({ fitnessPercentile: 3, lowWindows: RETIREMENT_WINDOWS - 1, capital: 7 });
    const broke = agent({ fitnessPercentile: 40, capital: CAPITAL_FLOOR / 2 });
    const top = agent({ fitnessPercentile: 90 });
    const all = [starved, broke, top];
    const r = runEvaluation(all, [owner(all)], 5);
    expect(outcomeOf(r, starved)).toEqual({ kind: "retired", rule: "starvation" });
    expect(outcomeOf(r, broke)).toEqual({ kind: "retired", rule: "floor" });
    expect(starved.capital).toBe(7);
    expect(starved.retirement).toEqual({ rule: "starvation", evaluation: 5 });
    expect(r.moves).toEqual([]);
    expect(outcomeOf(r, top)).toEqual({ kind: "off", reason: "one-agent" });
  });

  test("counts low windows and resets them outside the bottom decile", () => {
    const a = agent({ fitnessPercentile: 5, lowWindows: 1 });
    const b = agent({ fitnessPercentile: 60, lowWindows: 2 });
    runEvaluation([a, b], [owner([a, b], null)], 1);
    expect(a.lowWindows).toBe(2);
    expect(b.lowWindows).toBe(0);
  });

  test("agents without an adjusted fitness or paused are not ranked", () => {
    const fresh = agent({ fitnessPercentile: null, tradeCount: 0 });
    const paused = agent({ status: "paused" });
    const a = agent({ fitnessPercentile: 30 });
    const b = agent({ fitnessPercentile: 70 });
    const all = [fresh, paused, a, b];
    const r = runEvaluation(all, [owner(all)], 1);
    expect(outcomeOf(r, fresh)).toEqual({ kind: "unranked", reason: "no-fitness" });
    expect(outcomeOf(r, paused)).toEqual({ kind: "unranked", reason: "paused" });
    expect(r.moves.length).toBe(1);
  });

  test("uses deciles from 20 ranked agents up", () => {
    const all = Array.from({ length: 20 }, (_, i) => agent({ fitnessPercentile: i * 5 + 1 }));
    const r = runEvaluation(all, [owner(all)], 1);
    expect(r.outcomes.filter((v) => v.outcome.kind === "sent").length).toBe(2);
    expect(r.outcomes.filter((v) => v.outcome.kind === "received").length).toBe(2);
  });
});

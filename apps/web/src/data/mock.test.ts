import { describe, expect, test } from "bun:test";
import { CAPITAL_FLOOR } from "@monadeum/reallocation/constants";
import { PROTOCOL } from "monadeum-simulation/protocol";
import { boundsFor } from "./evaluate";
import { FIRST_EVALUATION, generatePopulation, LAST_EVALUATION } from "./mock";

describe("sample population respects the adopted mechanism", () => {
  const { owners, agents, moves, evaluations } = generatePopulation();
  const byId = new Map(agents.map((a) => [a.id, a]));
  const ownerOf = new Map(owners.map((o) => [o.id, o]));
  const last = evaluations.filter((v) => v.evaluation === LAST_EVALUATION);

  test("capital moves at all, so the invariants below are exercised", () => {
    expect(moves.length).toBeGreaterThan(5);
  });

  test("every move stays inside one owner, between two of that owner's covered agents", () => {
    for (const m of moves) {
      const s = byId.get(m.sourceId)!;
      const k = byId.get(m.sinkId)!;
      expect(s.ownerId).toBe(m.ownerId);
      expect(k.ownerId).toBe(m.ownerId);
      const policy = ownerOf.get(m.ownerId)!.policy!;
      expect(policy.agentIds).toContain(s.id);
      expect(policy.agentIds).toContain(k.id);
      expect(m.amount).toBeGreaterThan(0);
    }
  });

  test("an owner without a policy never moves capital", () => {
    for (const o of owners.filter((x) => !x.policy)) expect(moves.some((m) => m.ownerId === o.id)).toBe(false);
  });

  test("the sample shows every state the explainer describes at the last evaluation", () => {
    const seen = new Set(last.map((v) => `${v.outcome.kind}:${"reason" in v.outcome ? v.outcome.reason : "rule" in v.outcome ? v.outcome.rule : ""}`));
    for (const state of [
      "off:one-agent",
      "off:no-policy",
      "off:not-covered",
      "unranked:no-fitness",
      "unranked:paused",
      "sent:",
      "received:",
      "held:floor",
      "held:ceiling",
      "held:zero-downside",
      "held:middle",
      "retired:floor",
      "retired:starvation",
      "retired:owner",
    ])
      expect(seen).toContain(state);
  });

  test("a retired agent keeps its capital and is never in a later move", () => {
    for (const a of agents.filter((x) => x.retirement)) {
      const after = moves.filter((m) => m.evaluation >= a.retirement!.evaluation && (m.sourceId === a.id || m.sinkId === a.id));
      expect(after).toEqual([]);
      const i = a.retirement!.evaluation - FIRST_EVALUATION + 1;
      for (const c of a.capitalHistory.slice(i)) expect(c).toBe(a.capitalHistory[i]!);
    }
  });

  test("a sink never ends a move above its ceiling, and no agent goes below the floor through reallocation", () => {
    for (const v of evaluations) {
      const a = byId.get(v.agentId)!;
      if (v.outcome.kind === "received") {
        const i = v.evaluation - FIRST_EVALUATION + 1;
        expect(a.capitalHistory[i]!).toBeLessThanOrEqual(boundsFor(ownerOf.get(a.ownerId)).ceiling * a.principal + 1e-9);
      }
      if (v.outcome.kind === "sent") {
        const i = v.evaluation - FIRST_EVALUATION + 1;
        expect(a.capitalHistory[i]!).toBeGreaterThanOrEqual(CAPITAL_FLOOR);
      }
    }
  });

  test("at least one source ends below its own principal, which the explainer must state", () => {
    expect(last.some((v) => v.outcome.kind === "sent" && byId.get(v.agentId)!.capital < byId.get(v.agentId)!.principal)).toBe(true);
  });

  test("the population stays under the testnet cap", () => {
    expect(agents.length).toBeLessThanOrEqual(PROTOCOL.testnetPopulationCap);
  });

  test("every genome stays inside the protocol bounds", () => {
    for (const a of agents) {
      expect(a.genome.riskTolerance).toBeGreaterThanOrEqual(PROTOCOL.riskFloor);
      expect(a.genome.riskTolerance).toBeLessThanOrEqual(PROTOCOL.riskCeiling);
      expect(a.genome.executionFrequency).toBeGreaterThanOrEqual(PROTOCOL.frequencyMin);
      expect(a.genome.executionFrequency).toBeLessThanOrEqual(PROTOCOL.frequencyMax);
    }
  });

  test("the same seed yields the same population", () => {
    expect(generatePopulation()).toEqual(generatePopulation());
  });
});

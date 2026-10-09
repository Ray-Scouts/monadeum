import { describe, expect, test } from "bun:test";
import { PROTOCOL } from "monadeum-simulation/protocol";
import { generatePopulation } from "./mock";

describe("sample population respects the protocol invariants", () => {
  const { agents, reproductions } = generatePopulation();

  test("it reproduces at all, so the invariants below are exercised", () => {
    expect(reproductions.length).toBeGreaterThan(5);
  });

  test("a parent never ends a reproduction below its principal", () => {
    for (const r of reproductions) expect(r.parentCapitalAfter).toBeGreaterThanOrEqual(r.parentPrincipal);
  });

  test("reproduction conserves capital: the child gets exactly what the parent loses", () => {
    for (const r of reproductions) expect(r.parentCapitalAfter + r.childCapital).toBeCloseTo(r.parentCapitalBefore, 9);
  });

  test("no child receives more than the per-child ceiling", () => {
    for (const r of reproductions) expect(r.childCapital).toBeLessThanOrEqual(PROTOCOL.principal);
  });

  test("no parent exceeds the descendant cap and the population stays under its cap", () => {
    for (const a of agents) expect(a.childIds.length).toBeLessThanOrEqual(PROTOCOL.maxDescendants);
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
    expect(generatePopulation().agents).toEqual(agents);
  });
});

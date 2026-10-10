import { describe, expect, test } from "bun:test";
import { flowMatrix } from "./flow";
import { FIRST_EVALUATION, generatePopulation, LAST_EVALUATION } from "./mock";

describe("flowMatrix", () => {
  const { owners, agents, moves } = generatePopulation();

  test("each owner's net reallocation sums to zero at every evaluation", () => {
    for (const o of owners) {
      const rows = flowMatrix(agents.filter((a) => a.ownerId === o.id), moves.filter((m) => m.ownerId === o.id), FIRST_EVALUATION, LAST_EVALUATION);
      for (let i = 0; i <= LAST_EVALUATION - FIRST_EVALUATION; i++) expect(rows.reduce((s, r) => s + r.net[i]!, 0)).toBeCloseTo(0, 6);
    }
  });

  test("a source shows a negative entry and a sink a positive one", () => {
    const m = moves[0]!;
    const rows = flowMatrix(agents, [m], m.evaluation, m.evaluation);
    expect(rows.find((r) => r.agent.id === m.sourceId)!.net[0]).toBe(-m.amount);
    expect(rows.find((r) => r.agent.id === m.sinkId)!.net[0]).toBe(m.amount);
  });
});

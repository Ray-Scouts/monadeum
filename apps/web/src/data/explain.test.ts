import { describe, expect, test } from "bun:test";
import { CAPITAL_FLOOR, REALLOCATION_CAP, RETIREMENT_WINDOWS } from "@monadeum/reallocation/constants";
import { explain, outcomeShort, proximity } from "./explain";
import { generatePopulation, LAST_EVALUATION } from "./mock";
import { agent, owner } from "./test-helpers";
import type { AgentEvaluation, Outcome } from "./types";

const ev = (outcome: Outcome, rank: AgentEvaluation["rank"] = null): AgentEvaluation => ({ agentId: "a", evaluation: 9, outcome, rank });
const text = (x: { headline: string; why: string; change: string }) => `${x.headline} ${x.why} ${x.change}`;

describe("explain", () => {
  const a = agent({ id: "a" });
  const o = owner([a]);

  test("every state the sample produces has plain, complete copy with no em dash and no raw formula", () => {
    const { owners, agents, evaluations } = generatePopulation();
    for (const v of evaluations.filter((x) => x.evaluation === LAST_EVALUATION)) {
      const ag = agents.find((x) => x.id === v.agentId)!;
      const x = explain(ag, v, owners.find((w) => w.id === ag.ownerId) ?? null);
      for (const part of [x.label, x.headline, x.why, x.change]) {
        expect(part.length).toBeGreaterThan(0);
        expect(part).not.toContain("\u2014");
        expect(part).not.toMatch(/sortino|w\(n\)|riskTolerance|n \/ \(n/i);
      }
      expect(outcomeShort(v.outcome).length).toBeGreaterThan(0);
    }
  });

  test("states why reallocation is off", () => {
    expect(text(explain(a, ev({ kind: "off", reason: "no-policy" }), owner([a], null)))).toContain("has not signed a reallocation policy");
    expect(text(explain(a, ev({ kind: "off", reason: "one-agent" }), o))).toContain("one agent gets no benefit");
  });

  test("states that an agent is not ranked because it has no adjusted fitness yet", () => {
    expect(explain(a, ev({ kind: "unranked", reason: "no-fitness" }), o).headline).toContain("no adjusted fitness yet");
  });

  test("states the amount sent and that the agent ranked lowest", () => {
    const x = explain(a, ev({ kind: "sent", amount: 1.2 }, { position: 1, of: 3, quota: 1 }), o, [{ label: "Vela·0001", amount: 1.2 }]);
    expect(x.headline).toContain("Sent $1.20");
    expect(x.headline).toContain("Vela·0001");
    expect(x.why).toContain("ranked lowest of the 3 agents");
  });

  test("states the amount received and that the agent ranked highest", () => {
    const x = explain(a, ev({ kind: "received", amount: 0.5 }, { position: 3, of: 3, quota: 1 }), o);
    expect(x.headline).toContain("Received $0.50");
    expect(x.why).toContain("ranked highest of the 3 agents");
  });

  test("names the binding reason when a ranked agent moved nothing", () => {
    expect(explain(a, ev({ kind: "held", reason: "floor" }), o).headline).toContain("capital floor");
    expect(explain(a, ev({ kind: "held", reason: "ceiling" }), o).headline).toContain("slot ceiling");
    expect(explain(a, ev({ kind: "held", reason: "zero-downside" }), o).headline).toContain("zero downside");
    expect(explain(a, ev({ kind: "held", reason: "middle" }), o).headline).toContain("middle");
  });

  test("names the retirement rule and says the capital stayed in the agent's account", () => {
    const r = agent({ id: "r", status: "retired", capital: 4.2, retirement: { rule: "starvation", evaluation: 7 } });
    const x = explain(r, ev({ kind: "retired", rule: "starvation" }), o);
    expect(x.headline).toContain(`${RETIREMENT_WINDOWS} evaluations in a row`);
    expect(x.headline).toContain("evaluation 7");
    expect(x.why).toContain("stayed in its own account");
    expect(explain(r, ev({ kind: "retired", rule: "floor" }), o).headline).toContain("floor");
  });
});

describe("proximity", () => {
  test("reports the starvation count, the floor and the ceiling under the owner's bounds", () => {
    const a = agent({ lowWindows: 2, capital: 12 });
    const p = proximity(a, owner([a], { slotCeiling: 2 }));
    expect(`${p.lowWindows} of ${p.starvationWindows}`).toBe(`2 of ${RETIREMENT_WINDOWS}`);
    expect(p.ceilingCapital).toBe(20);
    expect(p.maxSend).toBeCloseTo(REALLOCATION_CAP * 12, 6);
    expect(p.maxReceive).toBeCloseTo(8, 6);
    expect(p.floor).toBe(CAPITAL_FLOOR);
  });

  test("a flagged agent can receive nothing", () => {
    const a = agent({ zeroDownsideFlag: true });
    expect(proximity(a, owner([a])).maxReceive).toBe(0);
  });
});

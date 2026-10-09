import { PROTOCOL } from "monadeum-simulation/protocol";
import type { Agent } from "./types";

export interface EligibilityCheck {
  key: "active" | "trades" | "cooldown" | "percentile" | "profit";
  label: string;
  ok: boolean;
  detail: string;
}

const usd = (v: number) => `$${v.toFixed(2)}`;

/**
 * The five reproduction conditions from EVOLUTION.md section 3.1.
 * ponytail: mirrors simulation/src/reproduction.ts; import it from libs/reproduction once the worker needs it there.
 */
export function eligibilityChecks(agent: Agent): EligibilityCheck[] {
  const percentileFloor = PROTOCOL.pThreshold * 100;
  const profit = agent.capital - agent.principal;
  const needed = PROTOCOL.profitThresholdFraction * agent.principal;
  return [
    {
      key: "active",
      label: "Active status",
      ok: agent.status === "active",
      detail: agent.status === "review" ? "Paused for review: zero losses in the window" : "Only active agents are evaluated",
    },
    { key: "trades", label: `At least ${PROTOCOL.nMin} trades`, ok: agent.tradeCount >= PROTOCOL.nMin, detail: `Has ${agent.tradeCount}` },
    {
      key: "cooldown",
      label: `${PROTOCOL.cooldown}-tick cooldown`,
      ok: agent.ticksSinceReproduction >= PROTOCOL.cooldown,
      detail: `Last event ${agent.ticksSinceReproduction} ticks ago`,
    },
    {
      key: "percentile",
      label: `Percentile at or above ${percentileFloor} in its niche`,
      ok: agent.fitnessPercentile >= percentileFloor,
      detail: `Percentile ${agent.fitnessPercentile}`,
    },
    {
      key: "profit",
      label: `Profit at least ${PROTOCOL.profitThresholdFraction * 100}% of principal`,
      ok: profit >= needed,
      detail: `${usd(Math.max(0, profit))} of ${usd(needed)} needed`,
    },
  ];
}

/** All five checks, below the descendant cap, and room left in the population. */
export function isEligible(agent: Agent, populationSize: number): boolean {
  return (
    eligibilityChecks(agent).every((c) => c.ok) &&
    agent.childIds.length < PROTOCOL.maxDescendants &&
    populationSize < PROTOCOL.testnetPopulationCap
  );
}

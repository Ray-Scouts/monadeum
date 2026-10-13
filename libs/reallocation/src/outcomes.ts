import { reallocationQuota, type AgentState, type EvaluationPlan, type ReallocationPolicy } from "./plan.js";

/** Why a ranked agent moved nothing. `counterpart` means the agents on the other side could not give or take anything. */
export type HeldReason = "floor" | "ceiling" | "zero-downside" | "middle" | "counterpart" | "alone";

export type OffReason = "no-policy" | "one-agent" | "not-covered" | "too-few-covered" | "policy-invalid";

/**
 * What one evaluation's plan did to one agent (EVOLUTION.md sections 3.1 and 6). `sent` and `received` carry no amount:
 * the caller attaches the amount in its own units (the worker the base units it submitted, the web its rounded figures).
 */
export type AgentOutcome =
  | { kind: "off"; reason: OffReason }
  | { kind: "unranked"; reason: "no-fitness" }
  | { kind: "sent" }
  | { kind: "received" }
  | { kind: "held"; reason: HeldReason }
  | { kind: "retired" };

/** Position in the owner's ranking pool (1 is the lowest), the pool size, and the small-pool quota of sources and sinks. */
export interface PoolRank {
  position: number;
  of: number;
  quota: number;
}

export interface AgentEvaluationOutcome {
  outcome: AgentOutcome;
  rank: PoolRank | null;
}

/** Amounts are compared at six decimals, rounded down, so a dust offer or room reads as none. */
const down6 = (v: number) => Math.floor(v * 1e6 + 1e-9) / 1e6;

/** Most an agent could send at one evaluation: a capped share of its capital, never going below the floor. */
export const offerOf = (capital: number, cap: number, floor: number) => down6(Math.max(0, Math.min(cap * capital, capital - floor)));

/** Most an agent could receive at one evaluation: up to its ceiling, a multiple of its principal. */
export const roomOf = (capital: number, principal: number, ceiling: number) => down6(Math.max(0, ceiling * principal - capital));

/**
 * Explains a plan per agent: for every agent in `population`, whether reallocation was off for it and why, whether it
 * was ranked, and, if ranked, whether it sent, received, or moved nothing and the binding reason. It reads the plan
 * `planEvaluation` returned for the same population and policies and decides nothing itself, so it cannot disagree
 * with what moved. `moved` names the agents that actually sent or received, when the caller drops moves the plan made
 * (for example one that rounds to zero); by default every planned move counts. Held reasons are judged on the
 * population's capital, which is the pre-move capital, and a held agent's capital does not change.
 */
export function evaluationOutcomes(
  population: readonly AgentState[],
  policies: readonly ReallocationPolicy[],
  plan: EvaluationPlan,
  moved?: { sent: ReadonlySet<string>; received: ReadonlySet<string> },
): Map<string, AgentEvaluationOutcome> {
  const sent = moved?.sent ?? new Set(plan.moves.map((m) => m.source));
  const received = moved?.received ?? new Set(plan.moves.map((m) => m.sink));
  const out = new Map<string, AgentEvaluationOutcome>();
  const set = (id: string, outcome: AgentOutcome, rank: PoolRank | null = null) => out.set(id, { outcome, rank });
  const byId = new Map(population.map((a) => [a.id, a]));
  const planOf = new Map(plan.owners.map((p) => [p.owner, p]));
  const policyOf = new Map(policies.map((p) => [p.owner, p]));

  for (const owner of [...new Set(population.map((a) => a.owner))]) {
    const mine = population.filter((a) => a.owner === owner);
    for (const a of mine) if (a.status === "retired") set(a.id, { kind: "retired" });
    const live = mine.filter((a) => a.status !== "retired");
    if (live.length === 1) {
      set(live[0]!.id, { kind: "off", reason: "one-agent" });
      continue;
    }
    const p = planOf.get(owner);
    const covered = new Set(policyOf.get(owner)?.agents ?? []);
    if (!p || p.outcome !== "planned") {
      for (const a of live) {
        if (!p || p.outcome === "no_policy" || p.outcome === "revoked") set(a.id, { kind: "off", reason: "no-policy" });
        else if (!covered.has(a.id)) set(a.id, { kind: "off", reason: "not-covered" });
        else set(a.id, { kind: "off", reason: p.outcome === "too_few_agents" ? "too-few-covered" : "policy-invalid" });
      }
      continue;
    }
    for (const a of live) {
      if (!covered.has(a.id)) set(a.id, { kind: "off", reason: "not-covered" });
      else if (a.adjustedFitness === null) set(a.id, { kind: "unranked", reason: "no-fitness" });
    }
    // The planner's pool, lowest first, and its small-pool quota.
    const pool = [...p.ranked].reverse().map((id) => byId.get(id)!);
    const n = pool.length;
    const q = reallocationQuota(n);
    const b = p.bounds!;
    pool.forEach((a, i) => {
      const rank = { position: i + 1, of: n, quota: q };
      if (q < 1) set(a.id, { kind: "held", reason: "alone" }, rank);
      else if (sent.has(a.id)) set(a.id, { kind: "sent" }, rank);
      else if (received.has(a.id)) set(a.id, { kind: "received" }, rank);
      else if (i < q) set(a.id, { kind: "held", reason: offerOf(a.capital, b.reallocationCap, b.capitalFloor) > 0 ? "counterpart" : "floor" }, rank);
      else if (i >= n - q) {
        if (a.flaggedZeroDownside) set(a.id, { kind: "held", reason: "zero-downside" }, rank);
        else set(a.id, { kind: "held", reason: roomOf(a.capital, a.principal, b.slotCeiling) > 0 ? "counterpart" : "ceiling" }, rank);
      } else set(a.id, { kind: "held", reason: "middle" }, rank);
    });
  }
  for (const a of population) if (!out.has(a.id)) set(a.id, { kind: "unranked", reason: "no-fitness" });
  return out;
}

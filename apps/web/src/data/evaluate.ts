import {
  CAPITAL_FLOOR,
  REALLOCATION_CAP,
  RETIREMENT_WINDOWS,
  SLOT_CEILING,
  STARVATION_PERCENTILE as STARVATION_FRACTION,
} from "@monadeum/reallocation/constants";
import { planEvaluation, reallocationQuota, type AgentState, type ReallocationPolicy as PlannerPolicy } from "@monadeum/reallocation/plan";
import type { Agent, AgentEvaluation, Outcome, Owner, Reallocation } from "./types";

/** The bounds one owner's reallocation runs under. */
export interface Bounds {
  cap: number;
  ceiling: number;
  floor: number;
}

/** Protocol bounds, tightened by the owner's policy where it asks for less. A policy can never loosen them. */
export function boundsFor(owner: Pick<Owner, "policy"> | null | undefined): Bounds {
  const p = owner?.policy;
  return {
    cap: Math.min(REALLOCATION_CAP, p?.reallocationCap ?? Infinity),
    ceiling: Math.min(SLOT_CEILING, p?.slotCeiling ?? Infinity),
    floor: CAPITAL_FLOOR,
  };
}

/** Bottom decile of the niche, the starvation zone in EVOLUTION.md section 6, on the 0 to 100 percentile scale the UI shows. */
export const STARVATION_PERCENTILE = STARVATION_FRACTION * 100;

/** Amounts are kept to six decimals and rounded down, so rounding can never break the floor or the ceiling. */
export const round6 = (v: number) => Math.round(v * 1e6) / 1e6;
const down6 = (v: number) => Math.floor(v * 1e6 + 1e-9) / 1e6;

/** Most this agent could send at one evaluation: a capped share of its capital, never going below the floor. */
export const offerOf = (capital: number, b: Bounds) => down6(Math.max(0, Math.min(b.cap * capital, capital - b.floor)));
/** Most this agent could receive at one evaluation: up to its ceiling, a multiple of its principal. */
export const roomOf = (capital: number, principal: number, b: Bounds) => down6(Math.max(0, b.ceiling * principal - capital));

export interface EvaluationResult {
  moves: Reallocation[];
  outcomes: AgentEvaluation[];
}

/**
 * One evaluation under EVOLUTION.md sections 3.1 and 6, applied in place: the starvation count and retirement first,
 * then the moves planned by `planEvaluation` from `@monadeum/reallocation`, the planner the worker uses. This function
 * only adds the per-agent explanation of what the planner did. The sample has no raw fitness, so the niche percentile
 * stands in for adjusted fitness; within one niche they order agents the same way. Fitness must already be current.
 */
export function runEvaluation(agents: Agent[], owners: Owner[], evaluation: number): EvaluationResult {
  const outcomes = new Map<string, AgentEvaluation>();
  const set = (a: Agent, outcome: Outcome, rank: AgentEvaluation["rank"] = null) => outcomes.set(a.id, { agentId: a.id, evaluation, outcome, rank });

  for (const a of agents) {
    if (a.status !== "active") continue;
    if (a.fitnessPercentile !== null) a.lowWindows = a.fitnessPercentile <= STARVATION_PERCENTILE ? a.lowWindows + 1 : 0;
    if (a.capital < CAPITAL_FLOOR) a.retirement = { rule: "floor", evaluation };
    else if (a.lowWindows >= RETIREMENT_WINDOWS) a.retirement = { rule: "starvation", evaluation };
    if (a.retirement) a.status = "retired";
  }

  // the planner ranks Active agents only; a paused agent is passed without a fitness, so it is never in a pool
  const population: AgentState[] = agents.map((a) => ({
    id: a.id,
    owner: a.ownerId,
    status: a.status === "retired" ? "retired" : "active",
    capital: a.capital,
    principal: a.principal,
    adjustedFitness: a.status === "active" ? a.fitnessPercentile : null,
    flaggedZeroDownside: a.zeroDownsideFlag,
  }));
  const policies: PlannerPolicy[] = owners.flatMap((o) =>
    o.policy ? [{ owner: o.id, agents: o.policy.agentIds, reallocationCap: o.policy.reallocationCap, slotCeiling: o.policy.slotCeiling }] : [],
  );
  const plan = planEvaluation(population, policies);
  const planOf = new Map(plan.owners.map((p) => [p.owner, p]));
  const byId = new Map(agents.map((a) => [a.id, a]));

  // amounts rounded down to six decimals, applied to both sides, so each owner's total is unchanged exactly
  const moves: Reallocation[] = plan.moves
    .map((m) => ({ evaluation, ownerId: m.owner, sourceId: m.source, sinkId: m.sink, amount: down6(m.amount) }))
    .filter((m) => m.amount > 0);
  const sent = new Map<string, number>();
  const got = new Map<string, number>();
  for (const m of moves) {
    sent.set(m.sourceId, round6((sent.get(m.sourceId) ?? 0) + m.amount));
    got.set(m.sinkId, round6((got.get(m.sinkId) ?? 0) + m.amount));
    byId.get(m.sourceId)!.capital = round6(byId.get(m.sourceId)!.capital - m.amount);
    byId.get(m.sinkId)!.capital = round6(byId.get(m.sinkId)!.capital + m.amount);
  }

  for (const owner of owners) {
    const mine = agents.filter((a) => a.ownerId === owner.id);
    for (const a of mine) if (a.status === "retired") set(a, { kind: "retired", rule: a.retirement?.rule ?? "owner" });
    const live = mine.filter((a) => a.status !== "retired");
    if (live.length === 1) {
      set(live[0]!, { kind: "off", reason: "one-agent" });
      continue;
    }
    const p = planOf.get(owner.id);
    if (!p || p.outcome !== "planned") {
      const covered = new Set(owner.policy?.agentIds ?? []);
      for (const a of live) {
        if (!p || p.outcome === "no_policy" || p.outcome === "revoked") set(a, { kind: "off", reason: "no-policy" });
        else if (!covered.has(a.id)) set(a, { kind: "off", reason: "not-covered" });
        else set(a, { kind: "off", reason: p.outcome === "too_few_agents" ? "too-few-covered" : "policy-invalid" });
      }
      continue;
    }
    const covered = new Set(owner.policy?.agentIds ?? []);
    for (const a of live) {
      if (!covered.has(a.id)) set(a, { kind: "off", reason: "not-covered" });
      else if (a.status === "paused") set(a, { kind: "unranked", reason: "paused" });
      else if (a.fitnessPercentile === null) set(a, { kind: "unranked", reason: "no-fitness" });
    }
    // the planner's pool, lowest first, and its small-pool quota
    const pool = [...p.ranked].reverse().map((id) => byId.get(id)!);
    const n = pool.length;
    const q = reallocationQuota(n);
    const rankOf = (a: Agent) => ({ position: pool.indexOf(a) + 1, of: n, quota: q });
    const b = boundsFor(owner);
    pool.forEach((a, i) => {
      const r = rankOf(a);
      if (q < 1) set(a, { kind: "held", reason: "alone" }, r);
      else if (sent.has(a.id)) set(a, { kind: "sent", amount: sent.get(a.id)! }, r);
      else if (got.has(a.id)) set(a, { kind: "received", amount: got.get(a.id)! }, r);
      else if (i < q) set(a, { kind: "held", reason: offerOf(a.capital, b) > 0 ? "counterpart" : "floor" }, r);
      else if (i >= n - q) {
        if (a.zeroDownsideFlag) set(a, { kind: "held", reason: "zero-downside" }, r);
        else set(a, { kind: "held", reason: roomOf(a.capital, a.principal, b) > 0 ? "counterpart" : "ceiling" }, r);
      } else set(a, { kind: "held", reason: "middle" }, r);
    });
  }

  for (const a of agents) if (!outcomes.has(a.id)) set(a, { kind: "unranked", reason: a.status === "paused" ? "paused" : "no-fitness" });
  return { moves, outcomes: agents.map((a) => outcomes.get(a.id)!) };
}

import { CAPITAL_FLOOR, MIN_POLICY_AGENTS, REALLOCATION_CAP, SLOT_CEILING } from "./constants.js";

/** What the planner needs to know about one agent at an evaluation. Amounts are in settlement-asset units. */
export interface AgentState {
  id: string;
  owner: string;
  status: "active" | "retired";
  capital: number;
  /** The owner's deposits to this agent minus the owner's withdrawals from it. Reallocation never changes it. */
  principal: number;
  /** Shrinkage-adjusted fitness (EVOLUTION.md section 2), or null when the agent has none this window. */
  adjustedFitness: number | null;
  /** The section 2.3 zero-downside flag. A flagged agent is never a sink. */
  flaggedZeroDownside: boolean;
}

/**
 * An owner's reallocation policy (EVOLUTION.md section 3.1 item 8), as already verified to be signed by the owner's
 * root wallet. Each bound may only be tightened: a lower cap, a lower ceiling, a higher floor. An unset bound is the
 * protocol value. A revoked policy moves nothing from the next evaluation.
 */
export interface ReallocationPolicy {
  owner: string;
  /** The owner's agents that take part. At least `MIN_POLICY_AGENTS`, or nothing moves. */
  agents: readonly string[];
  reallocationCap?: number;
  slotCeiling?: number;
  capitalFloor?: number;
  revoked?: boolean;
}

export interface ReallocationBounds {
  reallocationCap: number;
  slotCeiling: number;
  capitalFloor: number;
}

export const PROTOCOL_BOUNDS: Readonly<ReallocationBounds> = Object.freeze({
  reallocationCap: REALLOCATION_CAP,
  slotCeiling: SLOT_CEILING,
  capitalFloor: CAPITAL_FLOOR,
});

/** Why an owner's policy is not in force. Every one of these moves nothing for that owner (fail closed). */
export type PolicyRejection =
  | "no_policy"
  | "revoked"
  | "invalid_bound"
  | "loosens_cap"
  | "loosens_ceiling"
  | "loosens_floor"
  | "duplicate_agent"
  | "unknown_agent"
  | "foreign_agent"
  | "too_few_agents";

export type PolicyResolution =
  | { inForce: true; bounds: ReallocationBounds; agents: ReadonlySet<string> }
  | { inForce: false; reason: PolicyRejection };

export interface PlanSink {
  capital: number;
  principal: number;
}

export interface ReallocationPlan {
  /** Amount taken from each source, in the order given. */
  debits: number[];
  /** Amount given to each sink, in the order given. */
  credits: number[];
  /** Total moved. Equal to the sum of the debits and to the sum of the credits, up to rounding. */
  moved: number;
}

/** One transfer between two agents of the same owner, executed as one atomic on-chain operation. */
export interface Move {
  owner: string;
  source: string;
  sink: string;
  amount: number;
}

export interface OwnerPlan {
  owner: string;
  /** `planned` when the policy is in force, whether or not anything moved; otherwise why nothing could move. */
  outcome: "planned" | PolicyRejection;
  bounds: ReallocationBounds | null;
  /** The ranking pool, best first. Empty when the policy is not in force. */
  ranked: string[];
  sources: { id: string; debit: number }[];
  sinks: { id: string; credit: number }[];
  moves: Move[];
  moved: number;
}

export interface EvaluationPlan {
  owners: OwnerPlan[];
  moves: Move[];
  moved: number;
}

/**
 * Bounded reallocation, a pure function of balances (EVOLUTION.md section 3.1 item 6). Each source offers `cap` of its
 * capital, never going below `floor`. Each sink can take up to `ceiling * principal - capital`. The amount moved is the
 * smaller of the total offer and the total room. Sources give in proportion to their offers and sinks receive in
 * proportion to their room. The arithmetic is the simulation's (`simulation/src/reallocation.ts`), operation for
 * operation, so the two return identical numbers on identical inputs.
 */
export function planReallocation(
  sources: readonly number[],
  sinks: readonly PlanSink[],
  cap: number,
  ceiling: number,
  floor: number,
): ReallocationPlan {
  const offers = sources.map((capital) => Math.max(0, Math.min(cap * capital, capital - floor)));
  const rooms = sinks.map((sink) => Math.max(0, ceiling * sink.principal - sink.capital));
  const pool = offers.reduce((sum, value) => sum + value, 0);
  const room = rooms.reduce((sum, value) => sum + value, 0);
  const moved = Math.min(pool, room);
  if (!(moved > 0)) return { debits: sources.map(() => 0), credits: sinks.map(() => 0), moved: 0 };
  return {
    debits: offers.map((offer) => offer * (moved / pool)),
    credits: rooms.map((space) => space * (moved / room)),
    moved,
  };
}

/**
 * Small-pool rule (EVOLUTION.md section 3.1 item 5): how many agents are sources, and how many are sinks, in an owner's
 * pool of `ranked` agents. None below 2, the bottom one and the top one from 2 to 19, the bottom and top decile from 20.
 */
export function reallocationQuota(ranked: number): number {
  const decile = Math.floor(ranked / 10);
  return ranked >= 2 ? Math.max(1, decile) : 0;
}

/** Best first by adjusted fitness, ties broken by agent ID ascending, as in the simulation. */
export function rankPool(pool: readonly AgentState[]): AgentState[] {
  return [...pool].sort((a, b) => (b.adjustedFitness ?? 0) - (a.adjustedFitness ?? 0) || (a.id < b.id ? -1 : 1));
}

function finiteNonNegative(value: number | undefined): boolean {
  return value === undefined || (Number.isFinite(value) && value >= 0);
}

/**
 * Whether an owner's policy is in force, and with which bounds and agents. `population` is every known agent, so a
 * policy naming another owner's agent, or an agent that does not exist, is rejected rather than silently trimmed.
 */
export function resolvePolicy(
  policy: ReallocationPolicy | undefined,
  population: readonly AgentState[],
  protocol: Readonly<ReallocationBounds> = PROTOCOL_BOUNDS,
): PolicyResolution {
  if (!policy) return { inForce: false, reason: "no_policy" };
  const owner = policy.owner;
  if (policy.revoked) return { inForce: false, reason: "revoked" };
  if (!finiteNonNegative(policy.reallocationCap) || !finiteNonNegative(policy.slotCeiling) || !finiteNonNegative(policy.capitalFloor)) {
    return { inForce: false, reason: "invalid_bound" };
  }
  const bounds: ReallocationBounds = {
    reallocationCap: policy.reallocationCap ?? protocol.reallocationCap,
    slotCeiling: policy.slotCeiling ?? protocol.slotCeiling,
    capitalFloor: policy.capitalFloor ?? protocol.capitalFloor,
  };
  if (bounds.reallocationCap > protocol.reallocationCap) return { inForce: false, reason: "loosens_cap" };
  if (bounds.slotCeiling > protocol.slotCeiling) return { inForce: false, reason: "loosens_ceiling" };
  if (bounds.capitalFloor < protocol.capitalFloor) return { inForce: false, reason: "loosens_floor" };
  const agents = new Set(policy.agents);
  if (agents.size !== policy.agents.length) return { inForce: false, reason: "duplicate_agent" };
  const ownerOf = new Map(population.map((agent) => [agent.id, agent.owner]));
  for (const id of agents) {
    const agentOwner = ownerOf.get(id);
    if (agentOwner === undefined) return { inForce: false, reason: "unknown_agent" };
    if (agentOwner !== owner) return { inForce: false, reason: "foreign_agent" };
  }
  if (agents.size < MIN_POLICY_AGENTS) return { inForce: false, reason: "too_few_agents" };
  return { inForce: true, bounds, agents };
}

function emptyOwnerPlan(owner: string, outcome: OwnerPlan["outcome"], bounds: ReallocationBounds | null): OwnerPlan {
  return { owner, outcome, bounds, ranked: [], sources: [], sinks: [], moves: [], moved: 0 };
}

/**
 * Plans one owner's reallocation from that owner's ranking pool (Active, with a fitness, covered by the policy).
 * Sinks are the top of the pool and sources the bottom, by the small-pool rule. A flagged agent picked as a sink is
 * dropped, not replaced by the next one, so the flag can only reduce what moves (section 3.1 item 9). Each source's
 * debit is split across the sinks in proportion to their credits, one move per (source, sink) pair.
 */
export function planOwner(owner: string, pool: readonly AgentState[], bounds: ReallocationBounds): OwnerPlan {
  const ranked = rankPool(pool);
  const plan = emptyOwnerPlan(owner, "planned", bounds);
  plan.ranked = ranked.map((agent) => agent.id);
  const q = reallocationQuota(ranked.length);
  if (q < 1) return plan;
  const sinks = ranked.slice(0, q).filter((agent) => !agent.flaggedZeroDownside);
  const sources = ranked.slice(ranked.length - q);
  const result = planReallocation(
    sources.map((agent) => agent.capital),
    sinks.map((agent) => ({ capital: agent.capital, principal: agent.principal })),
    bounds.reallocationCap,
    bounds.slotCeiling,
    bounds.capitalFloor,
  );
  if (!(result.moved > 0)) return plan;
  plan.sources = sources.map((agent, index) => ({ id: agent.id, debit: result.debits[index] ?? 0 }));
  plan.sinks = sinks.map((agent, index) => ({ id: agent.id, credit: result.credits[index] ?? 0 }));
  for (const source of plan.sources) {
    for (const sink of plan.sinks) {
      const amount = source.debit * (sink.credit / result.moved);
      if (amount > 0) plan.moves.push({ owner, source: source.id, sink: sink.id, amount });
    }
  }
  plan.moved = result.moved;
  return plan;
}

function assertAgent(agent: AgentState): void {
  const finite = Number.isFinite(agent.capital) && Number.isFinite(agent.principal);
  if (!finite || agent.capital < 0 || agent.principal < 0) {
    throw new RangeError(`agent ${agent.id} has invalid capital or principal`);
  }
  if (agent.adjustedFitness !== null && !Number.isFinite(agent.adjustedFitness)) {
    throw new RangeError(`agent ${agent.id} has a non-finite adjusted fitness`);
  }
}

/**
 * Plans one evaluation for the whole population. Reallocation is off by default: an owner without a policy in force
 * moves nothing. Every owner with an agent or a policy gets an entry, in owner order. Retired agents are never in a
 * pool, so they are never a source or a sink. No move crosses an owner boundary, because each pool holds one owner's
 * agents only.
 */
export function planEvaluation(
  population: readonly AgentState[],
  policies: readonly ReallocationPolicy[],
  protocol: Readonly<ReallocationBounds> = PROTOCOL_BOUNDS,
): EvaluationPlan {
  const ids = new Set<string>();
  for (const agent of population) {
    if (ids.has(agent.id)) throw new RangeError(`duplicate agent ${agent.id}`);
    ids.add(agent.id);
    assertAgent(agent);
  }
  const policyOf = new Map<string, ReallocationPolicy>();
  for (const policy of policies) {
    if (policyOf.has(policy.owner)) throw new RangeError(`more than one policy for owner ${policy.owner}`);
    policyOf.set(policy.owner, policy);
  }
  const owners = [...new Set([...population.map((agent) => agent.owner), ...policyOf.keys()])].sort();
  const plans: OwnerPlan[] = [];
  for (const owner of owners) {
    const resolution = resolvePolicy(policyOf.get(owner), population, protocol);
    if (!resolution.inForce) {
      plans.push(emptyOwnerPlan(owner, resolution.reason, null));
      continue;
    }
    const pool = population.filter(
      (agent) =>
        agent.owner === owner &&
        agent.status === "active" &&
        agent.adjustedFitness !== null &&
        resolution.agents.has(agent.id),
    );
    plans.push(planOwner(owner, pool, resolution.bounds));
  }
  const moves = plans.flatMap((plan) => plan.moves);
  const moved = plans.reduce((sum, plan) => sum + plan.moved, 0);
  return { owners: plans, moves, moved };
}

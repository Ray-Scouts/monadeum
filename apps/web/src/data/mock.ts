import { CAPITAL_FLOOR, EVALUATION_CADENCE, REALLOCATION_CAP, RETIREMENT_WINDOWS, SLOT_CEILING } from "@monadeum/reallocation/constants";
import { PROTOCOL } from "monadeum-simulation/protocol";
import { round6, runEvaluation } from "./evaluate";
import type { PopulationSource } from "./source";
import type {
  Agent,
  AgentEvaluation,
  BreakerState,
  EvolutionEvent,
  Limit,
  NepBreakdown,
  Owner,
  Reallocation,
  Trade,
  X402Purchase,
  X402Spend,
} from "./types";

/** Sample trading pairs for the prototype. The real allowlist is a platform decision not yet made. */
export const SAMPLE_PAIRS = ["MON/USDC", "WETH/USDC", "WBTC/USDC", "MON/WETH"] as const;

/** Sample evaluation sequence numbers. Each evaluation runs every `EVALUATION_CADENCE` ticks. */
export const FIRST_EVALUATION = 201;
export const LAST_EVALUATION = 208;
export const tickOf = (evaluation: number) => evaluation * EVALUATION_CADENCE;

function rng(seed: number) {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clip = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const round2 = (v: number) => Math.round(v * 100) / 100;

/**
 * One sample agent. `skill` is the centre of its fitness percentile and `spread` its noise; `drift` is its mean trading
 * return per evaluation. The roster is chosen so that, at the last evaluation, every state the explainer describes occurs.
 */
interface Spec {
  name: string;
  owner: string;
  principal: number;
  capital?: number;
  skill: number;
  spread?: number;
  drift?: number;
  noise?: number;
  /** Trades per evaluation; 0 means it never gets an adjusted fitness. */
  trades?: number;
  risk: number;
  flaggedFrom?: number;
  pausedFrom?: number;
  ownerRetiresAt?: number;
}

const OWNERS: { id: string; name: string; policy: { exclude?: string[]; cap?: number; ceiling?: number } | null }[] = [
  { id: "o1", name: "Owner 1", policy: null },
  { id: "o2", name: "Owner 2", policy: null },
  { id: "o3", name: "Owner 3", policy: {} },
  { id: "o4", name: "Owner 4", policy: { exclude: ["Quill"] } },
  { id: "o5", name: "Owner 5", policy: { cap: 0.1, ceiling: 2 } },
  { id: "o6", name: "Owner 6", policy: {} },
];

const ROSTER: Spec[] = [
  { name: "Kestrel", owner: "o1", principal: 10, skill: 62, risk: 0.07 },
  { name: "Lumen", owner: "o2", principal: 10, skill: 71, risk: 0.12 },
  { name: "Ferro", owner: "o2", principal: 5, skill: 38, risk: 0.03 },
  { name: "Zinc", owner: "o2", principal: 5, skill: 30, risk: 0.17, ownerRetiresAt: 204 },
  { name: "Vela", owner: "o3", principal: 10, skill: 88, spread: 8, drift: 0.01, risk: 0.12 },
  { name: "Orca", owner: "o3", principal: 10, skill: 55, spread: 10, risk: 0.07 },
  { name: "Nimbus", owner: "o3", principal: 10, skill: 22, spread: 8, drift: -0.01, risk: 0.22 },
  { name: "Quill", owner: "o4", principal: 10, skill: 48, risk: 0.12 },
  { name: "Sable", owner: "o4", principal: 10, skill: 50, trades: 0, risk: 0.07 },
  { name: "Tern", owner: "o4", principal: 10, skill: 93, spread: 4, drift: 0.02, risk: 0.03, flaggedFrom: 207 },
  { name: "Ion", owner: "o4", principal: 10, skill: 18, spread: 6, risk: 0.17 },
  { name: "Rook", owner: "o4", principal: 10, skill: 52, spread: 6, risk: 0.12 },
  { name: "Pike", owner: "o5", principal: 10, capital: 16, skill: 90, spread: 5, drift: 0.04, risk: 0.17 },
  { name: "Wren", owner: "o5", principal: 10, skill: 25, spread: 6, risk: 0.07 },
  { name: "Lynx", owner: "o5", principal: 10, skill: 55, spread: 8, risk: 0.12 },
  { name: "Cobalt", owner: "o5", principal: 10, skill: 60, spread: 8, risk: 0.22 },
  { name: "Moth", owner: "o5", principal: 10, skill: 4, spread: 4, drift: -0.03, risk: 0.22 },
  { name: "Iris", owner: "o5", principal: 10, skill: 45, risk: 0.07, pausedFrom: 206 },
  { name: "Juno", owner: "o6", principal: 10, skill: 85, spread: 6, drift: 0.01, risk: 0.12 },
  { name: "Onyx", owner: "o6", principal: 1, capital: 0.07, skill: 16, spread: 3, drift: 0, noise: 0, risk: 0.17 },
  { name: "Rune", owner: "o6", principal: 0.5, capital: 0.3, skill: 40, spread: 10, drift: -0.35, noise: 0, risk: 0.22 },
  { name: "Pax", owner: "o6", principal: 10, skill: 50, spread: 8, risk: 0.03 },
];

export interface Population {
  owners: Owner[];
  agents: Agent[];
  moves: Reallocation[];
  /** Every agent's outcome at every evaluation, oldest evaluation first. */
  evaluations: AgentEvaluation[];
}

/** Deterministic sample population. Every evaluation goes through `runEvaluation`, so every move uses the real bounds. */
export function generatePopulation(seed = 11): Population {
  const r = rng(seed);
  const hex = (n: number) => Array.from({ length: n }, () => "0123456789abcdef"[Math.floor(r() * 16)]).join("");
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!;

  const agents: Agent[] = ROSTER.map((s) => {
    const universe = SAMPLE_PAIRS.filter(() => r() > 0.45).slice(0, 3);
    const capital = s.capital ?? s.principal;
    return {
      id: hex(4),
      name: s.name,
      ownerId: s.owner,
      status: "active",
      principal: s.principal,
      capital,
      tradeCount: s.trades === 0 ? 0 : Math.round(10 + r() * 30),
      fitnessPercentile: null,
      lowWindows: 0,
      zeroDownsideFlag: false,
      retirement: null,
      address: `0x${hex(40)}`,
      genome: {
        strategyType: "trading",
        assetUniverse: universe.length ? universe : ["MON/USDC"],
        riskTolerance: s.risk,
        executionFrequency: Math.round(4 + r() * 20),
        timeHorizon: Math.round(12 + r() * 48),
        informationBudget: round2(0.01 + r() * 0.06),
        modelConfiguration: pick(PROTOCOL.allowedModels),
        hash: `0x${hex(8)}`,
      },
      capitalHistory: [capital],
    };
  });
  const specOf = new Map(agents.map((a, i) => [a, ROSTER[i]!]));

  const owners: Owner[] = OWNERS.map((o) => {
    const mine = agents.filter((a) => a.ownerId === o.id);
    return {
      id: o.id,
      name: o.name,
      rootWallet: `0x${hex(40)}`,
      policy: o.policy && {
        agentIds: mine.filter((a) => !o.policy!.exclude?.includes(a.name)).map((a) => a.id),
        reallocationCap: o.policy.cap ?? REALLOCATION_CAP,
        slotCeiling: o.policy.ceiling ?? SLOT_CEILING,
        signedAtEvaluation: FIRST_EVALUATION - 4,
      },
    };
  });

  const moves: Reallocation[] = [];
  const evaluations: AgentEvaluation[] = [];
  for (let e = FIRST_EVALUATION; e <= LAST_EVALUATION; e++) {
    for (const a of agents) {
      const s = specOf.get(a)!;
      if (a.status === "retired") continue;
      if (s.ownerRetiresAt === e) {
        a.status = "retired";
        a.retirement = { rule: "owner", evaluation: e };
        continue;
      }
      if (s.pausedFrom !== undefined && e >= s.pausedFrom) {
        a.status = "paused";
        continue;
      }
      // trading between evaluations: capital moves freely, fitness and counters settle
      const ret = (s.drift ?? 0) + (r() - 0.5) * 0.08 * (s.noise ?? 1);
      a.capital = round6(Math.max(0, a.capital * (1 + ret)));
      if (s.trades !== 0) a.tradeCount += Math.round(3 + r() * 6);
      a.fitnessPercentile = a.tradeCount === 0 ? null : Math.round(clip(s.skill + (r() - 0.5) * 2 * (s.spread ?? 25), 1, 99));
      a.zeroDownsideFlag = s.flaggedFrom !== undefined && e >= s.flaggedFrom;
    }
    const result = runEvaluation(agents, owners, e);
    moves.push(...result.moves);
    evaluations.push(...result.outcomes);
    for (const a of agents) a.capitalHistory.push(a.capital);
  }
  return { owners, agents, moves, evaluations };
}

const seedOf = (id: string) => parseInt(id, 16) || 1;
const usd = (v: number) => `$${v.toFixed(2)}`;

export function createMockSource(seed = 11): PopulationSource {
  const { owners, agents, moves, evaluations } = generatePopulation(seed);
  const byId = new Map(agents.map((a) => [a.id, a]));
  const label = (a: Agent) => `${a.name}·${a.id}`;
  const live = agents.filter((a) => a.status !== "retired");
  const latest = new Map(evaluations.filter((v) => v.evaluation === LAST_EVALUATION).map((v) => [v.agentId, v]));
  const ago = (evaluation: number) => (LAST_EVALUATION - evaluation) * 30 + 3;

  const events: EvolutionEvent[] = [];
  moves
    .filter((m) => m.evaluation >= LAST_EVALUATION - 1)
    .forEach((m, i) => {
      const s = byId.get(m.sourceId)!;
      const k = byId.get(m.sinkId)!;
      events.push({
        id: `move-${m.evaluation}-${s.id}-${k.id}`,
        kind: "reallocation",
        minutesAgo: ago(m.evaluation) + i,
        title: `${usd(m.amount)} moved from ${label(s)} to ${label(k)}`,
        body: `Evaluation ${m.evaluation}. Both agents belong to ${owners.find((o) => o.id === m.ownerId)?.name}, whose signed policy covers them. ${s.name} ranked lowest in that owner's pool and ${k.name} highest. The owner's total did not change.`,
        agentIds: [s.id, k.id],
        tags: ["same owner", "one atomic transfer"],
      });
    });
  const at = (i: number) => live[i % live.length]!;
  events.push(
    { id: "pol-1", kind: "policy", minutesAgo: 6, title: `Proposal rejected for ${label(at(2))}`, body: "Requested a $3.40 trade on MON/USDC. Exceeds the $2.50 per-transaction cap.", agentIds: [at(2).id], tags: ["per-transaction cap", "not executed"] },
    { id: "x-1", kind: "x402", minutesAgo: 9, title: `${label(at(3))} bought data from Nansen`, body: "Smart money flows for $0.03. The response changed its decision from buy to wait.", agentIds: [at(3).id], tags: ["x402", "changed the decision"] },
    { id: "pol-2", kind: "policy", minutesAgo: 14, title: `Proposal rejected for ${label(at(6))}`, body: "Tried to call a contract outside the allowlist. Only the Kuru router, the reallocation contract and the settlement asset are allowed.", agentIds: [at(6).id], tags: ["contract allowlist", "not executed"] },
    { id: "brk-1", kind: "breaker", minutesAgo: 22, title: "Population circuit breaker check", body: "Capital at risk at 31% of threshold. Capital moved by reallocation at 12% of threshold. No action needed.", agentIds: [], tags: ["automatic"] },
    { id: "x-2", kind: "x402", minutesAgo: 60, title: `${label(at(1))} skipped a purchase`, body: "Estimated that the expected value of DeFiLlama data ($0.02) did not justify the cost.", agentIds: [at(1).id], tags: ["x402", "no spend"] },
    { id: "pol-3", kind: "policy", minutesAgo: 120, title: `Daily x402 budget exhausted for ${label(at(4))}`, body: "Further information purchases are blocked until the 24 h window rolls over.", agentIds: [at(4).id], tags: ["daily cap"] },
  );
  for (const a of agents.filter((x) => x.zeroDownsideFlag && x.status !== "retired"))
    events.push({
      id: `flag-${a.id}`,
      kind: "policy",
      minutesAgo: 38,
      title: `${label(a)} flagged for review`,
      body: "No losing tick across the whole window. It keeps trading but cannot receive capital through reallocation until an operator reviews it or a later window shows a loss.",
      agentIds: [a.id],
      tags: ["downside deviation = 0"],
    });
  for (const a of agents.filter((x) => x.retirement))
    events.push({
      id: `ret-${a.id}`,
      kind: "retirement",
      minutesAgo: ago(a.retirement!.evaluation),
      title: `${label(a)} retired`,
      body:
        (a.retirement!.rule === "floor"
          ? `Its capital fell below the minimum viable floor of $${CAPITAL_FLOOR}.`
          : a.retirement!.rule === "starvation"
            ? `It sat in the bottom tenth of its niche for ${RETIREMENT_WINDOWS} evaluations in a row.`
            : "Its owner retired it.") + ` Its remaining ${usd(a.capital)} stayed in its own account, recoverable by its owner.`,
      agentIds: [a.id],
      tags: ["identity kept", "capital not moved"],
    });
  events.sort((a, b) => a.minutesAgo - b.minutesAgo);

  const lastTick = tickOf(LAST_EVALUATION);
  const trades = (a: Agent): Trade[] => {
    if (a.tradeCount === 0) return [];
    const r = rng(seedOf(a.id));
    return Array.from({ length: 9 }, (_, i) => {
      const rejected = i === 3 || i === 7;
      return {
        tick: lastTick - i * a.genome.executionFrequency,
        pair: a.genome.assetUniverse[Math.floor(r() * a.genome.assetUniverse.length)]!,
        side: r() > 0.5 ? "buy" : "sell",
        size: round2(a.capital * a.genome.riskTolerance * (0.4 + r() * 0.6)),
        slippagePct: rejected ? null : round2(r() * 0.3),
        pnl: rejected ? null : round2((r() - 0.42) * 0.6),
        decision: rejected ? { approved: false, reason: i === 3 ? "Exceeds the per-transaction cap" : "Contract not on the allowlist" } : { approved: true },
      };
    });
  };

  const purchases = (a: Agent): X402Purchase[] => {
    if (a.tradeCount === 0) return [];
    const r = rng(seedOf(a.id) * 7);
    return Array.from({ length: 7 }, (_, i) => {
      const provider = r() > 0.5 ? "nansen" : "defillama";
      const queries = provider === "nansen" ? ["Smart money flows", "Wallet labels", "Token netflow"] : ["Protocol TVL", "DEX volume", "Aggregated price"];
      return { tick: lastTick - i * a.genome.executionFrequency * 2, provider, query: queries[Math.floor(r() * 3)]!, cost: round2(0.01 + r() * 0.04), changedDecision: r() > 0.4 };
    });
  };

  return {
    listOwners: async () => owners,
    getOwner: async (id) => owners.find((o) => o.id === id) ?? null,
    listAgents: async () => agents,
    getAgent: async (id) => byId.get(id) ?? null,
    listReallocations: async (ownerId) => (ownerId ? moves.filter((m) => m.ownerId === ownerId) : moves),
    listEvaluations: async () => [...latest.values()],
    getEvaluation: async (id) => latest.get(id) ?? null,
    evaluationRange: async () => ({ first: FIRST_EVALUATION, last: LAST_EVALUATION }),
    listTrades: async (id) => { const a = byId.get(id); return a ? trades(a) : []; },
    listPurchases: async (id) => { const a = byId.get(id); return a ? purchases(a) : []; },
    getNep: async (id): Promise<NepBreakdown | null> => {
      const a = byId.get(id);
      if (!a || a.tradeCount === 0) return null;
      return { realizedPnl: round2(Math.max(0.4, a.capital - a.principal + 0.18)), x402: 0.09, gas: 0.03, fees: 0.04, slippage: 0.02 };
    },
    listEvents: async () => events,
    getLimits: async (): Promise<Limit[]> => [
      { label: "Per-transaction cap", used: 1.4, cap: 2.5, layer: "on-chain validation" },
      { label: "Rolling daily cap", used: 6.1, cap: 15, layer: "on-chain execution" },
      { label: "Session budget", used: 2.2, cap: 4, layer: "policy engine" },
      { label: "Daily x402", used: 0.61, cap: 1.5, layer: "policy engine" },
      { label: "Sponsored gas", used: 0.08, cap: 0.5, layer: "paymaster" },
    ],
    getBreaker: async (): Promise<BreakerState> => ({ capitalAtRiskFraction: 0.31, reallocationFraction: 0.12 }),
    getX402Spend: async (): Promise<X402Spend> => ({
      byProvider: [{ provider: "nansen", spent: 0.42 }, { provider: "defillama", spent: 0.19 }],
      purchases: 52,
      changedDecision: 37,
    }),
  };
}

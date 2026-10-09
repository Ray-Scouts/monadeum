import { allocateCapital } from "@monadeum/reproduction/allocate";
import { PROTOCOL } from "monadeum-simulation/protocol";
import type { PopulationSource } from "./source";
import type {
  Agent,
  BreakerState,
  EvolutionEvent,
  Genome,
  Limit,
  NepBreakdown,
  Reproduction,
  Trade,
  X402Purchase,
  X402Spend,
} from "./types";

/** Sample trading pairs for the prototype. The real allowlist is a platform decision not yet made. */
export const SAMPLE_PAIRS = ["MON/USDC", "WETH/USDC", "WBTC/USDC", "MON/WETH"] as const;

const NAMES = ["Kestrel", "Lumen", "Ferro", "Vela", "Orca", "Nimbus", "Quill", "Sable", "Tern", "Ion", "Rook", "Pike", "Wren", "Lynx", "Cobalt", "Moth", "Iris", "Juno", "Onyx", "Pax", "Rune", "Sol", "Talon", "Umber", "Vex", "Yarrow", "Zinc", "Arc"];
const FOUNDER_RISK = [0.03, 0.07, 0.12, 0.12, 0.17, 0.22];

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

export interface Population {
  agents: Agent[];
  reproductions: Reproduction[];
}

/** Deterministic sample population. Every reproduction goes through the real `allocateCapital`. */
export function generatePopulation(seed = 11): Population {
  const r = rng(seed);
  const hex = (n: number) => Array.from({ length: n }, () => "0123456789abcdef"[Math.floor(r() * 16)]).join("");
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!;
  const agents: Agent[] = [];
  const reproductions: Reproduction[] = [];

  const mutate = (parent: Genome): { genome: Genome; mutated: (keyof Genome)[] } => {
    const g: Genome = { ...parent, assetUniverse: [...parent.assetUniverse], hash: `0x${hex(8)}` };
    const mutated: (keyof Genome)[] = [];
    const nudge = (v: number) => v + v * (r() * 2 - 1) * PROTOCOL.mutBand;
    // ponytail: mutation probability is raised from PROTOCOL.pMut so the sample lineage visibly differs; numeric bounds are the protocol's
    const p = Math.max(PROTOCOL.pMut, 0.5);
    if (r() < p) { g.riskTolerance = round2(clip(nudge(g.riskTolerance), PROTOCOL.riskFloor, PROTOCOL.riskCeiling) * 10) / 10; mutated.push("riskTolerance"); }
    if (r() < p) { g.executionFrequency = Math.round(clip(nudge(g.executionFrequency), PROTOCOL.frequencyMin, PROTOCOL.frequencyMax)); mutated.push("executionFrequency"); }
    if (r() < p) { g.timeHorizon = Math.round(clip(nudge(g.timeHorizon), PROTOCOL.timeHorizonMin, PROTOCOL.timeHorizonMax)); mutated.push("timeHorizon"); }
    return { genome: g, mutated };
  };

  const make = (generation: number, parentId: string | null, principal: number, genome: Genome): Agent => {
    const agent: Agent = {
      id: hex(4),
      name: NAMES[agents.length % NAMES.length]!,
      generation,
      parentId,
      childIds: [],
      status: "active",
      principal,
      capital: principal,
      tradeCount: 0,
      fitnessPercentile: 0,
      ticksSinceReproduction: 0,
      address: `0x${hex(40)}`,
      genome,
      capitalHistory: [],
    };
    agents.push(agent);
    return agent;
  };

  const reproduce = (parent: Agent) => {
    if (agents.length >= PROTOCOL.testnetPopulationCap || parent.childIds.length >= PROTOCOL.maxDescendants) return;
    // the parent first earns past the profit threshold, then hands part of that profit on
    const before = round2(parent.capital + parent.principal * (PROTOCOL.profitThresholdFraction + r() * 0.6));
    const { childCapital, parentCapitalAfter } = allocateCapital({
      capital: before,
      principal: parent.principal,
      fraction: PROTOCOL.reproductionFraction,
      maxChildCapital: PROTOCOL.principal,
    });
    const { genome, mutated } = mutate(parent.genome);
    const child = make(parent.generation + 1, parent.id, childCapital, genome);
    parent.childIds.push(child.id);
    parent.capital = parentCapitalAfter;
    reproductions.push({
      parentId: parent.id,
      childId: child.id,
      parentPrincipal: parent.principal,
      parentCapitalBefore: before,
      parentCapitalAfter,
      childCapital,
      mutated,
    });
  };

  FOUNDER_RISK.forEach((risk) => {
    const universe = SAMPLE_PAIRS.filter(() => r() > 0.45).slice(0, 3);
    make(0, null, PROTOCOL.principal, {
      strategyType: "trading",
      assetUniverse: universe.length ? universe : ["MON/USDC"],
      riskTolerance: risk,
      executionFrequency: Math.round(4 + r() * 20),
      timeHorizon: Math.round(12 + r() * 48),
      informationBudget: round2(0.01 + r() * 0.06),
      modelConfiguration: pick(PROTOCOL.allowedModels),
      hash: `0x${hex(8)}`,
    });
  });

  // generations 1 to 3, from the fittest founders down
  for (const i of [0, 2, 3, 4]) {
    const parent = agents[i]!;
    const n = 1 + Math.floor(r() * 3);
    for (let j = 0; j < n; j++) reproduce(parent);
  }
  for (const parent of agents.filter((a) => a.generation === 1).slice(0, 5)) if (r() > 0.35) for (let j = 0; j < 1 + Math.floor(r() * 2); j++) reproduce(parent);
  for (const parent of agents.filter((a) => a.generation === 2).slice(0, 3)) reproduce(parent);

  // trading after the last reproduction: capital moves freely, fitness and counters settle
  for (const a of agents) {
    const parent = a.childIds.length > 0;
    a.capital = round2(a.capital * (parent ? 1.05 + r() * 0.5 : 0.6 + r() * 1.2));
    a.fitnessPercentile = parent ? 55 + Math.round(r() * 43) : Math.round(r() * 100);
    a.tradeCount = Math.round((4 - a.generation) * 18 * (0.5 + r()));
    a.ticksSinceReproduction = Math.round(10 + r() * 110);
  }
  const founders = agents.filter((a) => a.generation === 0);
  Object.assign(founders[1]!, { status: "retired", capital: 0.05, fitnessPercentile: 4 });
  Object.assign(founders[5]!, { status: "retired", capital: 3.1, fitnessPercentile: 7 });
  const review = agents.find((a) => a.generation === 1 && a.status === "active");
  if (review) review.status = "review";
  agents[agents.length - 1]!.status = "paused";

  for (const a of agents) {
    let v = a.principal;
    const walk = Array.from({ length: 30 }, () => (v += (r() - 0.47) * a.principal * 0.06));
    const shift = a.capital - walk[29]!;
    a.capitalHistory = walk.map((x, i) => round2(Math.max(0.01, x + (shift * i) / 29)));
    a.capitalHistory[29] = a.capital;
  }
  return { agents, reproductions };
}

const seedOf = (id: string) => parseInt(id, 16) || 1;

export function createMockSource(seed = 11): PopulationSource & { reproductions: Reproduction[] } {
  const { agents, reproductions } = generatePopulation(seed);
  const byId = new Map(agents.map((a) => [a.id, a]));
  const label = (a: Agent) => `${a.name}·${a.id}`;
  const live = agents.filter((a) => a.status !== "retired");

  const events: EvolutionEvent[] = [];
  reproductions.slice(0, 6).forEach((rep, i) => {
    const p = byId.get(rep.parentId)!;
    const c = byId.get(rep.childId)!;
    events.push({
      id: `rep-${c.id}`,
      kind: "reproduction",
      minutesAgo: 3 + i * 7,
      title: `${label(p)} had a child: ${label(c)}`,
      body: `Received $${rep.childCapital.toFixed(2)} from its parent's profit. Generation ${c.generation}.`,
      agentIds: [p.id, c.id],
      tags: [`genome ${c.genome.hash}`, `risk ${p.genome.riskTolerance.toFixed(3)} to ${c.genome.riskTolerance.toFixed(3)}`],
    });
  });
  const at = (i: number) => live[i % live.length]!;
  events.push(
    { id: "pol-1", kind: "policy", minutesAgo: 6, title: `Proposal rejected for ${label(at(2))}`, body: "Requested a $3.40 trade on MON/USDC. Exceeds the $2.50 per-transaction cap.", agentIds: [at(2).id], tags: ["per-transaction cap", "not executed"] },
    { id: "x-1", kind: "x402", minutesAgo: 9, title: `${label(at(3))} bought data from Nansen`, body: "Smart money flows for $0.03. The response changed its decision from buy to wait.", agentIds: [at(3).id], tags: ["x402", "changed the decision"] },
    { id: "pol-2", kind: "policy", minutesAgo: 14, title: `Proposal rejected for ${label(at(6))}`, body: "Tried to call a contract outside the allowlist. Only the Kuru router, the reproduction contract and the settlement asset are allowed.", agentIds: [at(6).id], tags: ["contract allowlist", "not executed"] },
    { id: "brk-1", kind: "breaker", minutesAgo: 22, title: "Population circuit breaker check", body: "Capital at risk at 31% of threshold. Reproduction rate normal. No action needed.", agentIds: [], tags: ["automatic"] },
    { id: "x-2", kind: "x402", minutesAgo: 60, title: `${label(at(1))} skipped a purchase`, body: "Estimated that the expected value of DeFiLlama data ($0.02) did not justify the cost.", agentIds: [at(1).id], tags: ["x402", "no spend"] },
    { id: "pol-3", kind: "policy", minutesAgo: 120, title: `Daily x402 budget exhausted for ${label(at(4))}`, body: "Further information purchases are blocked until the 24 h window rolls over.", agentIds: [at(4).id], tags: ["daily cap"] },
  );
  const review = agents.find((a) => a.status === "review");
  if (review) events.push({ id: "rev-1", kind: "policy", minutesAgo: 38, title: `${label(review)} flagged for review`, body: "Zero losses across the whole window. It keeps trading but cannot reproduce until an operator reviews it.", agentIds: [review.id], tags: ["downside deviation = 0"] });
  agents.filter((a) => a.status === "retired").forEach((a, i) =>
    events.push({
      id: `ret-${a.id}`,
      kind: "retirement",
      minutesAgo: 60 + i * 120,
      title: `${label(a)} retired`,
      body: a.capital < PROTOCOL.capitalFloor
        ? `Its capital fell below the minimum viable floor of $${PROTOCOL.capitalFloor}.`
        : `It sat in the bottom decile of its niche for ${PROTOCOL.retirementWindows} windows in a row. Its balance remains available to its owner.`,
      agentIds: [a.id],
      tags: ["identity kept"],
    }),
  );
  events.sort((a, b) => a.minutesAgo - b.minutesAgo);

  const trades = (a: Agent): Trade[] => {
    const r = rng(seedOf(a.id));
    return Array.from({ length: 9 }, (_, i) => {
      const rejected = i === 3 || i === 7;
      return {
        tick: 4120 - i * a.genome.executionFrequency,
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
    const r = rng(seedOf(a.id) * 7);
    return Array.from({ length: 7 }, (_, i) => {
      const provider = r() > 0.5 ? "nansen" : "defillama";
      const queries = provider === "nansen" ? ["Smart money flows", "Wallet labels", "Token netflow"] : ["Protocol TVL", "DEX volume", "Aggregated price"];
      return { tick: 4120 - i * a.genome.executionFrequency * 2, provider, query: queries[Math.floor(r() * 3)]!, cost: round2(0.01 + r() * 0.04), changedDecision: r() > 0.4 };
    });
  };

  return {
    reproductions,
    listAgents: async () => agents,
    getAgent: async (id) => byId.get(id) ?? null,
    listReproductions: async () => reproductions,
    listTrades: async (id) => { const a = byId.get(id); return a ? trades(a) : []; },
    listPurchases: async (id) => { const a = byId.get(id); return a ? purchases(a) : []; },
    getNep: async (id): Promise<NepBreakdown | null> => {
      const a = byId.get(id);
      if (!a) return null;
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
    getBreaker: async (): Promise<BreakerState> => ({ capitalAtRiskFraction: 0.31, reproductionsPerEvaluation: 0.4 }),
    getX402Spend: async (): Promise<X402Spend> => ({
      byProvider: [{ provider: "nansen", spent: 0.42 }, { provider: "defillama", spent: 0.19 }],
      purchases: 52,
      changedDecision: 37,
    }),
  };
}

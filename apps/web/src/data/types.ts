export type AgentStatus = "active" | "review" | "paused" | "retired";

export interface Genome {
  strategyType: "trading";
  assetUniverse: string[];
  riskTolerance: number;
  executionFrequency: number;
  timeHorizon: number;
  informationBudget: number;
  modelConfiguration: string;
  hash: string;
}

export interface Agent {
  id: string;
  name: string;
  generation: number;
  parentId: string | null;
  childIds: string[];
  status: AgentStatus;
  principal: number;
  capital: number;
  tradeCount: number;
  /** Adjusted fitness percentile within the agent's niche, 0 to 100. */
  fitnessPercentile: number;
  ticksSinceReproduction: number;
  address: string;
  genome: Genome;
  /** Capital over the last 30 ticks, oldest first; the last value equals `capital`. */
  capitalHistory: number[];
}

export interface Reproduction {
  parentId: string;
  childId: string;
  parentPrincipal: number;
  parentCapitalBefore: number;
  parentCapitalAfter: number;
  childCapital: number;
  /** Genome fields whose value changed in the child. */
  mutated: (keyof Genome)[];
}

export type PolicyDecision = { approved: true } | { approved: false; reason: string };

export interface Trade {
  tick: number;
  pair: string;
  side: "buy" | "sell";
  size: number;
  slippagePct: number | null;
  pnl: number | null;
  decision: PolicyDecision;
}

export type Provider = "nansen" | "defillama";

export interface X402Purchase {
  tick: number;
  provider: Provider;
  query: string;
  cost: number;
  changedDecision: boolean;
}

export interface NepBreakdown {
  realizedPnl: number;
  x402: number;
  gas: number;
  fees: number;
  slippage: number;
}

export type EventKind = "reproduction" | "policy" | "x402" | "retirement" | "breaker";

export interface EvolutionEvent {
  id: string;
  kind: EventKind;
  minutesAgo: number;
  title: string;
  body: string;
  /** Agents the event is about, in the order they appear in the title. */
  agentIds: string[];
  tags: string[];
}

export type LimitLayer = "on-chain validation" | "on-chain execution" | "policy engine" | "paymaster";

export interface Limit {
  label: string;
  used: number;
  cap: number;
  layer: LimitLayer;
}

export interface BreakerState {
  /** Capital at risk as a fraction of the configured threshold. */
  capitalAtRiskFraction: number;
  reproductionsPerEvaluation: number;
}

export interface X402Spend {
  byProvider: { provider: Provider; spent: number }[];
  purchases: number;
  changedDecision: number;
}

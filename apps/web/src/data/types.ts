/** `active` agents are ranked at each evaluation; `paused` agents keep their capital but are not ranked; `retired` is final. */
export type AgentStatus = "active" | "paused" | "retired";

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

/** Which EVOLUTION.md section 6 rule retired an agent. */
export type RetirementRule = "floor" | "starvation" | "owner";

export interface Agent {
  id: string;
  name: string;
  ownerId: string;
  status: AgentStatus;
  /** The owner's deposits to this agent minus the owner's withdrawals. Reallocation never changes it. */
  principal: number;
  capital: number;
  tradeCount: number;
  /** Adjusted fitness percentile within the agent's niche, 0 to 100, or null while it has no adjusted fitness. */
  fitnessPercentile: number | null;
  /** Consecutive evaluation windows in the bottom decile of its niche: the section 6 starvation count. */
  lowWindows: number;
  /** Section 2.3 zero-downside flag: the agent keeps trading but cannot receive capital through reallocation. */
  zeroDownsideFlag: boolean;
  retirement: { rule: RetirementRule; evaluation: number } | null;
  address: string;
  genome: Genome;
  /** Capital after each evaluation, oldest first; the last value equals `capital`. */
  capitalHistory: number[];
}

/** An owner-signed reallocation policy (EVOLUTION.md section 3.1 item 8). It may tighten the protocol bounds, never loosen them. */
export interface ReallocationPolicy {
  /** The owner's agents that take part. Fewer than two means nothing moves. */
  agentIds: string[];
  reallocationCap: number;
  slotCeiling: number;
  /** Evaluation sequence number at which the owner's root wallet signed it. */
  signedAtEvaluation: number;
}

export interface Owner {
  id: string;
  name: string;
  /** Root wallet address that signs the policy. */
  rootWallet: string;
  policy: ReallocationPolicy | null;
}

/** One atomic transfer between two agents of the same owner at one evaluation. */
export interface Reallocation {
  evaluation: number;
  ownerId: string;
  sourceId: string;
  sinkId: string;
  amount: number;
}

/** Why a ranked agent moved nothing. `counterpart` means the agents on the other side could not give or take anything. */
export type HeldReason = "floor" | "ceiling" | "zero-downside" | "middle" | "counterpart" | "alone";

/** What the mechanism did to one agent at one evaluation. */
export type Outcome =
  | { kind: "off"; reason: "no-policy" | "one-agent" | "not-covered" | "too-few-covered" | "policy-invalid" }
  | { kind: "unranked"; reason: "no-fitness" | "paused" }
  | { kind: "sent"; amount: number }
  | { kind: "received"; amount: number }
  | { kind: "held"; reason: HeldReason }
  | { kind: "retired"; rule: RetirementRule };

export interface AgentEvaluation {
  agentId: string;
  evaluation: number;
  outcome: Outcome;
  /** Position in the owner's ranking pool (1 is the lowest), the pool size, and how many sources and sinks it has. Null when not ranked. */
  rank: { position: number; of: number; quota: number } | null;
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

export type EventKind = "reallocation" | "policy" | "x402" | "retirement" | "breaker";

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
  /** Capital moved by reallocation at the last evaluation, as a fraction of the configured threshold. */
  reallocationFraction: number;
}

export interface X402Spend {
  byProvider: { provider: Provider; spent: number }[];
  purchases: number;
  changedDecision: number;
}

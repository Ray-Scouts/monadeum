export type Regime = "trending" | "mean_reverting" | "choppy" | "stress_flash_crash";

export type RunMode = "evolving" | "static";

export interface Genome {
  strategyType: "trading";
  assetUniverse: string[];
  riskTolerance: number;
  executionFrequency: number;
  timeHorizon: number;
  entryThreshold: number;
  exitThreshold: number;
  informationSources: string[];
  informationBudget: number;
  modelConfiguration: string;
}

export interface CostModel {
  gasUsd: number;
  x402Usd: number;
  feeBps: number;
  slippageBps: number;
  infoPurchaseProbability: number;
  infoEdge: number;
}

export interface Bar {
  tick: number;
  price: number;
  ret: number;
}

export interface Order {
  notional: number;
  edge: number;
  pair: string;
}

export interface Fill {
  pnl: number;
  fee: number;
  slippage: number;
  gas: number;
}

export interface ExecutionBackend {
  execute(order: Order, bar: Bar, costs: CostModel): Fill;
}

export interface Proposal {
  kind: "trade";
  pair: string;
}

export interface FitnessInput {
  returns: readonly number[];
  tradeCounts: readonly number[];
  populationMedianSortino: number;
  k: number;
}

export interface FitnessResult {
  adjustedFitness: number | null;
  rawSortino: number | null;
  downsideDeviation: number;
  flaggedZeroDownside: boolean;
  tradeCount: number;
}

export interface FitnessModule {
  evaluate(input: FitnessInput): FitnessResult;
}

export interface AgentSnapshot {
  id: string;
  capital: number;
  principal: number;
  adjustedFitness: number | null;
  rawSortino: number | null;
  flaggedZeroDownside: boolean;
  tradeCount: number;
  status: "active" | "retired";
  descendants: number;
  ticksSinceReproduction: number;
  genome: Genome;
}

export interface ReproductionInput {
  agent: AgentSnapshot;
  reference: readonly AgentSnapshot[];
  populationSize: number;
  populationCap: number;
  nowTick: number;
  /** Niche percentile the agent must reach. 0.5 normally, 0.75 when the niche is over-represented. */
  requiredPercentile: number;
}

export interface ReproductionDecision {
  eligible: boolean;
  failed: string[];
}

export interface AllocationInput {
  capital: number;
  principal: number;
  fraction: number;
  maxChildCapital: number;
}

export interface Allocation {
  childCapital: number;
  parentCapitalAfter: number;
}

export interface MutationInput {
  genome: Genome;
  rng: () => number;
  pMut: number;
}

export interface ReproductionModule {
  evaluate(input: ReproductionInput): ReproductionDecision;
  allocate(input: AllocationInput): Allocation;
  mutate(input: MutationInput): Genome;
}

export interface RiskModule {
  clipGenome(genome: Genome): Genome;
  positionNotional(capital: number, genome: Genome): number;
  allowsTrade(tick: number, lastTradeTick: number, genome: Genome): boolean;
}

export interface CostLedger {
  gas: number;
  x402: number;
  fees: number;
  slippage: number;
  grossPnl: number;
}

export interface AgentSummary {
  id: string;
  capital: number;
  principal: number;
  trades: number;
  flaggedZeroDownside: boolean;
  status: "active" | "retired";
  descendants: number;
  niche: string;
}

/** Reproduction gate outcomes over every evaluation of an active parent in evolving mode. */
export interface GateCounts {
  evaluations: number;
  /** How many evaluations failed each gate. One evaluation can fail several. */
  failed: Record<string, number>;
  /** How many evaluations failed only that gate, so removing it alone would have opened eligibility. */
  sole: Record<string, number>;
}

export interface RunResult {
  seed: number;
  regime: Regime;
  mode: RunMode;
  population: number;
  ticks: number;
  endPopulation: number;
  totalCapital: number;
  startingCapital: number;
  roiPct: number;
  sortino: number | null;
  gini: number;
  reproductions: number;
  gates: GateCounts;
  ledger: CostLedger;
  prices: number[];
  agents: AgentSummary[];
}

export interface RunConfig {
  seed: number;
  population: number;
  ticks: number;
  regime: Regime;
  mode: RunMode;
  costs?: Partial<CostModel>;
  genome?: Partial<Genome>;
  fitness?: FitnessModule;
  reproduction?: ReproductionModule;
  risk?: RiskModule;
  execution?: ExecutionBackend;
  principal?: number;
  /** Niche ranking and the over-represented penalty. Defaults to on. */
  diversity?: boolean;
  /** Spread starting genomes across pairs and risk bands. */
  spreadNiches?: boolean;
  /** Whether agents may buy information at all. Defaults to on. Off means no x402 spend and no information edge. */
  informationPurchases?: boolean;
}

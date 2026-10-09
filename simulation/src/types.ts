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
  /** Hidden per-agent skill, a harness device with no production counterpart. */
  skill: number;
  /** Id of the parent for a child, null for a founder. */
  parent: string | null;
  /** Genome distance from the regime optimum (issue #84). Present only when `RunConfig.genomeModel` is set. */
  genomeDistance?: number;
}

/** Capital-weighted genome distance from the regime optimum over the active agents at one tick (issue #84). */
export interface GenomeTracePoint {
  tick: number;
  /** Capital-weighted mean distance over active agents. */
  weighted: number;
  /** Unweighted mean distance over active agents. */
  mean: number;
}

/** Reproduction gate outcomes over every evaluation of an active parent in evolving mode. */
export interface GateCounts {
  evaluations: number;
  /** How many evaluations failed each gate. One evaluation can fail several. */
  failed: Record<string, number>;
  /** How many evaluations failed only that gate, so removing it alone would have opened eligibility. */
  sole: Record<string, number>;
}

export interface TreasuryLedger {
  initial: number;
  /** Unspent balance at the end. Counted in `totalCapital`. */
  remaining: number;
  spent: number;
  /** Number of children that received a top-up. */
  topUps: number;
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
  /** Experiment-only treasury (issue #82). All zero when `RunConfig.treasury` is unset. */
  treasury: TreasuryLedger;
  ledger: CostLedger;
  prices: number[];
  agents: AgentSummary[];
  /** Present only when `RunConfig.genomeModel` is set: tick 0, then every `GENOME_TRACE_EVERY` ticks. */
  genomeTrace?: GenomeTracePoint[];
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
  /**
   * Heritability `h` of the hidden skill, in [0, 1]. A child's skill is `h * parent.skill + (1 - h) * fresh draw`,
   * where the fresh draw uses the founder distribution. Defaults to 0, a fresh draw, which is the original behavior.
   */
  skillHeritability?: number;
  /**
   * Experiment-only override of `PROTOCOL.reproductionFraction` (issue #82), in (0, 1]. The invariant
   * `parent.capital >= parent.principal` still holds at 1. Defaults to the protocol value.
   */
  reproductionFraction?: number;
  /**
   * Experiment-only minimum child capital `m` (issue #82). A parent reproduces only once its child would start with at
   * least `m`, counting any treasury top-up; until then profit keeps accumulating. Counted as the `min_child_capital`
   * gate. Defaults to 0, which never binds.
   */
  minChildCapital?: number;
  /**
   * Experiment-only treasury balance (issue #82). In evolving mode a child below `minChildCapital` is topped up to it
   * from this balance, all or nothing. In static mode the balance is idle cash. In both modes it is part of the starting
   * and ending capital. Defaults to 0.
   */
  treasury?: number;
  /**
   * Experiment-only genome performance model (issue #84, `src/genome-model.ts`). When set, an agent's per-tick edge
   * comes from its genome and the hidden skill is 0 for every agent (its draw is still made, so the agent RNG stream is
   * unchanged). Unset by default, which keeps the hidden skill model.
   */
  genomeModel?: { magnitude: number };
  /**
   * Experiment-only random founders (issue #84). Each founder's `timeHorizon`, `entryThreshold`, and pair set are drawn
   * by `randomGenome` from a separate RNG stream, every other field from `genome`. Defaults to off.
   */
  randomGenomes?: boolean;
}

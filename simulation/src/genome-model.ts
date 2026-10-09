import { PROTOCOL } from "./protocol.js";
import type { Genome, Regime, RiskModule } from "./types.js";

/**
 * Experiment-only genome performance model (issue #84). Every number in this file is an assumption chosen so that
 * selection has something to act on, not a measured property of any real strategy. See `results/genome-model.md`.
 *
 * Per regime there is one optimum genome. A genome's score in [0, 1] is a weighted closeness to that optimum over the
 * three fields the harness strategy reads: `timeHorizon`, `entryThreshold`, and the traded pair (`assetUniverse[0]`).
 * While the agent is in the market, its per-tick edge is `magnitude * (score - OFFSET)`, added to the bar return the
 * same way the hidden skill is. `exitThreshold` is not used: the long-or-flat harness strategy never reads it.
 */

export interface GenomeModel {
  /** Edge spread per tick between a score of 1 and a score of 0. 0.006 matches the hidden skill range. */
  magnitude: number;
}

export interface RegimeOptimum {
  timeHorizon: number;
  entryThreshold: number;
  pair: string;
}

/**
 * Assumed optima. Trending rewards a long lookback, mean-reverting a short one, choppy a middle one. Each optimum
 * threshold is negative enough that the optimum genome is in the market on most ticks, so it can collect its edge. The
 * stress regime is choppy with one shock, so it shares the choppy optimum: a genome fit before the shock is not
 * told about it.
 */
export const OPTIMA: Record<Regime, RegimeOptimum> = {
  trending: { timeHorizon: 100, entryThreshold: -0.002, pair: "PAIR_A" },
  mean_reverting: { timeHorizon: 3, entryThreshold: -0.006, pair: "PAIR_B" },
  choppy: { timeHorizon: 12, entryThreshold: -0.004, pair: "PAIR_C" },
  stress_flash_crash: { timeHorizon: 12, entryThreshold: -0.004, pair: "PAIR_C" },
};

/** Weights of the three components of the score. They sum to 1. */
export const WEIGHTS = { horizon: 0.4, entry: 0.3, pair: 0.3 } as const;

/** Threshold distance at which the entry component reaches 0. Twice the half-width of the random draw. */
export const ENTRY_SCALE = 0.02;

/** Half-width of the random `entryThreshold` draw, of the order of one tick of market noise (0.01). */
export const ENTRY_DRAW = 0.01;

/** Score with zero edge. 1/3 maps a score in [0, 1] to an edge in [-magnitude/3, 2 magnitude/3]. */
export const OFFSET = 1 / 3;

/**
 * Magnitudes that passed the static validation in `results/genome-model.md`: 0.006, whose edge range equals the hidden
 * skill range, and 0.009. 0.003 failed it in the stress regime, because at that size the cost of being in the market
 * more often outweighs the edge.
 */
export const MAGNITUDES = [0.006, 0.009] as const;

const LOG_HORIZON_SPAN = Math.log(PROTOCOL.timeHorizonMax / PROTOCOL.timeHorizonMin);

/** Weighted closeness to the regime optimum, in [0, 1]. 1 is the optimum. */
export function genomeScore(genome: Genome, regime: Regime): number {
  const optimum = OPTIMA[regime];
  const horizon = Math.max(PROTOCOL.timeHorizonMin, genome.timeHorizon);
  const horizonDistance = Math.min(1, Math.abs(Math.log(horizon / optimum.timeHorizon)) / LOG_HORIZON_SPAN);
  const entryDistance = Math.min(1, Math.abs(genome.entryThreshold - optimum.entryThreshold) / ENTRY_SCALE);
  const pairMatch = genome.assetUniverse[0] === optimum.pair ? 1 : 0;
  return WEIGHTS.horizon * (1 - horizonDistance) + WEIGHTS.entry * (1 - entryDistance) + WEIGHTS.pair * pairMatch;
}

/** Distance from the regime optimum, `1 - score`, in [0, 1]. */
export function genomeDistance(genome: Genome, regime: Regime): number {
  return 1 - genomeScore(genome, regime);
}

/** Per-tick edge while in the market. */
export function genomeEdge(genome: Genome, regime: Regime, model: GenomeModel): number {
  return model.magnitude * (genomeScore(genome, regime) - OFFSET);
}

export function assertGenomeModel(model: GenomeModel): void {
  if (!(Number.isFinite(model.magnitude) && model.magnitude >= 0)) {
    throw new RangeError(`genomeModel.magnitude must be a finite number >= 0, got ${model.magnitude}`);
  }
}

/**
 * A random genome over the fields the score reads, with every other field taken from `base` (so the policy's risk
 * tolerance and execution frequency stay pinned). `timeHorizon` is log-uniform on [1, 200], `entryThreshold` is
 * uniform on [-ENTRY_DRAW, ENTRY_DRAW], and the pair set is a uniformly shuffled allowlist cut to 1, 2, or 3 pairs, so
 * the traded pair is uniform over the three. Uses exactly five draws.
 */
export function randomGenome(rng: () => number, base: Genome, risk: RiskModule): Genome {
  const timeHorizon = Math.exp(rng() * LOG_HORIZON_SPAN) * PROTOCOL.timeHorizonMin;
  const entryThreshold = (rng() * 2 - 1) * ENTRY_DRAW;
  const pairs: string[] = [...PROTOCOL.allowedPairs];
  for (let i = pairs.length - 1; i > 0; i--) {
    const j = Math.min(i, Math.floor(rng() * (i + 1)));
    const swap = pairs[i] as string;
    pairs[i] = pairs[j] as string;
    pairs[j] = swap;
  }
  const count = 1 + Math.min(pairs.length - 1, Math.floor(rng() * pairs.length));
  return risk.clipGenome({
    ...base,
    timeHorizon,
    entryThreshold,
    assetUniverse: pairs.slice(0, count),
    informationSources: [...base.informationSources],
  });
}

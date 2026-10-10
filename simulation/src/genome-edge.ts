import { createFitnessEngine, median } from "@monadeum/fitness/math";
import { generateMarket } from "./market.js";
import { mulberry32, saltedRng } from "./rng.js";
import { OFFSET, OPTIMA, WEIGHTS, genomeScore } from "./genome-model.js";
import { PROTOCOL } from "./protocol.js";
import type { Genome, Regime } from "./types.js";

/**
 * Genome-edge study (issue #102). Everything here follows `results/genome-edge-preregistration.md`; section numbers in
 * comments refer to that document. The same backtest engine, genome sample, and statistics run on real hourly prices
 * and on synthetic harness markets, so the synthetic reference is in the same units as the measurement.
 */

export const GENOME_SEED = 20261010;
export const GENOME_COUNT = 1000;
export const EVAL_EVERY = 20;
export const FITNESS_WINDOW = 100;
export const BLOCK_HOURS = 336;
export const MAGNITUDE_GRID = [0, 0.0015, 0.003, 0.0045, 0.006, 0.009, 0.012] as const;
export const REFERENCE_MAGNITUDE = 0.006;
export const SYNTHETIC_SEEDS = 20;
export const SYNTHETIC_IN = 2000;
export const SYNTHETIC_OUT = 1000;
export const REGIMES: readonly Regime[] = ["trending", "mean_reverting", "choppy", "stress_flash_crash"];

/** Cost per swap, as a fraction of notional (section 3). Gas is $0.00104 on a $2.50 notional. */
export const GAS_FRACTION = 0.00104 / 2.5;
export const COSTS = {
  base: 0 + 0.00074 + GAS_FRACTION,
  high: 0.001 + 0.0005 + GAS_FRACTION,
  zero: 0,
} as const;
export type CostCase = keyof typeof COSTS;

export interface StudyGenome {
  timeHorizon: number;
  entryThreshold: number;
  executionFrequency: number;
  pair: string;
}

/** Section 3: horizon, threshold, frequency, pair, in that order, from one mulberry32 stream. */
export function sampleGenomes(count = GENOME_COUNT, seed = GENOME_SEED): StudyGenome[] {
  const rng = mulberry32(seed);
  const span = Math.log(PROTOCOL.timeHorizonMax / PROTOCOL.timeHorizonMin);
  const pairs = PROTOCOL.allowedPairs;
  const genomes: StudyGenome[] = [];
  for (let i = 0; i < count; i++) {
    const timeHorizon = Math.exp(rng() * span) * PROTOCOL.timeHorizonMin;
    const entryThreshold = (rng() * 2 - 1) * 0.01;
    const executionFrequency = Math.min(PROTOCOL.frequencyMax, Math.floor(Math.exp(rng() * Math.log(PROTOCOL.frequencyMax + 1))));
    const pair = pairs[Math.min(pairs.length - 1, Math.floor(rng() * pairs.length))] as string;
    genomes.push({ timeHorizon, entryThreshold, executionFrequency: Math.max(1, executionFrequency), pair });
  }
  return genomes;
}

function asHarnessGenome(genome: StudyGenome): Genome {
  return {
    strategyType: "trading",
    assetUniverse: [genome.pair],
    riskTolerance: 0.25,
    executionFrequency: genome.executionFrequency,
    timeHorizon: genome.timeHorizon,
    entryThreshold: genome.entryThreshold,
    exitThreshold: 0,
    informationSources: [],
    informationBudget: 0,
    modelConfiguration: "low",
  };
}

/** The issue #84 edge, with or without the pair component (the secondary reference rescales the other two weights). */
export function syntheticEdge(genome: StudyGenome, regime: Regime, magnitude: number, withPair = true): number {
  const harness = asHarnessGenome(genome);
  let score = genomeScore(harness, regime);
  if (!withPair) {
    const pairPart = harness.assetUniverse[0] === OPTIMA[regime].pair ? WEIGHTS.pair : 0;
    score = (score - pairPart) / (WEIGHTS.horizon + WEIGHTS.entry);
  }
  return magnitude * (score - OFFSET);
}

export interface Backtest {
  /** net[g][t]: net return on notional of genome g over bar t (0 for t = 0). */
  net: Float64Array[];
  /** swaps[g][t]: 1 if genome g changed position at the start of bar t. */
  swaps: Uint8Array[];
  /** inMarket[g]: share of bars the genome held a long position. */
  inMarket: number[];
}

/**
 * Long or flat (section 3). At the close of bar t, a genome whose frequency divides t sets its position for bar t + 1
 * to long when the trailing mean of its last `timeHorizon` returns (up to and including bar t), plus `edges[g]`, exceeds
 * its threshold. While long it earns the bar return plus `edges[g]`; each position change costs `cost`.
 */
export function backtest(returns: Float64Array, genomes: readonly StudyGenome[], cost: number, edges?: readonly number[]): Backtest {
  const n = returns.length;
  const prefix = new Float64Array(n + 1);
  for (let t = 0; t < n; t++) prefix[t + 1] = (prefix[t] as number) + (returns[t] as number);
  const net: Float64Array[] = [];
  const swaps: Uint8Array[] = [];
  const inMarket: number[] = [];
  genomes.forEach((genome, g) => {
    const edge = edges?.[g] ?? 0;
    const horizon = Math.max(1, Math.floor(genome.timeHorizon));
    const row = new Float64Array(n);
    const swapRow = new Uint8Array(n);
    let position = 0;
    let held = 0;
    for (let t = 0; t < n - 1; t++) {
      let next = position;
      if (t % genome.executionFrequency === 0) {
        const from = Math.max(0, t - horizon + 1);
        const mean = ((prefix[t + 1] as number) - (prefix[from] as number)) / (t + 1 - from);
        next = mean + edge > genome.entryThreshold ? 1 : 0;
      }
      const swapped = next !== position ? 1 : 0;
      row[t + 1] = next * ((returns[t + 1] as number) + edge) - swapped * cost;
      swapRow[t + 1] = swapped;
      held += next;
      position = next;
    }
    net.push(row);
    swaps.push(swapRow);
    inMarket.push(held / Math.max(1, n - 1));
  });
  return { net, swaps, inMarket };
}

function sampleSd(values: ArrayLike<number>): number {
  const n = values.length;
  if (n < 2) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += values[i] as number;
  const mean = sum / n;
  let sq = 0;
  for (let i = 0; i < n; i++) sq += ((values[i] as number) - mean) ** 2;
  return Math.sqrt(sq / (n - 1));
}

function meanOf(values: ArrayLike<number>): number {
  let sum = 0;
  for (let i = 0; i < values.length; i++) sum += values[i] as number;
  return values.length === 0 ? 0 : sum / values.length;
}

/** Moving-block bootstrap of the mean of a series. Returns the resampled means. */
export function blockBootstrapMeans(series: readonly number[], block: number, resamples: number, seed: number): number[] {
  const n = series.length;
  const rng = mulberry32(seed);
  const out: number[] = [];
  if (n === 0) return out;
  const b = Math.min(block, n);
  for (let r = 0; r < resamples; r++) {
    let sum = 0;
    let count = 0;
    while (count < n) {
      const start = Math.floor(rng() * (n - b + 1));
      for (let i = 0; i < b && count < n; i++, count++) sum += series[start + i] as number;
    }
    out.push(sum / n);
  }
  return out;
}

function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return Number.NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return (sorted[lo] as number) + ((sorted[hi] as number) - (sorted[lo] as number)) * (pos - lo);
}

export interface SpreadResult {
  ticksIn: number;
  ticksOut: number;
  /** Mean net per-tick return, top fifth minus bottom fifth, on the held-out ticks. */
  spread: number;
  marketSd: number;
  /** spread / marketSd. */
  normalized: number;
  /** One-sided bootstrap p for normalized spread > 0, and one-sided 95 percent bounds. */
  p: number;
  lower95: number;
  upper95: number;
  /** Spearman correlation of per-genome mean net return, in-sample against held-out. */
  rankCarry: number;
}

/** H1 statistic (section 6): rank on `inTicks`, measure on `outTicks`. */
export function quintileSpread(
  bt: Backtest,
  returns: Float64Array,
  inTicks: readonly number[],
  outTicks: readonly number[],
  bootstrapSeed = 1,
  resamples = 2000,
): SpreadResult {
  const g = bt.net.length;
  const inMean = bt.net.map((row) => meanOf(inTicks.map((t) => row[t] as number)));
  const outMean = bt.net.map((row) => meanOf(outTicks.map((t) => row[t] as number)));
  const order = inMean.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value || a.index - b.index);
  const fifth = Math.floor(g / 5);
  const bottom = order.slice(0, fifth).map((item) => item.index);
  const top = order.slice(g - fifth).map((item) => item.index);
  const perTick = outTicks.map((t) => {
    let up = 0;
    let down = 0;
    for (const i of top) up += bt.net[i]?.[t] as number;
    for (const i of bottom) down += bt.net[i]?.[t] as number;
    return up / top.length - down / bottom.length;
  });
  const marketSd = sampleSd(outTicks.map((t) => returns[t] as number));
  const spread = meanOf(perTick);
  const normalized = marketSd > 0 ? spread / marketSd : 0;
  const boots = blockBootstrapMeans(perTick, 24, resamples, bootstrapSeed)
    .map((value) => (marketSd > 0 ? value / marketSd : 0))
    .sort((a, b) => a - b);
  const p = boots.length === 0 ? 1 : boots.filter((value) => value <= 0).length / boots.length;
  return {
    ticksIn: inTicks.length,
    ticksOut: outTicks.length,
    spread,
    marketSd,
    normalized,
    p,
    lower95: quantile(boots, 0.05),
    upper95: quantile(boots, 0.95),
    rankCarry: spearman(inMean, outMean),
  };
}

function ranks(values: readonly number[]): number[] {
  const order = values.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value);
  const out = new Array<number>(values.length).fill(0);
  let i = 0;
  while (i < order.length) {
    let j = i;
    while (j + 1 < order.length && (order[j + 1] as { value: number }).value === (order[i] as { value: number }).value) j++;
    const rank = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) out[(order[k] as { index: number }).index] = rank;
    i = j + 1;
  }
  return out;
}

export function spearman(a: readonly number[], b: readonly number[]): number {
  if (a.length < 3) return Number.NaN;
  const ra = ranks(a);
  const rb = ranks(b);
  const ma = meanOf(ra);
  const mb = meanOf(rb);
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < ra.length; i++) {
    const x = (ra[i] as number) - ma;
    const y = (rb[i] as number) - mb;
    num += x * y;
    da += x * x;
    db += y * y;
  }
  return da > 0 && db > 0 ? num / Math.sqrt(da * db) : Number.NaN;
}

export interface PersistenceResult {
  evaluations: number;
  rho: number;
  lower95: number;
  upper95: number;
  meanRanked: number;
  perEvaluation: { tick: number; rho: number; ranked: number }[];
}

/**
 * H2 statistic (section 6). `ticks` is the contiguous held-out tick range. Every EVAL_EVERY ticks, once a full
 * FITNESS_WINDOW lies inside it, adjusted fitness from `libs/fitness` is ranked against the next EVAL_EVERY ticks' net
 * return, over the genomes that have an adjusted fitness.
 */
export function rankPersistence(bt: Backtest, ticks: readonly number[], bootstrapSeed = 2, resamples = 2000): PersistenceResult {
  const engine = createFitnessEngine();
  const per: { tick: number; rho: number; ranked: number }[] = [];
  for (let e = FITNESS_WINDOW; e + EVAL_EVERY <= ticks.length; e += EVAL_EVERY) {
    const window = ticks.slice(e - FITNESS_WINDOW, e);
    const forward = ticks.slice(e, e + EVAL_EVERY);
    const parts = bt.net.map((row, g) => {
      const returns = window.map((t) => row[t] as number);
      const tradeCounts = window.map((t) => bt.swaps[g]?.[t] as number);
      return { returns, tradeCounts };
    });
    const raws: number[] = [];
    const firstPass = parts.map((part) => engine.evaluate({ ...part, populationMedianSortino: 0, k: PROTOCOL.k }));
    for (const result of firstPass) if (result.rawSortino !== null && !result.flaggedZeroDownside) raws.push(result.rawSortino);
    const populationMedian = median(raws);
    const fit: number[] = [];
    const fwd: number[] = [];
    parts.forEach((part, g) => {
      const result = engine.evaluate({ ...part, populationMedianSortino: populationMedian, k: PROTOCOL.k });
      if (result.adjustedFitness === null) return;
      fit.push(result.adjustedFitness);
      let sum = 0;
      for (const t of forward) sum += bt.net[g]?.[t] as number;
      fwd.push(sum);
    });
    const rho = spearman(fit, fwd);
    if (Number.isFinite(rho)) per.push({ tick: ticks[e] as number, rho, ranked: fit.length });
  }
  const series = per.map((item) => item.rho);
  const boots = blockBootstrapMeans(series, 5, resamples, bootstrapSeed).sort((a, b) => a - b);
  return {
    evaluations: per.length,
    rho: meanOf(series),
    lower95: quantile(boots, 0.05),
    upper95: quantile(boots, 0.95),
    meanRanked: meanOf(per.map((item) => item.ranked)),
    perEvaluation: per,
  };
}

export type RealRegime = "trending" | "mean_reverting" | "choppy" | "stress";
export const TO_SYNTHETIC: Record<RealRegime, Regime> = {
  trending: "trending",
  mean_reverting: "mean_reverting",
  choppy: "choppy",
  stress: "stress_flash_crash",
};

export interface Block {
  start: number;
  end: number;
  sd: number;
  efficiency: number;
  autocorrelation: number;
  label: RealRegime;
}

/** Section 4. `starts` are the first tick of each period; returns are hourly. */
export function cutBlocks(returns: Float64Array, from: number, to: number): Omit<Block, "label">[] {
  const blocks: Omit<Block, "label">[] = [];
  for (let start = from; start < to; start += BLOCK_HOURS) {
    const end = Math.min(to, start + BLOCK_HOURS);
    if (end - start < BLOCK_HOURS / 2) break;
    const r = Array.from(returns.slice(start, end));
    const sum = r.reduce((a, b) => a + b, 0);
    const abs = r.reduce((a, b) => a + Math.abs(b), 0);
    const m = sum / r.length;
    let num = 0;
    let den = 0;
    for (let i = 0; i < r.length; i++) {
      const x = (r[i] as number) - m;
      den += x * x;
      if (i > 0) num += x * ((r[i - 1] as number) - m);
    }
    blocks.push({ start, end, sd: sampleSd(r), efficiency: abs > 0 ? Math.abs(sum) / abs : 0, autocorrelation: den > 0 ? num / den : 0 });
  }
  return blocks;
}

export function labelBlocks(blocks: readonly Omit<Block, "label">[], stressSd: number): Block[] {
  return blocks.map((block) => {
    const n = block.end - block.start;
    const bound = 2 / Math.sqrt(n);
    let label: RealRegime = "choppy";
    if (block.sd > stressSd) label = "stress";
    else if (block.efficiency >= bound) label = "trending";
    else if (block.autocorrelation <= -bound) label = "mean_reverting";
    return { ...block, label };
  });
}

export function ticksOf(blocks: readonly Block[], label: RealRegime): number[] {
  const out: number[] = [];
  for (const block of blocks) if (block.label === label) for (let t = block.start; t < block.end; t++) out.push(t);
  return out;
}

export function range(from: number, to: number): number[] {
  return Array.from({ length: Math.max(0, to - from) }, (_, i) => from + i);
}

export interface SyntheticCell {
  regime: Regime;
  magnitude: number;
  withPair: boolean;
  cost: CostCase;
  spread: number[];
  rho: number[];
  medianSpread: number;
  medianRho: number;
}

/** Section 5. One regime, one magnitude: 20 seeds of a 2,000-tick in-sample and an independent 1,000-tick held-out path. */
export function syntheticCell(
  genomes: readonly StudyGenome[],
  regime: Regime,
  magnitude: number,
  cost: CostCase,
  withPair = true,
  seeds = SYNTHETIC_SEEDS,
): SyntheticCell {
  const edges = genomes.map((genome) => syntheticEdge(genome, regime, magnitude, withPair));
  const spread: number[] = [];
  const rho: number[] = [];
  for (let seed = 1; seed <= seeds; seed++) {
    const inPath = generateMarket(regime, SYNTHETIC_IN, saltedRng(seed, 101)).map((bar) => bar.ret);
    const outPath = generateMarket(regime, SYNTHETIC_OUT, saltedRng(seed, 102)).map((bar) => bar.ret);
    const returns = Float64Array.from([...inPath, ...outPath]);
    // The held-out path is independent: the backtest runs on each path separately so no position carries across.
    const btIn = backtest(Float64Array.from(inPath), genomes, COSTS[cost], edges);
    const btOut = backtest(Float64Array.from(outPath), genomes, COSTS[cost], edges);
    const joined: Backtest = {
      net: btIn.net.map((row, g) => Float64Array.from([...row, ...(btOut.net[g] as Float64Array)])),
      swaps: btIn.swaps.map((row, g) => Uint8Array.from([...row, ...(btOut.swaps[g] as Uint8Array)])),
      inMarket: btIn.inMarket,
    };
    const inTicks = range(1, SYNTHETIC_IN);
    const outTicks = range(SYNTHETIC_IN + 1, SYNTHETIC_IN + SYNTHETIC_OUT);
    spread.push(quintileSpread(joined, returns, inTicks, outTicks, seed, 0).normalized);
    rho.push(rankPersistence(joined, outTicks, seed, 0).rho);
  }
  return { regime, magnitude, withPair, cost, spread, rho, medianSpread: median(spread), medianRho: median(rho) };
}

/** Linear interpolation of `value` on a curve over MAGNITUDE_GRID, floored at 0 and capped at the grid's end. */
export function calibrate(value: number, curve: readonly number[], grid: readonly number[] = MAGNITUDE_GRID): number {
  if (!(value > (curve[0] as number))) return 0;
  for (let i = 1; i < grid.length; i++) {
    const lo = curve[i - 1] as number;
    const hi = curve[i] as number;
    if (value <= hi && hi > lo) return (grid[i - 1] as number) + (((grid[i] as number) - (grid[i - 1] as number)) * (value - lo)) / (hi - lo);
  }
  return grid[grid.length - 1] as number;
}

/** OLS R-squared of y on the given regressors plus an intercept (normal equations, small k). */
export function rSquared(y: readonly number[], xs: readonly (readonly number[])[]): number {
  const n = y.length;
  const k = xs.length + 1;
  const row = (i: number): number[] => [1, ...xs.map((x) => x[i] as number)];
  const a: number[][] = Array.from({ length: k }, () => new Array<number>(k + 1).fill(0));
  for (let i = 0; i < n; i++) {
    const r = row(i);
    for (let p = 0; p < k; p++) {
      for (let q = 0; q < k; q++) (a[p] as number[])[q] = ((a[p] as number[])[q] as number) + (r[p] as number) * (r[q] as number);
      (a[p] as number[])[k] = ((a[p] as number[])[k] as number) + (r[p] as number) * (y[i] as number);
    }
  }
  for (let c = 0; c < k; c++) {
    let pivot = c;
    for (let r = c + 1; r < k; r++) if (Math.abs((a[r] as number[])[c] as number) > Math.abs((a[pivot] as number[])[c] as number)) pivot = r;
    [a[c], a[pivot]] = [a[pivot] as number[], a[c] as number[]];
    const div = (a[c] as number[])[c] as number;
    if (Math.abs(div) < 1e-300) return Number.NaN;
    for (let q = c; q <= k; q++) (a[c] as number[])[q] = ((a[c] as number[])[q] as number) / div;
    for (let r = 0; r < k; r++) {
      if (r === c) continue;
      const f = (a[r] as number[])[c] as number;
      for (let q = c; q <= k; q++) (a[r] as number[])[q] = ((a[r] as number[])[q] as number) - f * ((a[c] as number[])[q] as number);
    }
  }
  const beta = a.map((r) => r[k] as number);
  const my = meanOf(y);
  let ssr = 0;
  let sst = 0;
  for (let i = 0; i < n; i++) {
    const r = row(i);
    const fit = r.reduce((s, v, p) => s + v * (beta[p] as number), 0);
    ssr += ((y[i] as number) - fit) ** 2;
    sst += ((y[i] as number) - my) ** 2;
  }
  return sst > 0 ? 1 - ssr / sst : Number.NaN;
}

export { meanOf as mean, sampleSd };

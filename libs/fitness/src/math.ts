export const SHRINKAGE_K = 20;
export const TRAILING_WINDOW = 100;
export const RISK_CUTS = [0.05, 0.1, 0.15, 0.2] as const;

export interface SortinoParts {
  raw: number | null;
  downside: number;
  flagged: boolean;
  tradeCount: number;
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
  tradingContinues: boolean;
  reproductionPaused: boolean;
}

export interface CostedFill {
  realizedPnl: number;
  x402: number;
  gas: number;
  fees: number;
  slippage: number;
}

const COST_FIELDS = ["realizedPnl", "x402", "gas", "fees", "slippage"] as const;

export function assertCostedFill(entry: Partial<CostedFill>): CostedFill {
  for (const field of COST_FIELDS) {
    if (typeof entry[field] !== "number" || !Number.isFinite(entry[field])) {
      throw new Error(`missing cost field ${field}`);
    }
  }
  return entry as CostedFill;
}

export function netEconomicPerformance(entries: readonly Partial<CostedFill>[]): number {
  return entries.reduce((sum, entry) => {
    const full = assertCostedFill(entry);
    return sum + full.realizedPnl - full.x402 - full.gas - full.fees - full.slippage;
  }, 0);
}

export function sortinoParts(returns: readonly number[], tradeCounts: readonly number[]): SortinoParts {
  const n = returns.length;
  let tradeCount = 0;
  let sum = 0;
  let negSq = 0;
  let negatives = 0;
  for (let i = 0; i < n; i++) {
    const value = returns[i] ?? 0;
    tradeCount += tradeCounts[i] ?? 0;
    sum += value;
    const downsideTick = Math.min(0, value);
    if (downsideTick < 0) negatives += 1;
    negSq += downsideTick * downsideTick;
  }
  if (n === 0) return { raw: null, downside: 0, flagged: false, tradeCount };
  const downside = Math.sqrt(negSq / n);
  const flagged = tradeCount > 0 && negatives === 0;
  if (flagged || downside === 0) return { raw: null, downside, flagged, tradeCount };
  return { raw: sum / n / downside, downside, flagged: false, tradeCount };
}

export function shrinkageWeight(tradeCount: number, k = SHRINKAGE_K): number {
  return tradeCount / (tradeCount + k);
}

export function createFitnessEngine() {
  return {
    evaluate(input: FitnessInput): FitnessResult {
      const parts = sortinoParts(input.returns, input.tradeCounts);
      const base = {
        downsideDeviation: parts.downside,
        flaggedZeroDownside: parts.flagged,
        tradeCount: parts.tradeCount,
        tradingContinues: true,
        reproductionPaused: parts.flagged,
      };
      if (parts.flagged || parts.raw === null) {
        return { ...base, adjustedFitness: null, rawSortino: parts.raw };
      }
      const weight = shrinkageWeight(parts.tradeCount, input.k);
      return {
        ...base,
        adjustedFitness: weight * parts.raw + (1 - weight) * input.populationMedianSortino,
        rawSortino: parts.raw,
        reproductionPaused: false,
      };
    },
  };
}

export function riskBand(riskTolerance: number, cuts: readonly number[] = RISK_CUTS): number {
  let band = 0;
  for (const cut of cuts) {
    if (riskTolerance >= cut) band += 1;
  }
  return band;
}

export function nicheKey(assetUniverse: readonly string[], riskTolerance: number, cuts: readonly number[] = RISK_CUTS): string {
  const assets = [...assetUniverse].sort().join("+");
  return `${assets}|b${riskBand(riskTolerance, cuts)}`;
}

export function percentile(value: number, sample: readonly number[]): number {
  if (sample.length === 0) return 0;
  let below = 0;
  let equal = 0;
  for (const item of sample) {
    if (item < value) below += 1;
    else if (item === value) equal += 1;
  }
  return (below + 0.5 * equal) / sample.length;
}

export function median(sample: readonly number[]): number {
  if (sample.length === 0) return 0;
  const sorted = [...sample].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid] ?? 0;
  return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

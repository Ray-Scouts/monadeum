import type { FitnessInput, FitnessModule, FitnessResult } from "./types.js";

export function sortinoParts(returns: readonly number[], tradeCounts: readonly number[]): {
  raw: number | null;
  downside: number;
  flagged: boolean;
  tradeCount: number;
} {
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

export function createFitnessModule(): FitnessModule {
  return {
    evaluate(input: FitnessInput): FitnessResult {
      const parts = sortinoParts(input.returns, input.tradeCounts);
      if (parts.flagged || parts.raw === null) {
        return {
          adjustedFitness: null,
          rawSortino: parts.raw,
          downsideDeviation: parts.downside,
          flaggedZeroDownside: parts.flagged,
          tradeCount: parts.tradeCount,
        };
      }
      const weight = parts.tradeCount / (parts.tradeCount + input.k);
      return {
        adjustedFitness: weight * parts.raw + (1 - weight) * input.populationMedianSortino,
        rawSortino: parts.raw,
        downsideDeviation: parts.downside,
        flaggedZeroDownside: false,
        tradeCount: parts.tradeCount,
      };
    },
  };
}

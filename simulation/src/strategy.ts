import type { Genome, Proposal } from "./types.js";

export interface SignalInput {
  marketReturns: readonly number[];
  genome: Genome;
  edge: number;
}

/** Long or flat. The signal is the trailing market mean plus the agent's edge. */
export function propose(input: SignalInput): Proposal | null {
  const horizon = Math.max(1, Math.floor(input.genome.timeHorizon));
  const sample = input.marketReturns.slice(-horizon);
  if (sample.length === 0) return null;
  const mean = sample.reduce((sum, value) => sum + value, 0) / sample.length;
  if (mean + input.edge <= input.genome.entryThreshold) return null;
  const pair = input.genome.assetUniverse[0];
  if (!pair) return null;
  return { kind: "trade", pair };
}

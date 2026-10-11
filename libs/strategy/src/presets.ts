// Genome presets for new agents (EVOLUTION.md section 1.1). An owner picks a preset by name; the server builds the
// genome from it. This file is the one source for the values: changing one is a documented decision in EVOLUTION.md
// section 1.1 first, and an existing agent keeps the genome it was created with.
//
// No import beyond this file, so the web can read the presets without the Nest module (`@monadeum/strategy/presets`).

/** The strategy-level part of a genome. The pair comes from the deployment, not from the preset. */
export interface GenomePreset {
  name: string;
  /** Max position size as a fraction of capital, within RISK_FLOOR and RISK_CEILING. */
  riskTolerance: number;
  /** Ticks between decisions, an integer within FREQUENCY_MIN and FREQUENCY_MAX. */
  executionFrequency: number;
  /** Signal lookback in ticks, an integer within TIME_HORIZON_MIN and TIME_HORIZON_MAX. */
  timeHorizon: number;
  entryThreshold: number;
  exitThreshold: number;
  /** x402 providers the agent may query. */
  informationSources: readonly string[];
  /** Per-tick information budget, settlement-asset base units. */
  informationBudget: bigint;
  /** One of ALLOWED_MODEL_CONFIGURATIONS. */
  modelConfiguration: string;
}

/** The section 1 ranges a preset must sit inside (EVOLUTION.md section 1; proposed defaults, provisional). */
export const FREQUENCY_MIN = 1;
export const FREQUENCY_MAX = 50;
export const TIME_HORIZON_MIN = 1;
export const TIME_HORIZON_MAX = 200;
export const ALLOWED_MODEL_CONFIGURATIONS = ["low", "mid"] as const;
export const ALLOWED_INFORMATION_SOURCES = ["nansen", "defillama"] as const;

/**
 * The one MVP preset. Not a calibrated edge: the issue #102 study found none. Every value is an assumption grounded
 * where possible in the measured costs; the reasoning for each is the table in EVOLUTION.md section 1.1.
 */
const conservative: GenomePreset = Object.freeze({
  name: "conservative",
  riskTolerance: 0.1,
  executionFrequency: 24,
  timeHorizon: 24,
  entryThreshold: 0.0002,
  exitThreshold: 0,
  informationSources: Object.freeze([]) as readonly string[],
  informationBudget: 0n,
  modelConfiguration: "low",
});

export const GENOME_PRESETS: Readonly<Record<string, GenomePreset>> = Object.freeze({ conservative });

export const DEFAULT_GENOME_PRESET = "conservative";

/** The preset with this name, or undefined. Only own keys count, so `toString` or `__proto__` is never a preset. */
export function genomePreset(name: unknown): GenomePreset | undefined {
  return typeof name === "string" && Object.prototype.hasOwnProperty.call(GENOME_PRESETS, name) ? GENOME_PRESETS[name] : undefined;
}

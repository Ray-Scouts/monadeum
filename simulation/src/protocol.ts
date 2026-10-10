import { RISK_CUTS, SHRINKAGE_K, TRAILING_WINDOW } from "@monadeum/fitness/math";
import {
  CAPITAL_FLOOR,
  EVALUATION_CADENCE,
  REALLOCATION_CAP,
  RETIREMENT_WINDOWS,
  SLOT_CEILING,
  STARVATION_PERCENTILE,
} from "@monadeum/reallocation/constants";

/** Proposed defaults from EVOLUTION.md. The simulation tunes these. It does not treat them as final. */
export const PROTOCOL = {
  k: SHRINKAGE_K,
  nMin: 20,
  trailingWindow: TRAILING_WINDOW,
  evalEvery: EVALUATION_CADENCE,
  cooldown: 40,
  riskFloor: 0.01,
  riskCeiling: 0.25,
  riskCuts: RISK_CUTS,
  frequencyMin: 1,
  frequencyMax: 50,
  timeHorizonMin: 1,
  timeHorizonMax: 200,
  thresholdMin: -1,
  thresholdMax: 1,
  informationBudgetCeiling: 1,
  pMut: 0.15,
  mutBand: 0.2,
  reproductionFraction: 0.5,
  profitThresholdFraction: 0.5,
  pThreshold: 0.5,
  nicheShareThreshold: 0.4,
  penalizedPercentile: 0.75,
  maxDescendants: 5,
  testnetPopulationCap: 50,
  experimentCapMultiple: 2,
  capitalFloor: CAPITAL_FLOOR,
  retirementWindows: RETIREMENT_WINDOWS,
  starvationPercentile: STARVATION_PERCENTILE,
  reallocationCap: REALLOCATION_CAP,
  slotCeiling: SLOT_CEILING,
  principal: 10,
  allowedPairs: ["PAIR_A", "PAIR_B", "PAIR_C"] as const,
  allowedModels: ["low", "mid"] as const,
  allowedSources: ["nansen", "defillama"] as const,
} as const;

export function experimentPopulationCap(startingPopulation: number): number {
  return Math.max(
    PROTOCOL.testnetPopulationCap,
    PROTOCOL.experimentCapMultiple * startingPopulation,
  );
}

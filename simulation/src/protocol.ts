/** Proposed defaults from EVOLUTION.md. The simulation tunes these. It does not treat them as final. */
export const PROTOCOL = {
  k: 20,
  nMin: 20,
  trailingWindow: 100,
  evalEvery: 20,
  cooldown: 40,
  riskFloor: 0.01,
  riskCeiling: 0.25,
  riskCuts: [0.05, 0.1, 0.15, 0.2] as const,
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
  capitalFloor: 0.06,
  retirementWindows: 3,
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

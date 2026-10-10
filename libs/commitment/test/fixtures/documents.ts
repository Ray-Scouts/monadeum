import type { GenomeV1, ReallocationPolicyV1, StrategyVersionV1 } from "../../src/index.js";

/** The ARCHITECTURE.md section 16.4 example genome, before normalization. */
export const SPEC_GENOME_INPUT =
  '{"strategyType":"trading","schemaVersion":1,"riskTolerance":0.1,"executionFrequency":5,"assetUniverse":["PAIR_B","PAIR_A","PAIR_A"],"informationSources":["nansen","defillama"],"timeHorizon":20,"entryThreshold":0.002,"exitThreshold":-0,"informationBudget":"500000","modelConfiguration":"low"}';

/** The exact canonical bytes section 16.4 states for that genome. */
export const SPEC_GENOME_CANONICAL =
  '{"assetUniverse":["PAIR_A","PAIR_B"],"entryThreshold":0.002,"executionFrequency":5,"exitThreshold":0,"informationBudget":"500000","informationSources":["defillama","nansen"],"modelConfiguration":"low","riskTolerance":0.1,"schemaVersion":1,"strategyType":"trading","timeHorizon":20}';

export const GENOME: GenomeV1 = JSON.parse(SPEC_GENOME_INPUT);

export const STRATEGY: StrategyVersionV1 = {
  schemaVersion: 1,
  strategyType: "trading",
  version: "1.0.0",
  codeDigest: `0x${"ab".repeat(32)}`,
};

export const POLICY: ReallocationPolicyV1 = {
  schemaVersion: 1,
  owner: "0x00000000000000000000000000000000000000aA",
  sequence: 1,
  agents: [12n, "7", 7n],
  reallocationCap: 0.1,
};

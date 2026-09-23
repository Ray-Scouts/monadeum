import { PROTOCOL } from "./protocol.js";
import type { Genome, RiskModule } from "./types.js";

function clip(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}

export function createRiskModule(): RiskModule {
  return {
    clipGenome(genome: Genome): Genome {
      const pairs = genome.assetUniverse.filter((pair) =>
        (PROTOCOL.allowedPairs as readonly string[]).includes(pair),
      );
      const uniquePairs = [...new Set(pairs)];
      return {
        ...genome,
        strategyType: "trading",
        assetUniverse: uniquePairs.length > 0 ? uniquePairs : ["PAIR_A"],
        riskTolerance: clip(genome.riskTolerance, PROTOCOL.riskFloor, PROTOCOL.riskCeiling),
        executionFrequency: clip(
          Math.round(genome.executionFrequency),
          PROTOCOL.frequencyMin,
          PROTOCOL.frequencyMax,
        ),
        timeHorizon: clip(Math.round(genome.timeHorizon), PROTOCOL.timeHorizonMin, PROTOCOL.timeHorizonMax),
        entryThreshold: clip(genome.entryThreshold, PROTOCOL.thresholdMin, PROTOCOL.thresholdMax),
        exitThreshold: clip(genome.exitThreshold, PROTOCOL.thresholdMin, PROTOCOL.thresholdMax),
        informationBudget: clip(genome.informationBudget, 0, PROTOCOL.informationBudgetCeiling),
        informationSources: genome.informationSources.filter((source) =>
          (PROTOCOL.allowedSources as readonly string[]).includes(source),
        ),
        modelConfiguration: (PROTOCOL.allowedModels as readonly string[]).includes(genome.modelConfiguration)
          ? genome.modelConfiguration
          : "low",
      };
    },
    positionNotional(capital: number, genome: Genome): number {
      if (capital <= 0) return 0;
      return capital * clip(genome.riskTolerance, PROTOCOL.riskFloor, PROTOCOL.riskCeiling);
    },
    allowsTrade(tick: number, lastTradeTick: number, genome: Genome): boolean {
      if (lastTradeTick < 0) return true;
      return tick - lastTradeTick >= genome.executionFrequency;
    },
  };
}

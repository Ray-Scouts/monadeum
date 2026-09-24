import { Injectable } from "@nestjs/common";
import {
  SHRINKAGE_K,
  TRAILING_WINDOW,
  createFitnessEngine,
  netEconomicPerformance,
  nicheKey,
  type CostedFill,
  type FitnessInput,
} from "./math.js";

@Injectable()
export class FitnessService {
  readonly k = SHRINKAGE_K;
  readonly trailingWindow = TRAILING_WINDOW;
  private readonly engine = createFitnessEngine();

  net(entries: readonly Partial<CostedFill>[]): number {
    return netEconomicPerformance(entries);
  }

  evaluate(input: FitnessInput) {
    return this.engine.evaluate(input);
  }

  niche(assetUniverse: readonly string[], riskTolerance: number): string {
    return nicheKey(assetUniverse, riskTolerance);
  }
}

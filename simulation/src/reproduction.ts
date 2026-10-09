import { median as medianOf, nicheKey as nicheKeyOf, percentile as percentileOf, riskBand as riskBandOf } from "@monadeum/fitness";
import { allocateCapital, assertGenomeHasNoProtocolFields } from "@monadeum/reproduction";
import { PROTOCOL } from "./protocol.js";
import { createRiskModule } from "./risk.js";
import type {
  Allocation,
  AllocationInput,
  Genome,
  MutationInput,
  ReproductionDecision,
  ReproductionInput,
  ReproductionModule,
} from "./types.js";

const risk = createRiskModule();

export function riskBand(riskTolerance: number): number {
  return riskBandOf(riskTolerance, PROTOCOL.riskCuts);
}

export function nicheKey(genome: Genome): string {
  return nicheKeyOf(genome.assetUniverse, genome.riskTolerance, PROTOCOL.riskCuts);
}

export function percentile(value: number, sample: readonly number[]): number {
  return percentileOf(value, sample);
}

export function median(sample: readonly number[]): number {
  return medianOf(sample);
}

function choose<T>(rng: () => number, items: readonly T[]): T {
  const index = Math.min(items.length - 1, Math.floor(rng() * items.length));
  return items[index] as T;
}

export function nichePressure(share: number, diversity: boolean): { requiredPercentile: number; pMut: number } {
  const crowded = diversity && share > PROTOCOL.nicheShareThreshold;
  return {
    requiredPercentile: crowded ? PROTOCOL.penalizedPercentile : PROTOCOL.pThreshold,
    pMut: crowded ? PROTOCOL.pMut * 2 : PROTOCOL.pMut,
  };
}

export interface ReproductionOptions {
  /** Overrides `PROTOCOL.profitThresholdFraction` for an experiment. The protocol default is unchanged. */
  profitThresholdFraction?: number;
}

export function createReproductionModule(options: ReproductionOptions = {}): ReproductionModule {
  const profitThresholdFraction = options.profitThresholdFraction ?? PROTOCOL.profitThresholdFraction;
  return {
    evaluate(input: ReproductionInput): ReproductionDecision {
      const failed: string[] = [];
      const agent = input.agent;
      if (agent.status !== "active") failed.push("inactive");
      if (agent.flaggedZeroDownside) failed.push("zero_downside_flag");
      if (agent.tradeCount < PROTOCOL.nMin) failed.push("n_min");
      if (agent.ticksSinceReproduction < PROTOCOL.cooldown) failed.push("cooldown");
      if (agent.adjustedFitness === null) failed.push("no_fitness");
      const scores = input.reference
        .map((item) => item.adjustedFitness)
        .filter((item): item is number => item !== null);
      const rank = agent.adjustedFitness === null ? 0 : percentile(agent.adjustedFitness, scores);
      if (agent.adjustedFitness === null || rank < input.requiredPercentile) failed.push("percentile");
      const profit = agent.capital - agent.principal;
      if (profit < profitThresholdFraction * agent.principal) failed.push("profit");
      if (agent.descendants >= PROTOCOL.maxDescendants) failed.push("descendants");
      if (input.populationSize >= input.populationCap) failed.push("population_cap");
      return { eligible: failed.length === 0, failed };
    },
    allocate(input: AllocationInput): Allocation {
      return allocateCapital(input);
    },
    mutate(input: MutationInput): Genome {
      const next: Genome = {
        ...input.genome,
        assetUniverse: [...input.genome.assetUniverse],
        informationSources: [...input.genome.informationSources],
      };
      const perturb = (value: number): number => {
        if (input.rng() >= input.pMut) return value;
        const draw = (input.rng() * 2 - 1) * PROTOCOL.mutBand;
        return value * (1 + draw);
      };
      next.riskTolerance = perturb(next.riskTolerance);
      next.executionFrequency = perturb(next.executionFrequency);
      next.timeHorizon = perturb(next.timeHorizon);
      next.entryThreshold = perturb(next.entryThreshold);
      next.exitThreshold = perturb(next.exitThreshold);
      next.informationBudget = perturb(next.informationBudget);
      if (input.rng() < input.pMut) {
        const present = new Set(next.assetUniverse);
        const missing = PROTOCOL.allowedPairs.filter((pair) => !present.has(pair));
        if (input.rng() < 0.5 && missing.length > 0) {
          next.assetUniverse = [...next.assetUniverse, choose(input.rng, missing)];
        } else if (next.assetUniverse.length > 1) {
          const drop = choose(input.rng, next.assetUniverse);
          next.assetUniverse = next.assetUniverse.filter((pair) => pair !== drop);
        }
      }
      if (input.rng() < input.pMut) {
        const others = PROTOCOL.allowedModels.filter((model) => model !== next.modelConfiguration);
        if (others.length > 0) next.modelConfiguration = choose(input.rng, others);
      }
      if (input.rng() < input.pMut && PROTOCOL.allowedSources.length > 0) {
        const source = choose(input.rng, PROTOCOL.allowedSources);
        if (next.informationSources.includes(source) && next.informationSources.length > 1) {
          next.informationSources = next.informationSources.filter((item) => item !== source);
        } else if (!next.informationSources.includes(source)) {
          next.informationSources = [...next.informationSources, source];
        }
      }
      const child = risk.clipGenome(next);
      assertGenomeHasNoProtocolFields(child);
      return child;
    },
  };
}

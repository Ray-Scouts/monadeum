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
  let band = 0;
  for (const cut of PROTOCOL.riskCuts) {
    if (riskTolerance >= cut) band += 1;
  }
  return band;
}

export function nicheKey(genome: Genome): string {
  const assets = [...genome.assetUniverse].sort().join("+");
  return `${assets}|b${riskBand(genome.riskTolerance)}`;
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

export function createReproductionModule(): ReproductionModule {
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
      if (profit < PROTOCOL.profitThresholdFraction * agent.principal) failed.push("profit");
      if (agent.descendants >= PROTOCOL.maxDescendants) failed.push("descendants");
      if (input.populationSize >= input.populationCap) failed.push("population_cap");
      return { eligible: failed.length === 0, failed };
    },
    allocate(input: AllocationInput): Allocation {
      const profit = Math.max(0, input.capital - input.principal);
      let childCapital = Math.min(input.fraction * profit, input.maxChildCapital);
      if (input.capital - childCapital < input.principal) {
        childCapital = Math.max(0, input.capital - input.principal);
      }
      return {
        childCapital,
        parentCapitalAfter: input.capital - childCapital,
      };
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
      return risk.clipGenome(next);
    },
  };
}

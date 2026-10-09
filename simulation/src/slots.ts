import { mean, welch } from "./aggregate.js";
import { createReproductionModule } from "./reproduction.js";
import { pairedP } from "./rerun.js";
import { GENOME_TRACE_EVERY, run } from "./runner.js";
import type { Regime, RunConfig, RunResult } from "./types.js";

/**
 * Issue #85 harness. Every arm runs on the issue #84 genome model with random founders, the section 8 baseline policy
 * (risk 0.25, trade every tick, diversity on, 300 ticks), and the re-run arm A costs (x402 $0.01, purchases on), on
 * seeds 1 to 50. The profit threshold 0.1 matters only to the section 3 reference arm.
 */

/** `fixed` (issue #89) is fixed slots with no replacement: a triggered slot keeps its genome. */
export type SlotArmKind = "static" | "random" | "mutant" | "fixed" | "evolving";

/** Owner size for issue #89: every owner holds `k` slots, or the `mixed` distribution of `MIXED_OWNER_CYCLE`. */
export type OwnerSpec = number | "mixed";

export interface SlotArm {
  name: string;
  kind: SlotArmKind;
  /** Arm B and the reallocation diagnostic only. */
  reallocationCap?: number;
  /** Arm B and the reallocation diagnostic only, a multiple of the slot principal. */
  slotCeiling?: number;
  /** Issue #89 owner-scoped arms only. */
  owners?: OwnerSpec;
  /** Issue #89 owner-scoped arms with mutant refill only. */
  donorScope?: "population" | "owner";
}

/**
 * Assumed mixed owner-size distribution for issue #89, not a measured one: owners are laid out over the slots in this
 * repeating cycle of sizes (9 owners, 50 slots per cycle). Two thirds of owners hold 3 or fewer agents, and half of
 * the slots belong to owners of 25. The last owner is cut short when the population runs out.
 */
export const MIXED_OWNER_CYCLE = [1, 1, 1, 2, 2, 3, 5, 10, 25] as const;

/**
 * Owner sizes in slot order. With `k`, owners of `k` slots and, when `k` does not divide the population, one last
 * smaller owner with the remainder. With `mixed`, `MIXED_OWNER_CYCLE` repeated and cut at the population.
 */
export function ownerSizes(population: number, spec: OwnerSpec): number[] {
  const sizes: number[] = [];
  let left = population;
  let index = 0;
  while (left > 0) {
    const want = spec === "mixed" ? (MIXED_OWNER_CYCLE[index % MIXED_OWNER_CYCLE.length] as number) : spec;
    if (!(Number.isInteger(want) && want >= 1)) throw new RangeError(`owner size must be an integer >= 1, got ${want}`);
    const size = Math.min(want, left);
    sizes.push(size);
    left -= size;
    index += 1;
  }
  return sizes;
}

/** Issue #89 arms. Reallocation is always at the issue #85 cap 0.2, at ceilings 2 and 4. */
function scopeArms(): Record<string, SlotArm> {
  const arms: Record<string, SlotArm> = {
    /** Diagnostic: fixed slots, no replacement, no reallocation. Separates "no retirement" from reallocation. */
    N: { name: "N", kind: "fixed" },
  };
  for (const ceiling of [2, 4]) {
    const tail = `c0.2-x${ceiling}`;
    arms[`RO-${tail}`] = { name: `RO-${tail}`, kind: "fixed", reallocationCap: 0.2, slotCeiling: ceiling };
    for (const owners of [3, 5, 10, "mixed"] as const) {
      const prefix = `O${owners === "mixed" ? "mix" : owners}`;
      const base = { reallocationCap: 0.2, slotCeiling: ceiling, owners };
      arms[`${prefix}-N-${tail}`] = { name: `${prefix}-N-${tail}`, kind: "fixed", ...base };
      arms[`${prefix}-Mo-${tail}`] = { name: `${prefix}-Mo-${tail}`, kind: "mutant", donorScope: "owner", ...base };
      arms[`${prefix}-Mp-${tail}`] = { name: `${prefix}-Mp-${tail}`, kind: "mutant", donorScope: "population", ...base };
    }
  }
  return arms;
}

export const SLOT_ARMS: Record<string, SlotArm> = {
  C1: { name: "C1", kind: "static" },
  C2: { name: "C2", kind: "random" },
  A: { name: "A", kind: "mutant" },
  "B-c0.05-x2": { name: "B-c0.05-x2", kind: "mutant", reallocationCap: 0.05, slotCeiling: 2 },
  "B-c0.05-x4": { name: "B-c0.05-x4", kind: "mutant", reallocationCap: 0.05, slotCeiling: 4 },
  "B-c0.2-x2": { name: "B-c0.2-x2", kind: "mutant", reallocationCap: 0.2, slotCeiling: 2 },
  "B-c0.2-x4": { name: "B-c0.2-x4", kind: "mutant", reallocationCap: 0.2, slotCeiling: 4 },
  /** Diagnostic, not one of the four pre-registered arms: Control 2 plus arm B's reallocation at cap 0.2, ceiling 4. */
  "R-c0.2-x4": { name: "R-c0.2-x4", kind: "random", reallocationCap: 0.2, slotCeiling: 4 },
  S3: { name: "S3", kind: "evolving" },
  ...scopeArms(),
};

export const SLOT_TICKS = 300;
const POLICY = { riskTolerance: 0.25, executionFrequency: 1 };

export function slotRunConfig(arm: SlotArm, magnitude: number, population: number, regime: Regime, seed: number): RunConfig {
  const common: RunConfig = {
    seed,
    population,
    ticks: SLOT_TICKS,
    regime,
    mode: "static",
    genome: POLICY,
    diversity: true,
    costs: { x402Usd: 0.01 },
    informationPurchases: true,
    genomeModel: { magnitude },
    randomGenomes: true,
  };
  switch (arm.kind) {
    case "static":
      return common;
    case "evolving":
      return { ...common, mode: "evolving", reproduction: createReproductionModule({ profitThresholdFraction: 0.1 }) };
    case "random":
    case "mutant":
    case "fixed":
      return {
        ...common,
        mode: "slots",
        slots: {
          refill: arm.kind === "fixed" ? "none" : arm.kind,
          ...(arm.reallocationCap === undefined ? {} : { reallocationCap: arm.reallocationCap }),
          ...(arm.slotCeiling === undefined ? {} : { slotCeiling: arm.slotCeiling }),
          ...(arm.owners === undefined ? {} : { owners: ownerSizes(population, arm.owners) }),
          ...(arm.donorScope === undefined ? {} : { donorScope: arm.donorScope }),
        },
      };
    default: {
      const unknown: never = arm.kind;
      throw new Error(`unknown arm kind ${String(unknown)}`);
    }
  }
}

export interface SlotOutcome {
  seed: number;
  roiPct: number;
  replacements: number;
  noDonor: number;
  capitalMoved: number;
  reproductions: number;
  endPopulation: number;
  /** Capital-weighted genome distance from the regime optimum over active agents, at ticks 0, 60, ..., 300. */
  trace: number[];
  /** Niches (section 5) with at least one active agent at the end. */
  activeNiches: number;
  /** Exponential of the Shannon entropy of active capital across niches at the end: the effective number of niches. */
  effectiveNiches: number;
  /** Largest single niche's share of active capital at the end. */
  topNicheShare: number;
}

export function slotOutcome(result: RunResult): SlotOutcome {
  const byNiche = new Map<string, number>();
  for (const agent of result.agents) {
    if (agent.status !== "active") continue;
    byNiche.set(agent.niche, (byNiche.get(agent.niche) ?? 0) + agent.capital);
  }
  const total = [...byNiche.values()].reduce((sum, value) => sum + value, 0);
  let entropy = 0;
  let top = 0;
  for (const value of byNiche.values()) {
    const share = total > 0 ? value / total : 0;
    if (share > 0) entropy -= share * Math.log(share);
    top = Math.max(top, share);
  }
  return {
    seed: result.seed,
    roiPct: result.roiPct,
    replacements: result.slots?.replacements ?? 0,
    noDonor: result.slots?.noDonor ?? 0,
    capitalMoved: result.slots?.capitalMoved ?? 0,
    reproductions: result.reproductions,
    endPopulation: result.endPopulation,
    trace: (result.genomeTrace ?? []).map((point) => point.weighted),
    activeNiches: byNiche.size,
    effectiveNiches: Math.exp(entropy),
    topNicheShare: top,
  };
}

export interface SlotCell {
  arm: string;
  magnitude: number;
  population: number;
  regime: Regime;
  seeds: SlotOutcome[];
}

export function runSlotCell(arm: SlotArm, magnitude: number, population: number, regime: Regime, seeds: number): SlotCell {
  const out: SlotOutcome[] = [];
  for (let seed = 1; seed <= seeds; seed++) out.push(slotOutcome(run(slotRunConfig(arm, magnitude, population, regime, seed))));
  return { arm: arm.name, magnitude, population, regime, seeds: out };
}

/** Comparison of one arm with one control in one cell. Welch is the pre-registered statistic; paired p is secondary. */
export interface SlotComparison {
  arm: string;
  control: string;
  magnitude: number;
  population: number;
  regime: Regime;
  seeds: number;
  armMean: number;
  controlMean: number;
  gap: number;
  p: number;
  pairedP: number;
}

export function compareSlotCells(arm: SlotCell, control: SlotCell): SlotComparison {
  const a = arm.seeds.map((item) => item.roiPct);
  const b = control.seeds.map((item) => item.roiPct);
  const test = welch(a, b);
  return {
    arm: arm.arm,
    control: control.arm,
    magnitude: arm.magnitude,
    population: arm.population,
    regime: arm.regime,
    seeds: a.length,
    armMean: test.meanA,
    controlMean: test.meanB,
    gap: test.meanA - test.meanB,
    p: test.p,
    pairedP: pairedP(a, b),
  };
}

export interface SlotCellSummary {
  arm: string;
  magnitude: number;
  population: number;
  regime: Regime;
  roiMean: number;
  replacementsMean: number;
  noDonorMean: number;
  /** Mean over seeds of total capital moved, and the same as a percent of starting capital. */
  capitalMovedMean: number;
  capitalMovedPct: number;
  reproductionsMean: number;
  /** Mean over seeds of the capital-weighted distance at each trace tick. */
  distance: { tick: number; weighted: number }[];
  activeNichesMean: number;
  effectiveNichesMean: number;
  topNicheShareMean: number;
}

export function summarizeSlotCell(cell: SlotCell, principal = 10): SlotCellSummary {
  const ticks = cell.seeds[0]?.trace.map((_, index) => index * GENOME_TRACE_EVERY) ?? [];
  return {
    arm: cell.arm,
    magnitude: cell.magnitude,
    population: cell.population,
    regime: cell.regime,
    roiMean: mean(cell.seeds.map((item) => item.roiPct)),
    replacementsMean: mean(cell.seeds.map((item) => item.replacements)),
    noDonorMean: mean(cell.seeds.map((item) => item.noDonor)),
    capitalMovedMean: mean(cell.seeds.map((item) => item.capitalMoved)),
    capitalMovedPct: (mean(cell.seeds.map((item) => item.capitalMoved)) / (cell.population * principal)) * 100,
    reproductionsMean: mean(cell.seeds.map((item) => item.reproductions)),
    distance: ticks.map((tick, index) => ({
      tick,
      weighted: mean(cell.seeds.map((item) => item.trace[index] ?? 0)),
    })),
    activeNichesMean: mean(cell.seeds.map((item) => item.activeNiches)),
    effectiveNichesMean: mean(cell.seeds.map((item) => item.effectiveNiches)),
    topNicheShareMean: mean(cell.seeds.map((item) => item.topNicheShare)),
  };
}

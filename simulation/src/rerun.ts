import { mean, sampleStdev, welch, welchP } from "./aggregate.js";
import { createReproductionModule, median } from "./reproduction.js";
import { run } from "./runner.js";
import type { Regime, RunMode, RunResult } from "./types.js";

/** One arm of the 12-cell re-run. Everything not listed here is the section 8 baseline. */
export interface Arm {
  name: string;
  profitThresholdFraction: number;
  /** Undefined keeps the `DEFAULT_COSTS` price. */
  x402Usd?: number;
  informationPurchases: boolean;
  /** Skill heritability `h` (issue #80). Undefined keeps the runner default of 0. */
  skillHeritability?: number;
}

export const ARMS: Record<string, Arm> = {
  A: { name: "A", profitThresholdFraction: 0.1, x402Usd: 0.01, informationPurchases: true },
  B: { name: "B", profitThresholdFraction: 0.1, informationPurchases: false },
  C: { name: "C", profitThresholdFraction: 0.5, informationPurchases: true },
};

/** The section 8 baseline policy: risk 0.25, trade every tick, diversity on, 300 ticks. */
const GENOME = { riskTolerance: 0.25, executionFrequency: 1 };
export const TICKS = 300;

export interface SeedOutcome {
  seed: number;
  roiPct: number;
  reproductions: number;
  children: number;
  childrenActive: number;
  /** Sum over children of (capital - principal) / principal, in percent. */
  childRoiPctSum: number;
  childCapitalSum: number;
  childPrincipalSum: number;
  /** Mean hidden skill of the founders at tick 0. */
  skillStart: number;
  /** Mean hidden skill of the agents still active at the end. Null when none are. */
  skillEndActive: number | null;
  /** Capital-weighted mean hidden skill over every agent at the end, active or retired. */
  skillEndWeighted: number;
}

export interface RerunCell {
  arm: string;
  population: number;
  regime: Regime;
  evolving: SeedOutcome[];
  static: SeedOutcome[];
}

export function outcome(result: RunResult): SeedOutcome {
  const children = result.agents.filter((agent) => agent.id.startsWith("c"));
  const founders = result.agents.filter((agent) => agent.id.startsWith("a"));
  const active = result.agents.filter((agent) => agent.status === "active");
  const capital = result.agents.reduce((sum, agent) => sum + agent.capital, 0);
  return {
    seed: result.seed,
    roiPct: result.roiPct,
    reproductions: result.reproductions,
    children: children.length,
    childrenActive: children.filter((agent) => agent.status === "active").length,
    childRoiPctSum: children.reduce(
      (sum, agent) => sum + (agent.principal > 0 ? ((agent.capital - agent.principal) / agent.principal) * 100 : 0),
      0,
    ),
    childCapitalSum: children.reduce((sum, agent) => sum + agent.capital, 0),
    childPrincipalSum: children.reduce((sum, agent) => sum + agent.principal, 0),
    skillStart: mean(founders.map((agent) => agent.skill)),
    skillEndActive: active.length === 0 ? null : mean(active.map((agent) => agent.skill)),
    skillEndWeighted:
      capital > 0 ? result.agents.reduce((sum, agent) => sum + agent.capital * agent.skill, 0) / capital : 0,
  };
}

export function runRerunCell(arm: Arm, population: number, regime: Regime, seeds: number): RerunCell {
  const reproduction = createReproductionModule({ profitThresholdFraction: arm.profitThresholdFraction });
  const costs = arm.x402Usd === undefined ? {} : { x402Usd: arm.x402Usd };
  const byMode = (mode: RunMode): SeedOutcome[] => {
    const out: SeedOutcome[] = [];
    for (let seed = 1; seed <= seeds; seed++) {
      out.push(
        outcome(
          run({
            seed,
            population,
            ticks: TICKS,
            regime,
            mode,
            genome: GENOME,
            diversity: true,
            costs,
            reproduction,
            informationPurchases: arm.informationPurchases,
            ...(arm.skillHeritability === undefined ? {} : { skillHeritability: arm.skillHeritability }),
          }),
        ),
      );
    }
    return out;
  };
  return { arm: arm.name, population, regime, evolving: byMode("evolving"), static: byMode("static") };
}

export interface RerunRow {
  arm: string;
  population: number;
  regime: Regime;
  seeds: number;
  evolvingMean: number;
  staticMean: number;
  gap: number;
  p: number;
  reproductionsMean: number;
  reproducingShare: number;
  children: number;
  /** Share of all children, pooled over seeds, still active at the end. Null when there are none. */
  childActiveShare: number | null;
  childRoiMean: number | null;
  childCapitalMean: number | null;
  childPrincipalMean: number | null;
  /** Mean over seeds of the founders' mean skill, evolving mode. Founders are identical in both modes. */
  skillStart: number;
  /** Mean over seeds of the end-of-run active mean skill, evolving and static. */
  skillEndActiveEvolving: number;
  skillEndActiveStatic: number;
  /** Mean over seeds of the end-of-run capital-weighted mean skill, evolving and static. */
  skillEndWeightedEvolving: number;
  skillEndWeightedStatic: number;
  /**
   * Secondary observation only, not the pre-registered statistic: two-sided paired t-test p-value on the per-seed
   * evolving minus static ROI, pairing runs that share a seed and so a market path.
   */
  pairedP: number;
}

/** Two-sided paired t-test p-value. Secondary to the Welch test that the decision rule uses. */
export function pairedP(a: readonly number[], b: readonly number[]): number {
  const diffs = a.map((value, index) => value - (b[index] ?? 0));
  const sd = sampleStdev(diffs);
  const avg = mean(diffs);
  if (sd === 0) return avg === 0 ? 1 : 0;
  return welchP(avg / (sd / Math.sqrt(diffs.length)), diffs.length - 1);
}

export function compareCell(cell: RerunCell): RerunRow {
  const test = welch(
    cell.evolving.map((item) => item.roiPct),
    cell.static.map((item) => item.roiPct),
  );
  const children = cell.evolving.reduce((sum, item) => sum + item.children, 0);
  const pooled = (key: "childrenActive" | "childRoiPctSum" | "childCapitalSum" | "childPrincipalSum"): number | null =>
    children === 0 ? null : cell.evolving.reduce((sum, item) => sum + item[key], 0) / children;
  return {
    arm: cell.arm,
    population: cell.population,
    regime: cell.regime,
    seeds: cell.evolving.length,
    evolvingMean: test.meanA,
    staticMean: test.meanB,
    gap: test.meanA - test.meanB,
    p: test.p,
    reproductionsMean: mean(cell.evolving.map((item) => item.reproductions)),
    reproducingShare: cell.evolving.filter((item) => item.reproductions > 0).length / cell.evolving.length,
    children,
    childActiveShare: pooled("childrenActive"),
    childRoiMean: pooled("childRoiPctSum"),
    childCapitalMean: pooled("childCapitalSum"),
    childPrincipalMean: pooled("childPrincipalSum"),
    skillStart: mean(cell.evolving.map((item) => item.skillStart)),
    skillEndActiveEvolving: mean(cell.evolving.flatMap((item) => (item.skillEndActive === null ? [] : [item.skillEndActive]))),
    skillEndActiveStatic: mean(cell.static.flatMap((item) => (item.skillEndActive === null ? [] : [item.skillEndActive]))),
    skillEndWeightedEvolving: mean(cell.evolving.map((item) => item.skillEndWeighted)),
    skillEndWeightedStatic: mean(cell.static.map((item) => item.skillEndWeighted)),
    pairedP: pairedP(
      cell.evolving.map((item) => item.roiPct),
      cell.static.map((item) => item.roiPct),
    ),
  };
}

export type Call = "outperforms" | "underperforms" | "inconclusive" | "mixed";

export interface Decision {
  call: Call;
  cells: number;
  significant: number;
  higherSignificant: number;
  lowerSignificant: number;
  medianGap: number;
}

/**
 * The pre-registered section 8 rule. Outperforms: a strict majority of cells have the evolving mean higher with
 * p < 0.05, and the median gap is positive. Inconclusive: fewer than half the cells have p < 0.05 in either
 * direction. Underperforms is the mirror of outperforms. Any other outcome is reported as mixed.
 */
export function decide(rows: readonly RerunRow[], alpha = 0.05): Decision {
  const cells = rows.length;
  const higherSignificant = rows.filter((row) => row.p < alpha && row.gap > 0).length;
  const lowerSignificant = rows.filter((row) => row.p < alpha && row.gap < 0).length;
  const significant = rows.filter((row) => row.p < alpha).length;
  const medianGap = median(rows.map((row) => row.gap));
  const majority = Math.floor(cells / 2) + 1;
  let call: Call;
  if (higherSignificant >= majority && medianGap > 0) call = "outperforms";
  else if (lowerSignificant >= majority && medianGap < 0) call = "underperforms";
  else if (significant * 2 < cells) call = "inconclusive";
  else call = "mixed";
  return { call, cells, significant, higherSignificant, lowerSignificant, medianGap };
}

const fmt = (value: number | null, digits: number): string => (value === null ? "n/a" : value.toFixed(digits));
const pFmt = (p: number): string => (p < 0.0001 ? "<0.0001" : p.toFixed(4));

export function formatRows(rows: readonly RerunRow[]): string {
  const lines = [
    "| pop | regime | seeds | evolving roi | static roi | gap pp | Welch p | repro mean | seeds repro % | children | child active % | child roi % | child capital | child principal |",
    "|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
  ];
  for (const row of rows) {
    lines.push(
      `| ${row.population} | ${row.regime} | ${row.seeds} | ${row.evolvingMean.toFixed(2)} | ${row.staticMean.toFixed(2)} | ${row.gap.toFixed(2)} | ${pFmt(row.p)} | ${row.reproductionsMean.toFixed(2)} | ${(row.reproducingShare * 100).toFixed(0)} | ${row.children} | ${fmt(row.childActiveShare === null ? null : row.childActiveShare * 100, 1)} | ${fmt(row.childRoiMean, 1)} | ${fmt(row.childCapitalMean, 3)} | ${fmt(row.childPrincipalMean, 3)} |`,
    );
  }
  return lines.join("\n");
}

/** Mean hidden skill, in basis points per tick, at the start and the end, plus the secondary paired p-value. */
export function formatSkillRows(rows: readonly RerunRow[]): string {
  const bp = (value: number): string => (value * 10_000).toFixed(2);
  const lines = [
    "| pop | regime | skill start | evolving end active | static end active | evolving end weighted | static end weighted | paired p (secondary) |",
    "|---:|---|---:|---:|---:|---:|---:|---:|",
  ];
  for (const row of rows) {
    lines.push(
      `| ${row.population} | ${row.regime} | ${bp(row.skillStart)} | ${bp(row.skillEndActiveEvolving)} | ${bp(row.skillEndActiveStatic)} | ${bp(row.skillEndWeightedEvolving)} | ${bp(row.skillEndWeightedStatic)} | ${pFmt(row.pairedP)} |`,
    );
  }
  return lines.join("\n");
}

export function formatDecision(decision: Decision): string {
  return `Call: **${decision.call}**. ${decision.significant} of ${decision.cells} cells have p < 0.05 (${decision.higherSignificant} with evolving higher, ${decision.lowerSignificant} with evolving lower). Median gap ${decision.medianGap.toFixed(2)} pp.`;
}

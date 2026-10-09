import { mean } from "./aggregate.js";
import { createReproductionModule } from "./reproduction.js";
import { run } from "./runner.js";
import type { Regime } from "./types.js";

export interface ThresholdSpec {
  populations: number[];
  regimes: Regime[];
  profitThresholdFractions: number[];
  x402Prices: number[];
  seeds: number;
  ticks: number;
}

export interface ThresholdCell {
  population: number;
  regime: Regime;
  profitThresholdFraction: number;
  x402Usd: number;
  seeds: number;
  reproductionsMean: number;
  /** Share of seeds with at least one reproduction. */
  reproducingShare: number;
  roiMean: number;
  x402PerAgent: number;
  /** Mean starting capital of a child, over every child in every seed. */
  childPrincipalMean: number;
  /** Share of children retired by the end of the run. */
  childRetiredShare: number;
  evaluations: number;
  /** Share of evaluations that failed each gate. */
  failedShare: Record<string, number>;
  /** Share of evaluations where that gate was the only one that failed. */
  soleShare: Record<string, number>;
}

export const GATES = [
  "n_min",
  "cooldown",
  "percentile",
  "profit",
  "zero_downside_flag",
  "no_fitness",
  "descendants",
  "population_cap",
  "allocation",
] as const;

/** The section 8 baseline policy: risk 0.25, trade every tick, diversity on, evolving. */
const GENOME = { riskTolerance: 0.25, executionFrequency: 1 };

export function runThresholdGrid(spec: ThresholdSpec): ThresholdCell[] {
  const cells: ThresholdCell[] = [];
  for (const population of spec.populations) {
    for (const regime of spec.regimes) {
      for (const profitThresholdFraction of spec.profitThresholdFractions) {
        const reproduction = createReproductionModule({ profitThresholdFraction });
        for (const x402Usd of spec.x402Prices) {
          const counts: number[] = [];
          const roi: number[] = [];
          const x402: number[] = [];
          const children: number[] = [];
          let childrenRetired = 0;
          let evaluations = 0;
          const failed: Record<string, number> = {};
          const sole: Record<string, number> = {};
          for (let seed = 1; seed <= spec.seeds; seed++) {
            const result = run({
              seed,
              population,
              ticks: spec.ticks,
              regime,
              mode: "evolving",
              genome: GENOME,
              diversity: true,
              costs: { x402Usd },
              reproduction,
            });
            counts.push(result.reproductions);
            roi.push(result.roiPct);
            x402.push(result.ledger.x402 / population);
            for (const agent of result.agents) {
              if (!agent.id.startsWith("c")) continue;
              children.push(agent.principal);
              if (agent.status === "retired") childrenRetired += 1;
            }
            evaluations += result.gates.evaluations;
            for (const [gate, n] of Object.entries(result.gates.failed)) failed[gate] = (failed[gate] ?? 0) + n;
            for (const [gate, n] of Object.entries(result.gates.sole)) sole[gate] = (sole[gate] ?? 0) + n;
          }
          const share = (table: Record<string, number>): Record<string, number> =>
            Object.fromEntries(Object.entries(table).map(([gate, n]) => [gate, evaluations === 0 ? 0 : n / evaluations]));
          cells.push({
            population,
            regime,
            profitThresholdFraction,
            x402Usd,
            seeds: spec.seeds,
            reproductionsMean: mean(counts),
            reproducingShare: counts.filter((n) => n > 0).length / spec.seeds,
            roiMean: mean(roi),
            x402PerAgent: mean(x402),
            childPrincipalMean: mean(children),
            childRetiredShare: children.length === 0 ? 0 : childrenRetired / children.length,
            evaluations,
            failedShare: share(failed),
            soleShare: share(sole),
          });
        }
      }
    }
  }
  return cells;
}

const pct = (value: number | undefined): string => ((value ?? 0) * 100).toFixed(1);

export function formatThreshold(cells: ThresholdCell[]): string {
  const lines = [
    "| pop | regime | profit_frac | x402 | repro mean | seeds repro % | roi mean | x402/agent | child principal | child retired % | fail n_min % | fail cooldown % | fail percentile % | fail profit % | sole profit % | sole percentile % |",
    "|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
  ];
  for (const cell of cells) {
    lines.push(
      `| ${cell.population} | ${cell.regime} | ${cell.profitThresholdFraction} | ${cell.x402Usd} | ${cell.reproductionsMean.toFixed(2)} | ${pct(cell.reproducingShare)} | ${cell.roiMean.toFixed(2)} | ${cell.x402PerAgent.toFixed(2)} | ${cell.childPrincipalMean.toFixed(3)} | ${pct(cell.childRetiredShare)} | ${pct(cell.failedShare.n_min)} | ${pct(cell.failedShare.cooldown)} | ${pct(cell.failedShare.percentile)} | ${pct(cell.failedShare.profit)} | ${pct(cell.soleShare.profit)} | ${pct(cell.soleShare.percentile)} |`,
    );
  }
  const seen = new Set<string>();
  for (const cell of cells) {
    for (const gate of [...Object.keys(cell.failedShare), ...Object.keys(cell.soleShare)]) seen.add(gate);
  }
  if (seen.size > 0) {
    lines.push("", "Every gate seen, maximum over cells of the share of evaluations it failed and of the share where it was the only failure:", "");
    for (const gate of GATES.filter((item) => seen.has(item))) {
      const failed = Math.max(...cells.map((cell) => cell.failedShare[gate] ?? 0));
      const sole = Math.max(...cells.map((cell) => cell.soleShare[gate] ?? 0));
      lines.push(`- ${gate}: ${pct(failed)} percent failed, ${pct(sole)} percent sole`);
    }
  }
  lines.push("");
  return lines.join("\n");
}

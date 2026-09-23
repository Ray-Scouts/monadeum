import { run } from "./runner.js";
import type { Regime, RiskModule, RunMode, RunResult } from "./types.js";

export interface SweepSpec {
  populations: number[];
  regimes: Regime[];
  modes: RunMode[];
  risks: number[];
  frequencies: number[];
  ticks: number;
  seed: number;
  includeAllIn: boolean;
  includeZeroCost: boolean;
}

export interface SweepRow {
  population: number;
  regime: Regime;
  mode: RunMode;
  policy: string;
  legal: boolean;
  zeroCost: boolean;
  risk: number;
  frequency: number;
  endPopulation: number;
  roiPct: number;
  sortino: number | null;
  gini: number;
  reproductions: number;
  gas: number;
  x402: number;
  fees: number;
  slippage: number;
  grossPnl: number;
}

const ALL_IN_RISK: RiskModule = {
  clipGenome: (genome) => ({ ...genome, riskTolerance: 1, executionFrequency: 1 }),
  positionNotional: (capital) => Math.max(0, capital),
  allowsTrade: () => true,
};

const ZERO_COSTS = {
  gasUsd: 0,
  x402Usd: 0,
  feeBps: 0,
  slippageBps: 0,
  infoPurchaseProbability: 0,
  infoEdge: 0,
};

function rowFrom(result: RunResult, policy: string, legal: boolean, zeroCost: boolean, risk: number, frequency: number): SweepRow {
  return {
    population: result.population,
    regime: result.regime,
    mode: result.mode,
    policy,
    legal,
    zeroCost,
    risk,
    frequency,
    endPopulation: result.endPopulation,
    roiPct: result.roiPct,
    sortino: result.sortino,
    gini: result.gini,
    reproductions: result.reproductions,
    gas: result.ledger.gas,
    x402: result.ledger.x402,
    fees: result.ledger.fees,
    slippage: result.ledger.slippage,
    grossPnl: result.ledger.grossPnl,
  };
}

export function runSweep(spec: SweepSpec): SweepRow[] {
  const rows: SweepRow[] = [];
  for (const population of spec.populations) {
    for (const regime of spec.regimes) {
      for (const mode of spec.modes) {
        for (const risk of spec.risks) {
          for (const frequency of spec.frequencies) {
            const policy = `risk ${risk} / every ${frequency}`;
            const result = run({
              seed: spec.seed,
              population,
              ticks: spec.ticks,
              regime,
              mode,
              genome: { riskTolerance: risk, executionFrequency: frequency, entryThreshold: 0 },
            });
            rows.push(rowFrom(result, policy, true, false, risk, frequency));
            if (spec.includeZeroCost) {
              const bare = run({
                seed: spec.seed,
                population,
                ticks: spec.ticks,
                regime,
                mode,
                genome: { riskTolerance: risk, executionFrequency: frequency, entryThreshold: 0 },
                costs: ZERO_COSTS,
              });
              rows.push(rowFrom(bare, `${policy} / zero cost`, true, true, risk, frequency));
            }
          }
        }
        if (spec.includeAllIn) {
          const allIn = run({
            seed: spec.seed,
            population,
            ticks: spec.ticks,
            regime,
            mode,
            genome: { entryThreshold: -1 },
            risk: ALL_IN_RISK,
          });
          rows.push(rowFrom(allIn, "all-in every tick", false, false, 1, 1));
        }
      }
    }
  }
  return rows;
}

export function formatSweep(rows: SweepRow[]): string {
  const lines = [
    "# Position size and execution frequency",
    "",
    "Seed 42 unless a test spec says otherwise. `all-in every tick` is outside the legal `riskTolerance` ceiling. It is the preliminary model's policy, kept here so the gap can be measured. Zero-cost rows turn gas, x402, fees, slippage, and the information edge off.",
    "",
    "| pop | regime | mode | policy | legal | roi_pct | sortino | gini | repro | fees | gas | x402 | slippage |",
    "|---:|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|",
  ];
  for (const row of rows) {
    lines.push(
      `| ${row.population} | ${row.regime} | ${row.mode} | ${row.policy} | ${row.legal ? "yes" : "no"} | ${row.roiPct.toFixed(2)} | ${row.sortino === null ? "" : row.sortino.toFixed(4)} | ${row.gini.toFixed(3)} | ${row.reproductions} | ${row.fees.toFixed(2)} | ${row.gas.toFixed(2)} | ${row.x402.toFixed(2)} | ${row.slippage.toFixed(2)} |`,
    );
  }
  lines.push("", "## Attribution", "");
  lines.push(
    "For each population and regime, sizing-and-frequency is the static legal ROI minus the static all-in ROI, in percentage points. A positive number means the legal policy lost less than all-in. Other costs are the static zero-cost ROI of that same legal policy minus its with-cost ROI. The legal policy in the comparison is the one with the best static ROI.",
    "",
  );
  const populations = [...new Set(rows.map((row) => row.population))];
  const regimes = [...new Set(rows.map((row) => row.regime))];
  for (const population of populations) {
    for (const regime of regimes) {
      const staticRows = rows.filter((row) => row.population === population && row.regime === regime && row.mode === "static");
      const allIn = staticRows.find((row) => !row.legal);
      const legal = staticRows
        .filter((row) => row.legal && !row.zeroCost)
        .sort((a, b) => b.roiPct - a.roiPct)[0];
      const zero = legal
        ? staticRows.find((row) => row.zeroCost && row.risk === legal.risk && row.frequency === legal.frequency)
        : undefined;
      if (!allIn || !legal) continue;
      const sizing = legal.roiPct - allIn.roiPct;
      const other = zero ? zero.roiPct - legal.roiPct : null;
      lines.push(
        `- pop ${population}, ${regime}: all-in ROI ${allIn.roiPct.toFixed(2)}%, best legal (${legal.policy}) ROI ${legal.roiPct.toFixed(2)}%, sizing-and-frequency ${sizing.toFixed(2)} pp${other === null ? "" : `, other costs ${other.toFixed(2)} pp (zero-cost ROI ${zero?.roiPct.toFixed(2)}%)`}.`,
      );
    }
  }
  lines.push("");
  return lines.join("\n");
}

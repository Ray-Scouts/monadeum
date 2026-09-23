import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { distribution, welch } from "./aggregate.js";
import { run } from "./runner.js";
import type { Regime, RunMode } from "./types.js";

const seeds = Number(process.env.SEEDS ?? 50);
if (seeds < 50) {
  throw new Error(`refusing to write a multi-seed artifact with ${seeds} seeds`);
}

const populations = [10, 100, 1000];
const regimes: Regime[] = ["trending", "mean_reverting", "choppy", "stress_flash_crash"];
const modes: RunMode[] = ["static", "evolving"];
const genome = { riskTolerance: 0.25, executionFrequency: 1 };

interface Cell {
  population: number;
  regime: Regime;
  mode: RunMode;
  roi: number[];
  sortino: number[];
}

const cells: Cell[] = [];
for (const population of populations) {
  for (const regime of regimes) {
    for (const mode of modes) {
      const roi: number[] = [];
      const sortino: number[] = [];
      for (let seed = 1; seed <= seeds; seed++) {
        const result = run({
          seed,
          population,
          ticks: 300,
          regime,
          mode,
          genome,
          diversity: true,
        });
        roi.push(result.roiPct);
        sortino.push(result.sortino ?? 0);
      }
      cells.push({ population, regime, mode, roi, sortino });
    }
  }
}

const summary = cells.map((cell) => {
  const roi = distribution(cell.roi);
  const sortino = distribution(cell.sortino);
  return {
    population: cell.population,
    regime: cell.regime,
    mode: cell.mode,
    n: roi.n,
    roiMean: roi.mean,
    roiStdev: roi.stdev,
    sortinoMean: sortino.mean,
    sortinoStdev: sortino.stdev,
  };
});

const comparisons = [];
for (const population of populations) {
  for (const regime of regimes) {
    const evolving = cells.find((cell) => cell.population === population && cell.regime === regime && cell.mode === "evolving");
    const stat = cells.find((cell) => cell.population === population && cell.regime === regime && cell.mode === "static");
    if (!evolving || !stat) continue;
    const test = welch(evolving.roi, stat.roi);
    comparisons.push({
      population,
      regime,
      evolvingMean: test.meanA,
      staticMean: test.meanB,
      gap: test.meanA - test.meanB,
      p: test.p,
      meaningful: test.p < 0.05,
      evolvingHigher: test.meanA > test.meanB,
    });
  }
}

const payload = { seeds, genome, diversity: true, ticks: 300, summary, comparisons };
const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../../results");
mkdirSync(dir, { recursive: true });
writeFileSync(resolve(dir, "multiseed.json"), JSON.stringify(payload));

const lines = [
  "# Multi-seed sweep",
  "",
  `${seeds} seeds, 300 ticks, diversity on, legal policy risk 0.25 and execution every tick (the best static legal policy in \`sizing.md\`). ROI and Sortino are the mean and the sample standard deviation across seeds. Welch is evolving ROI against static ROI. A cell is called outside the noise of one run when the two-sided p-value is below 0.05.`,
  "",
  "| pop | regime | mode | n | roi mean | roi sd | sortino mean | sortino sd |",
  "|---:|---|---|---:|---:|---:|---:|---:|",
];
for (const row of summary) {
  lines.push(
    `| ${row.population} | ${row.regime} | ${row.mode} | ${row.n} | ${row.roiMean.toFixed(2)} | ${row.roiStdev.toFixed(2)} | ${row.sortinoMean.toFixed(4)} | ${row.sortinoStdev.toFixed(4)} |`,
  );
}
lines.push("", "## Evolving versus static", "");
for (const row of comparisons) {
  const word = row.meaningful ? "outside the noise of a single run" : "inside the noise of a single run";
  const direction = row.evolvingHigher ? "evolving mean ROI is higher" : "evolving mean ROI is lower";
  lines.push(
    `- pop ${row.population}, ${row.regime}: ${direction} by ${row.gap.toFixed(2)} pp (p=${row.p.toFixed(4)}), ${word}.`,
  );
}
lines.push("");
writeFileSync(resolve(dir, "multiseed.md"), lines.join("\n"));
process.stdout.write(`wrote ${summary.length} cells\n`);

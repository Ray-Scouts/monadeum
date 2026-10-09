import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { mean } from "./aggregate.js";
import { decide, type Decision } from "./rerun.js";
import { compareSlotCells, SLOT_ARMS, summarizeSlotCell, type SlotCell, type SlotComparison } from "./slots.js";

// Issue #89 report. Argument 1: directory of cli-slots JSON for the issue #89 arms. Argument 2: the issue #85
// directory, which supplies Control 1, Control 2, and arm B (B-c0.2-x2, B-c0.2-x4) on the same seeds.
const [dir, baseDir] = process.argv.slice(2);
if (!dir || !baseDir) throw new Error("usage: cli-scope-report <issue #89 directory> <issue #85 directory>");
const load = (path: string, keep: (arm: string) => boolean): SlotCell[] =>
  readdirSync(path)
    .filter((name) => name.endsWith(".json"))
    .flatMap((name) => (JSON.parse(readFileSync(resolve(path, name), "utf8")) as { cells: SlotCell[] }).cells)
    .filter((cell) => keep(cell.arm));
const baselines = ["C1", "C2", "B-c0.2-x2", "B-c0.2-x4"];
const cells: SlotCell[] = [...load(dir, () => true), ...load(baseDir, (arm) => baselines.includes(arm))];

const pops = [10, 100, 1000];
const regimes = ["trending", "mean_reverting", "choppy", "stress_flash_crash"];
const armOrder = [...baselines, ...Object.keys(SLOT_ARMS).filter((name) => name === "N" || /^(RO|O)/.test(name))];
const order = (cell: { population: number; regime: string }): number =>
  pops.indexOf(cell.population) * 10 + regimes.indexOf(cell.regime);
const pFmt = (p: number): string => (p < 0.0001 ? "<0.0001" : p.toFixed(4));

/** Arm B with the same ceiling. N has no ceiling and is compared with B-c0.2-x4, the stronger arm B. */
const armBFor = (arm: string): string | null => {
  if (arm.startsWith("B-") || arm === "C1" || arm === "C2") return null;
  return arm.endsWith("-x2") ? "B-c0.2-x2" : "B-c0.2-x4";
};

const find = (magnitude: number, arm: string, population: number, regime: string): SlotCell | undefined =>
  cells.find((c) => c.magnitude === magnitude && c.arm === arm && c.population === population && c.regime === regime);

const out: string[] = [];
for (const magnitude of [...new Set(load(dir, () => true).map((cell) => cell.magnitude))].sort((a, b) => a - b)) {
  const arms = armOrder.filter((arm) => cells.some((cell) => cell.magnitude === magnitude && cell.arm === arm));
  const comparisons = (arm: string, control: string): SlotComparison[] => {
    const rows: SlotComparison[] = [];
    for (const population of pops) {
      for (const regime of regimes) {
        const a = find(magnitude, arm, population, regime);
        const c = find(magnitude, control, population, regime);
        if (a && c) rows.push(compareSlotCells(a, c));
      }
    }
    return rows;
  };
  const verdict = (arm: string, control: string | null): string => {
    if (control === null || control === arm) return "n/a | n/a | n/a | n/a";
    const rows = comparisons(arm, control);
    if (rows.length === 0) return "n/a | n/a | n/a | n/a";
    const all: Decision = decide(rows);
    const stress = decide(rows.filter((row) => row.regime === "stress_flash_crash"));
    return `${all.significant} (${all.higherSignificant} up, ${all.lowerSignificant} down) | ${all.medianGap.toFixed(2)} | ${stress.call} (${stress.higherSignificant} up, ${stress.lowerSignificant} down) | **${all.call}**`;
  };

  out.push(`## Magnitude ${magnitude}`, "");
  out.push(
    "| arm | vs C1: cells p < 0.05 | vs C1: median gap pp | vs C1: stress | vs C1: call | vs C2: cells p < 0.05 | vs C2: median gap pp | vs C2: stress | vs C2: call | arm B | vs B: cells p < 0.05 | vs B: median gap pp | vs B: stress | vs B: call | moved % of start, mean of 12 cells |",
    "|---|---|---:|---|---|---|---:|---|---|---|---|---:|---|---|---:|",
  );
  for (const arm of arms.filter((name) => name !== "C1")) {
    const b = armBFor(arm);
    const moved = mean(
      cells.filter((cell) => cell.magnitude === magnitude && cell.arm === arm).map((cell) => summarizeSlotCell(cell).capitalMovedPct),
    );
    out.push(
      `| ${arm} | ${verdict(arm, "C1")} | ${verdict(arm, "C2")} | ${b ?? "n/a"} | ${verdict(arm, b)} | ${moved.toFixed(2)} |`,
    );
  }
  out.push("");

  out.push("Capital-weighted genome distance from the regime optimum, mean over the 12 cells and over seeds, at each trace tick, with the mean effective number of niches and the top niche's share of active capital at the end:", "");
  const first = cells.find((cell) => cell.magnitude === magnitude) as SlotCell;
  const ticks = summarizeSlotCell(first).distance.map((p) => p.tick);
  out.push(
    `| arm | ${ticks.map((tick) => `t${tick}`).join(" | ")} | effective niches | top niche % |`,
    `|---|${ticks.map(() => "---:").join("|")}|---:|---:|`,
  );
  for (const arm of arms) {
    const summaries = cells
      .filter((cell) => cell.magnitude === magnitude && cell.arm === arm)
      .map((cell) => summarizeSlotCell(cell));
    out.push(
      `| ${arm} | ${ticks.map((_, index) => mean(summaries.map((s) => s.distance[index]?.weighted ?? 0)).toFixed(3)).join(" | ")} | ${mean(summaries.map((s) => s.effectiveNichesMean)).toFixed(2)} | ${(mean(summaries.map((s) => s.topNicheShareMean)) * 100).toFixed(1)} |`,
    );
  }
  out.push("");

  for (const arm of arms.filter((name) => !baselines.includes(name))) {
    const own = cells
      .filter((cell) => cell.magnitude === magnitude && cell.arm === arm)
      .sort((a, b) => order(a) - order(b));
    const b = armBFor(arm);
    out.push(`### Magnitude ${magnitude}, arm ${arm}`, "");
    out.push(
      `| pop | regime | roi | gap vs C1 | Welch p vs C1 | gap vs C2 | Welch p vs C2 | gap vs ${b} | Welch p vs ${b} | paired p vs C1 (secondary) | paired p vs C2 (secondary) | paired p vs ${b} (secondary) | replacements | no donor | capital moved | moved % of start | distance t0 | distance t300 | active niches | effective niches | top niche % |`,
      "|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
    );
    for (const cell of own) {
      const s = summarizeSlotCell(cell);
      const vs = (control: string | null): SlotComparison | null => {
        if (control === null) return null;
        const c = find(magnitude, control, cell.population, cell.regime);
        return c ? compareSlotCells(cell, c) : null;
      };
      const rows = [vs("C1"), vs("C2"), vs(b)];
      const g = (row: SlotComparison | null): string => (row === null ? "n/a" : row.gap.toFixed(2));
      const p = (row: SlotComparison | null): string => (row === null ? "n/a" : pFmt(row.p));
      const pp = (row: SlotComparison | null): string => (row === null ? "n/a" : pFmt(row.pairedP));
      const d0 = s.distance[0]?.weighted ?? 0;
      const d1 = s.distance[s.distance.length - 1]?.weighted ?? 0;
      out.push(
        `| ${cell.population} | ${cell.regime} | ${s.roiMean.toFixed(2)} | ${rows.map((row) => `${g(row)} | ${p(row)}`).join(" | ")} | ${rows.map(pp).join(" | ")} | ${s.replacementsMean.toFixed(1)} | ${s.noDonorMean.toFixed(1)} | ${s.capitalMovedMean.toFixed(2)} | ${s.capitalMovedPct.toFixed(2)} | ${d0.toFixed(3)} | ${d1.toFixed(3)} | ${s.activeNichesMean.toFixed(1)} | ${s.effectiveNichesMean.toFixed(2)} | ${(s.topNicheShareMean * 100).toFixed(1)} |`,
      );
    }
    out.push("");
  }
}
process.stdout.write(out.join("\n"));

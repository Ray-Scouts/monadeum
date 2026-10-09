import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { mean } from "./aggregate.js";
import { decide } from "./rerun.js";
import { compareSlotCells, summarizeSlotCell, type SlotCell, type SlotComparison } from "./slots.js";

// Issue #92 report. Argument: the directory of cli-slots JSON for this run (seeds 51 to 100). Every arm, Control 1 and
// Control 2 included, is read from that one directory, so every comparison is on the same out-of-sample seeds.
const [dir] = process.argv.slice(2);
if (!dir) throw new Error("usage: cli-confirm-report <issue #92 directory>");
const cells: SlotCell[] = readdirSync(dir)
  .filter((name) => name.endsWith(".json"))
  .flatMap((name) => (JSON.parse(readFileSync(resolve(dir, name), "utf8")) as { cells: SlotCell[] }).cells);

const SEEDS = Array.from({ length: 50 }, (_, index) => index + 51);
for (const cell of cells) {
  const seeds = cell.seeds.map((item) => item.seed);
  if (seeds.join(",") !== SEEDS.join(",")) {
    throw new Error(`${cell.arm} ${cell.magnitude} ${cell.population} ${cell.regime} is not on seeds 51 to 100`);
  }
}

const PRIMARY = "Omix-RT-c0.2-x4";
const pops = [10, 100, 1000];
const regimes = ["trending", "mean_reverting", "choppy", "stress_flash_crash"];
const pFmt = (p: number): string => (p < 0.0001 ? "<0.0001" : p.toFixed(4));
const find = (magnitude: number, arm: string, population: number, regime: string): SlotCell | undefined =>
  cells.find((c) => c.magnitude === magnitude && c.arm === arm && c.population === population && c.regime === regime);
const comparisons = (magnitude: number, arm: string, control: string): SlotComparison[] => {
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
const verdictCells = (rows: SlotComparison[]): string => {
  if (rows.length === 0) return "n/a | n/a | n/a | n/a";
  const all = decide(rows);
  const stress = decide(rows.filter((row) => row.regime === "stress_flash_crash"));
  return `${all.cells} | ${all.significant} (${all.higherSignificant} up, ${all.lowerSignificant} down) | ${all.medianGap.toFixed(2)} | ${stress.call} (${stress.higherSignificant} up, ${stress.lowerSignificant} down) | **${all.call}**`;
};
const meanOver = (magnitude: number, arm: string, pick: (cell: SlotCell) => number): number =>
  mean(cells.filter((cell) => cell.magnitude === magnitude && cell.arm === arm).map(pick));
const recycledPct = (cell: SlotCell): number =>
  (mean(cell.seeds.map((item) => item.capitalRecycled ?? 0)) / (cell.population * 10)) * 100;

const magnitudes = [...new Set(cells.map((cell) => cell.magnitude))].sort((a, b) => b - a);
const out: string[] = [];

out.push("## Pre-registered comparisons", "");
out.push(
  "| magnitude | hypothesis | comparison | cells | cells p < 0.05 | median gap pp | stress (3 cells) | call |",
  "|---|---|---|---:|---|---:|---|---|",
);
for (const magnitude of magnitudes) {
  const h = magnitude === 0.009 ? ["H1", "H2"] : ["H3 (with C1)", "H3 (with C2)"];
  out.push(`| ${magnitude} | ${h[0]} | ${PRIMARY} vs C1 | ${verdictCells(comparisons(magnitude, PRIMARY, "C1"))} |`);
  out.push(`| ${magnitude} | ${h[1]} | ${PRIMARY} vs C2 | ${verdictCells(comparisons(magnitude, PRIMARY, "C2"))} |`);
  out.push(`| ${magnitude} | context | C2 vs C1 | ${verdictCells(comparisons(magnitude, "C2", "C1"))} |`);
}
out.push("");

for (const magnitude of magnitudes) {
  out.push(`### Magnitude ${magnitude}, ${PRIMARY} per cell`, "");
  out.push(
    `| pop | regime | ${PRIMARY} roi | C1 roi | gap vs C1 | Welch p vs C1 | C2 roi | gap vs C2 | Welch p vs C2 | paired p vs C1 (secondary) | paired p vs C2 (secondary) | moved % of start |`,
    "|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
  );
  for (const population of pops) {
    for (const regime of regimes) {
      const a = find(magnitude, PRIMARY, population, regime);
      const c1 = find(magnitude, "C1", population, regime);
      const c2 = find(magnitude, "C2", population, regime);
      if (!a || !c1 || !c2) continue;
      const r1 = compareSlotCells(a, c1);
      const r2 = compareSlotCells(a, c2);
      out.push(
        `| ${population} | ${regime} | ${r1.armMean.toFixed(2)} | ${r1.controlMean.toFixed(2)} | ${r1.gap.toFixed(2)} | ${pFmt(r1.p)} | ${r2.controlMean.toFixed(2)} | ${r2.gap.toFixed(2)} | ${pFmt(r2.p)} | ${pFmt(r1.pairedP)} | ${pFmt(r2.pairedP)} | ${summarizeSlotCell(a).capitalMovedPct.toFixed(2)} |`,
      );
    }
  }
  out.push("");
}

out.push("## Exploratory comparisons", "");
const exploratory = [
  "O3-RT-c0.2-x4",
  "O5-RT-c0.2-x4",
  "O10-RT-c0.2-x4",
  "RT-c0.2-x4",
  "RTs3-c0.2-x4",
  "RTs5-c0.2-x4",
  "Omix-RTr-c0.2-x4",
];
const pairs: [string, string][] = [
  ["RTs3-c0.2-x4", "O3-RT-c0.2-x4"],
  ["RTs5-c0.2-x4", "O5-RT-c0.2-x4"],
  ["RTs3-c0.2-x4", "RT-c0.2-x4"],
  ["RTs5-c0.2-x4", "RT-c0.2-x4"],
  ["O3-RT-c0.2-x4", "RT-c0.2-x4"],
  ["O5-RT-c0.2-x4", "RT-c0.2-x4"],
  ["O10-RT-c0.2-x4", "RT-c0.2-x4"],
  [PRIMARY, "RT-c0.2-x4"],
  ["Omix-RTr-c0.2-x4", PRIMARY],
];
for (const magnitude of magnitudes) {
  const present = exploratory.filter((arm) => cells.some((cell) => cell.magnitude === magnitude && cell.arm === arm));
  if (present.length === 0) continue;
  out.push(`### Magnitude ${magnitude}, exploratory arms against the controls and the primary arm`, "");
  out.push(
    "| arm | against | cells | cells p < 0.05 | median gap pp | stress (3 cells) | call |",
    "|---|---|---:|---|---:|---|---|",
  );
  for (const arm of present) {
    for (const control of ["C1", "C2", PRIMARY]) {
      out.push(`| ${arm} | ${control} | ${verdictCells(comparisons(magnitude, arm, control))} |`);
    }
  }
  for (const [arm, control] of pairs) {
    if (arm === PRIMARY && control === "RT-c0.2-x4" && !present.includes(control)) continue;
    const rows = comparisons(magnitude, arm, control);
    if (rows.length > 0) out.push(`| ${arm} | ${control} | ${verdictCells(rows)} |`);
  }
  out.push("");
}

for (const magnitude of magnitudes) {
  const arms = ["C1", "C2", PRIMARY, ...exploratory].filter((arm) =>
    cells.some((cell) => cell.magnitude === magnitude && cell.arm === arm),
  );
  const first = cells.find((cell) => cell.magnitude === magnitude) as SlotCell;
  const ticks = summarizeSlotCell(first).distance.map((p) => p.tick);
  out.push(`### Magnitude ${magnitude}, capital moved, genome distance, and diversity, means over the 12 cells`, "");
  out.push(
    `| arm | mean roi | moved % of start | recycled % of start | ${ticks.map((tick) => `distance t${tick}`).join(" | ")} | effective niches | top niche % |`,
    `|---|---:|---:|---:|${ticks.map(() => "---:").join("|")}|---:|---:|`,
  );
  for (const arm of arms) {
    const summaries = cells
      .filter((cell) => cell.magnitude === magnitude && cell.arm === arm)
      .map((cell) => summarizeSlotCell(cell));
    out.push(
      `| ${arm} | ${mean(summaries.map((s) => s.roiMean)).toFixed(2)} | ${mean(summaries.map((s) => s.capitalMovedPct)).toFixed(2)} | ${meanOver(magnitude, arm, recycledPct).toFixed(2)} | ${ticks.map((_, index) => mean(summaries.map((s) => s.distance[index]?.weighted ?? 0)).toFixed(3)).join(" | ")} | ${mean(summaries.map((s) => s.effectiveNichesMean)).toFixed(2)} | ${(mean(summaries.map((s) => s.topNicheShareMean)) * 100).toFixed(1)} |`,
    );
  }
  out.push("");
}

for (const magnitude of magnitudes) {
  for (const arm of exploratory) {
    if (!cells.some((cell) => cell.magnitude === magnitude && cell.arm === arm)) continue;
    out.push(`#### Magnitude ${magnitude}, ${arm} per cell (exploratory)`, "");
    out.push(
      `| pop | regime | roi | gap vs C1 | Welch p vs C1 | gap vs C2 | Welch p vs C2 | gap vs ${PRIMARY} | Welch p vs ${PRIMARY} | moved % of start | recycled % of start |`,
      "|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
    );
    for (const population of pops) {
      for (const regime of regimes) {
        const a = find(magnitude, arm, population, regime);
        if (!a) continue;
        const vs = (control: string): string => {
          const c = find(magnitude, control, population, regime);
          if (!c) return "n/a | n/a";
          const row = compareSlotCells(a, c);
          return `${row.gap.toFixed(2)} | ${pFmt(row.p)}`;
        };
        out.push(
          `| ${population} | ${regime} | ${summarizeSlotCell(a).roiMean.toFixed(2)} | ${vs("C1")} | ${vs("C2")} | ${vs(PRIMARY)} | ${summarizeSlotCell(a).capitalMovedPct.toFixed(2)} | ${recycledPct(a).toFixed(2)} |`,
        );
      }
    }
    out.push("");
  }
}
process.stdout.write(out.join("\n"));

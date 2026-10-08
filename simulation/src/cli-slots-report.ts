import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { mean } from "./aggregate.js";
import { decide, type Decision } from "./rerun.js";
import { compareSlotCells, summarizeSlotCell, type SlotCell, type SlotComparison } from "./slots.js";

const dir = process.argv[2];
if (!dir) throw new Error("usage: cli-slots-report <directory of cli-slots JSON files>");
const cells: SlotCell[] = [];
for (const file of readdirSync(dir).filter((name) => name.endsWith(".json"))) {
  cells.push(...(JSON.parse(readFileSync(resolve(dir, file), "utf8")) as { cells: SlotCell[] }).cells);
}

const pops = [10, 100, 1000];
const regimes = ["trending", "mean_reverting", "choppy", "stress_flash_crash"];
const armOrder = ["C1", "C2", "A", "B-c0.05-x2", "B-c0.05-x4", "B-c0.2-x2", "B-c0.2-x4", "S3"];
const order = (cell: { population: number; regime: string }): number =>
  pops.indexOf(cell.population) * 10 + regimes.indexOf(cell.regime);
const pFmt = (p: number): string => (p < 0.0001 ? "<0.0001" : p.toFixed(4));
const short = (d: Decision): string =>
  `${d.significant} (${d.higherSignificant} up, ${d.lowerSignificant} down) | ${d.medianGap.toFixed(2)}`;

const find = (magnitude: number, arm: string, population: number, regime: string): SlotCell | undefined =>
  cells.find((c) => c.magnitude === magnitude && c.arm === arm && c.population === population && c.regime === regime);

const out: string[] = [];
for (const magnitude of [...new Set(cells.map((cell) => cell.magnitude))].sort((a, b) => a - b)) {
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

  out.push(`## Magnitude ${magnitude}`, "");
  out.push(
    "| arm | vs C1: cells p < 0.05 | vs C1: median gap pp | vs C1: stress | vs C1: call | vs C2: cells p < 0.05 | vs C2: median gap pp | vs C2: stress | vs C2: call |",
    "|---|---|---:|---|---|---|---:|---|---|",
  );
  for (const arm of arms.filter((name) => name !== "C1")) {
    const parts: string[] = [];
    for (const control of ["C1", "C2"]) {
      if (control === arm) {
        parts.push("n/a | n/a | n/a | n/a");
        continue;
      }
      const rows = comparisons(arm, control);
      const all = decide(rows);
      const stress = decide(rows.filter((row) => row.regime === "stress_flash_crash"));
      const [cellsPart, gapPart] = short(all).split(" | ");
      parts.push(`${cellsPart} | ${gapPart} | ${stress.call} (${stress.higherSignificant} up, ${stress.lowerSignificant} down) | **${all.call}**`);
    }
    out.push(`| ${arm} | ${parts.join(" | ")} |`);
  }
  out.push("");

  out.push("Capital-weighted genome distance from the regime optimum, mean over the 12 cells and over seeds, at each trace tick:", "");
  const ticks = summarizeSlotCell(cells.find((cell) => cell.magnitude === magnitude) as SlotCell).distance.map((p) => p.tick);
  out.push(`| arm | ${ticks.map((tick) => `t${tick}`).join(" | ")} |`, `|---|${ticks.map(() => "---:").join("|")}|`);
  for (const arm of arms) {
    const summaries = cells
      .filter((cell) => cell.magnitude === magnitude && cell.arm === arm)
      .map((cell) => summarizeSlotCell(cell));
    out.push(
      `| ${arm} | ${ticks.map((_, index) => mean(summaries.map((s) => s.distance[index]?.weighted ?? 0)).toFixed(3)).join(" | ")} |`,
    );
  }
  out.push("");

  for (const arm of arms) {
    const own = cells
      .filter((cell) => cell.magnitude === magnitude && cell.arm === arm)
      .sort((a, b) => order(a) - order(b));
    out.push(`### Magnitude ${magnitude}, arm ${arm}`, "");
    out.push(
      "| pop | regime | roi | gap vs C1 | Welch p vs C1 | gap vs C2 | Welch p vs C2 | paired p vs C1 (secondary) | paired p vs C2 (secondary) | replacements | no donor | reproductions | capital moved | moved % of start | distance t0 | distance t300 | active niches | effective niches | top niche % |",
      "|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
    );
    for (const cell of own) {
      const s = summarizeSlotCell(cell);
      const vs = (control: string): SlotComparison | null => {
        if (control === arm) return null;
        const c = find(magnitude, control, cell.population, cell.regime);
        return c ? compareSlotCells(cell, c) : null;
      };
      const c1 = vs("C1");
      const c2 = vs("C2");
      const g = (row: SlotComparison | null): string => (row === null ? "n/a" : row.gap.toFixed(2));
      const p = (row: SlotComparison | null): string => (row === null ? "n/a" : pFmt(row.p));
      const pp = (row: SlotComparison | null): string => (row === null ? "n/a" : pFmt(row.pairedP));
      const first = s.distance[0]?.weighted ?? 0;
      const last = s.distance[s.distance.length - 1]?.weighted ?? 0;
      out.push(
        `| ${cell.population} | ${cell.regime} | ${s.roiMean.toFixed(2)} | ${g(c1)} | ${p(c1)} | ${g(c2)} | ${p(c2)} | ${pp(c1)} | ${pp(c2)} | ${s.replacementsMean.toFixed(1)} | ${s.noDonorMean.toFixed(1)} | ${s.reproductionsMean.toFixed(1)} | ${s.capitalMovedMean.toFixed(2)} | ${s.capitalMovedPct.toFixed(2)} | ${first.toFixed(3)} | ${last.toFixed(3)} | ${s.activeNichesMean.toFixed(1)} | ${s.effectiveNichesMean.toFixed(2)} | ${(s.topNicheShareMean * 100).toFixed(1)} |`,
      );
    }
    out.push("");
  }
}
process.stdout.write(out.join("\n"));

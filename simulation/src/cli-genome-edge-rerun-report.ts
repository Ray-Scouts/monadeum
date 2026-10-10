import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { decide } from "./rerun.js";
import { compareSlotCells, type SlotCell, type SlotComparison } from "./slots.js";

// Issue #102, H3. Argument: the directory of cli-slots JSON for the calibrated re-run. Every cell must be on seeds 101
// to 150 (none used before), at one magnitude. Prints the issue #92 comparison tables under the unchanged rule.
const [dir] = process.argv.slice(2);
if (!dir) throw new Error("usage: cli-genome-edge-rerun-report <directory>");
const cells: SlotCell[] = readdirSync(dir)
  .filter((name) => name.endsWith(".json"))
  .flatMap((name) => (JSON.parse(readFileSync(resolve(dir, name), "utf8")) as { cells: SlotCell[] }).cells);
const SEEDS = Array.from({ length: 50 }, (_, index) => index + 101).join(",");
for (const cell of cells) {
  if (cell.seeds.map((item) => item.seed).join(",") !== SEEDS) throw new Error(`${cell.arm} ${cell.population} ${cell.regime} is not on seeds 101 to 150`);
}
const magnitudes = new Set(cells.map((cell) => cell.magnitude));
if (magnitudes.size !== 1) throw new Error(`expected one magnitude, found ${[...magnitudes].join(", ")}`);

const PRIMARY = "Omix-RT-c0.2-x4";
const pops = [10, 100, 1000];
const regimes = ["trending", "mean_reverting", "choppy", "stress_flash_crash"];
const pFmt = (p: number): string => (p < 0.0001 ? "<0.0001" : p.toFixed(4));
const find = (arm: string, population: number, regime: string): SlotCell | undefined =>
  cells.find((c) => c.arm === arm && c.population === population && c.regime === regime);
const rows = (arm: string, control: string): SlotComparison[] => {
  const out: SlotComparison[] = [];
  for (const population of pops) {
    for (const regime of regimes) {
      const a = find(arm, population, regime);
      const c = find(control, population, regime);
      if (a && c) out.push(compareSlotCells(a, c));
    }
  }
  return out;
};
const line = (label: string, arm: string, control: string): string => {
  const r = rows(arm, control);
  const all = decide(r);
  const stress = decide(r.filter((row) => row.regime === "stress_flash_crash"));
  return `| ${label} | ${arm} vs ${control} | ${all.cells} | ${all.significant} (${all.higherSignificant} up, ${all.lowerSignificant} down) | ${all.medianGap.toFixed(2)} | ${stress.call} (${stress.higherSignificant} up, ${stress.lowerSignificant} down) | **${all.call}** |`;
};
const magnitude = [...magnitudes][0];
const out: string[] = [`Magnitude ${magnitude}, seeds 101 to 150.`, ""];
out.push("| hypothesis | comparison | cells | cells p < 0.05 | median gap pp | stress (3 cells) | call |", "|---|---|---:|---|---:|---|---|");
out.push(line("H3 (primary)", PRIMARY, "C1"), line("H3, reported", PRIMARY, "C2"), line("context", "C2", "C1"), "");
out.push("| pop | regime | arm roi | C1 roi | gap vs C1 | Welch p vs C1 | C2 roi | gap vs C2 | Welch p vs C2 |", "|---:|---|---:|---:|---:|---:|---:|---:|---:|");
for (const population of pops) {
  for (const regime of regimes) {
    const a = find(PRIMARY, population, regime);
    const c1 = find("C1", population, regime);
    const c2 = find("C2", population, regime);
    if (!a || !c1 || !c2) continue;
    const r1 = compareSlotCells(a, c1);
    const r2 = compareSlotCells(a, c2);
    out.push(
      `| ${population} | ${regime} | ${r1.armMean.toFixed(2)} | ${r1.controlMean.toFixed(2)} | ${r1.gap.toFixed(2)} | ${pFmt(r1.p)} | ${r2.controlMean.toFixed(2)} | ${r2.gap.toFixed(2)} | ${pFmt(r2.p)} |`,
    );
  }
}
console.log(out.join("\n"));

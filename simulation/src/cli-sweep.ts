import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { formatSweep, runSweep } from "./sweep.js";

const rows = runSweep({
  populations: [10, 100, 1000],
  regimes: ["trending", "mean_reverting", "choppy", "stress_flash_crash"],
  modes: ["static", "evolving"],
  risks: [0.05, 0.1, 0.25],
  frequencies: [1, 5, 20],
  ticks: 300,
  seed: 42,
  includeAllIn: true,
  includeZeroCost: true,
});

const target = resolve(dirname(fileURLToPath(import.meta.url)), "../../results/sizing.md");
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, formatSweep(rows));
process.stdout.write(`wrote ${rows.length} rows to ${target}\n`);

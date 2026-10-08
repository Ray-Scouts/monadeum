import { writeFileSync } from "node:fs";
import { ARMS, compareCell, runRerunCell } from "./rerun.js";
import type { Regime } from "./types.js";

const arm = ARMS[process.env.ARM ?? ""];
if (!arm) throw new Error(`ARM must be one of ${Object.keys(ARMS).join(", ")}`);
const populations = (process.env.POPS ?? "10,100,1000").split(",").map((item) => Number(item.trim()));
const regimes = (process.env.REGIMES ?? "trending,mean_reverting,choppy,stress_flash_crash")
  .split(",")
  .map((item) => item.trim()) as Regime[];
const seeds = Number(process.env.SEEDS ?? 50);

const rows = [];
for (const population of populations) {
  for (const regime of regimes) rows.push(compareCell(runRerunCell(arm, population, regime, seeds)));
}
const json = JSON.stringify({ arm, rows });
if (process.env.OUT) writeFileSync(process.env.OUT, json);
else process.stdout.write(`${json}\n`);

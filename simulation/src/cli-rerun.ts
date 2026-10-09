import { writeFileSync } from "node:fs";
import { ARMS, compareCell, runRerunCell } from "./rerun.js";
import type { Regime } from "./types.js";

const baseArm = ARMS[process.env.ARM ?? ""];
if (!baseArm) throw new Error(`ARM must be one of ${Object.keys(ARMS).join(", ")}`);
// H sets skill heritability (issue #80) and suffixes the arm name, for example A-h0.5.
const h = process.env.H === undefined ? undefined : Number(process.env.H);
const arm = h === undefined ? baseArm : { ...baseArm, name: `${baseArm.name}-h${h}`, skillHeritability: h };
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

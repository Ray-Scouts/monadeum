import { writeFileSync } from "node:fs";
import { runSlotCell, SLOT_ARMS } from "./slots.js";
import type { Regime } from "./types.js";

// Issue #85. ARM is one of SLOT_ARMS, MAG the genome model magnitude. POPS, REGIMES, SEEDS, and OUT as in cli-rerun.
// SEED_START (issue #92) is the first seed, default 1: SEEDS=50 SEED_START=51 runs seeds 51 to 100.
const arm = SLOT_ARMS[process.env.ARM ?? ""];
if (!arm) throw new Error(`ARM must be one of ${Object.keys(SLOT_ARMS).join(", ")}`);
const magnitude = Number(process.env.MAG);
if (!(magnitude >= 0)) throw new Error("MAG must be a genome model magnitude >= 0");
const populations = (process.env.POPS ?? "10,100,1000").split(",").map((item) => Number(item.trim()));
const regimes = (process.env.REGIMES ?? "trending,mean_reverting,choppy,stress_flash_crash")
  .split(",")
  .map((item) => item.trim()) as Regime[];
const seeds = Number(process.env.SEEDS ?? 50);
const firstSeed = Number(process.env.SEED_START ?? 1);

const cells = [];
for (const population of populations) {
  for (const regime of regimes) cells.push(runSlotCell(arm, magnitude, population, regime, seeds, firstSeed));
}
const json = JSON.stringify({ arm, magnitude, cells });
if (process.env.OUT) writeFileSync(process.env.OUT, json);
else process.stdout.write(`${json}\n`);

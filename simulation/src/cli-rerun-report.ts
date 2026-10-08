import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { decide, formatDecision, formatRows, type RerunRow } from "./rerun.js";

const dir = process.argv[2];
if (!dir) throw new Error("usage: cli-rerun-report <directory of cli-rerun JSON files>");
const rows: RerunRow[] = [];
for (const file of readdirSync(dir).filter((name) => name.endsWith(".json"))) {
  rows.push(...(JSON.parse(readFileSync(resolve(dir, file), "utf8")) as { rows: RerunRow[] }).rows);
}
const pops = [10, 100, 1000];
const regimes = ["trending", "mean_reverting", "choppy", "stress_flash_crash"];
const order = (row: RerunRow): number => pops.indexOf(row.population) * 10 + regimes.indexOf(row.regime);
const out: string[] = [];
for (const arm of [...new Set(rows.map((row) => row.arm))].sort()) {
  const armRows = rows.filter((row) => row.arm === arm).sort((a, b) => order(a) - order(b));
  const stress = armRows.filter((row) => row.regime === "stress_flash_crash");
  out.push(`## Arm ${arm}`, "", formatRows(armRows), "", formatDecision(decide(armRows)), "");
  out.push(`Stress cells only: ${formatDecision(decide(stress))}`, "");
}
process.stdout.write(out.join("\n"));

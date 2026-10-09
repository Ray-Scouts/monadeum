import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { formatQuintiles, formatValidationSummary, validateCell, type ValidationRow } from "./genome-validation.js";
import type { Regime } from "./types.js";

// REPORT=<dir> prints the tables for a directory of JSON outputs. Otherwise one run: MAGS is a comma list of
// magnitudes, where "skill" is the current harness (identical founders, hidden skill).
const regimeOrder = ["trending", "mean_reverting", "choppy", "stress_flash_crash"];
if (process.env.REPORT) {
  const dir = process.env.REPORT;
  const rows: ValidationRow[] = [];
  for (const file of readdirSync(dir).filter((name) => name.endsWith(".json"))) {
    rows.push(...(JSON.parse(readFileSync(resolve(dir, file), "utf8")) as { rows: ValidationRow[] }).rows);
  }
  const magKey = (row: ValidationRow): number => (row.magnitude === null ? -1 : row.magnitude);
  rows.sort((a, b) => regimeOrder.indexOf(a.regime) - regimeOrder.indexOf(b.regime) || magKey(a) - magKey(b));
  process.stdout.write(`${formatValidationSummary(rows)}\n\n${formatQuintiles(rows)}\n`);
} else {
  const regimes = (process.env.REGIMES ?? regimeOrder.join(",")).split(",").map((item) => item.trim()) as Regime[];
  const magnitudes = (process.env.MAGS ?? "skill,0,0.003,0.006")
    .split(",")
    .map((item) => (item.trim() === "skill" ? null : Number(item)));
  const population = Number(process.env.POP ?? 1000);
  const seeds = Number(process.env.SEEDS ?? 20);
  const rows: ValidationRow[] = [];
  for (const regime of regimes) {
    for (const magnitude of magnitudes) rows.push(validateCell({ regime, magnitude, population, seeds }));
  }
  const json = JSON.stringify({ rows });
  if (process.env.OUT) writeFileSync(process.env.OUT, json);
  else process.stdout.write(`${json}\n`);
}

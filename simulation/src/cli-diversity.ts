import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { run } from "./runner.js";
import type { Regime } from "./types.js";

const regimes: Regime[] = ["trending", "mean_reverting", "choppy", "stress_flash_crash"];
const populations = [10, 100, 1000];
const lines = [
  "# Niche sharing and diversity-responsive mutation",
  "",
  "Seed 42, 300 ticks, evolving only. Starting genomes are spread across pair sets and the five risk bands, so the run does not begin as a single niche by construction. The off column is the same setup with diversity disabled, which is the no-mechanism baseline.",
  "",
  "| pop | regime | diversity | end_pop | niches | gini | repro |",
  "|---:|---|---|---:|---:|---:|---:|",
];

for (const population of populations) {
  for (const regime of regimes) {
    for (const diversity of [false, true]) {
      const result = run({
        seed: 42,
        population,
        ticks: 300,
        regime,
        mode: "evolving",
        diversity,
        spreadNiches: true,
        genome: { riskTolerance: 0.25, executionFrequency: 1 },
      });
      const niches = new Set(result.agents.filter((agent) => agent.status === "active").map((agent) => agent.niche)).size;
      lines.push(
        `| ${population} | ${regime} | ${diversity ? "on" : "off"} | ${result.endPopulation} | ${niches} | ${result.gini.toFixed(3)} | ${result.reproductions} |`,
      );
    }
  }
}

lines.push("");
const target = resolve(dirname(fileURLToPath(import.meta.url)), "../../results/diversity.md");
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, lines.join("\n"));
process.stdout.write(`wrote ${target}\n`);

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createRiskModule, PROTOCOL, run } from "../src/index.js";
import { genomeDistance, genomeEdge, genomeScore, OFFSET, OPTIMA, randomGenome } from "../src/genome-model.js";
import { ARMS, compareCell, runRerunCell, type RerunRow } from "../src/rerun.js";
import { mulberry32 } from "../src/rng.js";
import type { Genome, Regime } from "../src/types.js";

const risk = createRiskModule();
const regimes: Regime[] = ["trending", "mean_reverting", "choppy", "stress_flash_crash"];
const base: Genome = risk.clipGenome({
  strategyType: "trading",
  assetUniverse: ["PAIR_A"],
  riskTolerance: 0.25,
  executionFrequency: 1,
  timeHorizon: 20,
  entryThreshold: 0,
  exitThreshold: 0,
  informationSources: ["nansen"],
  informationBudget: 0.05,
  modelConfiguration: "low",
});
const optimum = (regime: Regime): Genome => ({
  ...base,
  timeHorizon: OPTIMA[regime].timeHorizon,
  entryThreshold: OPTIMA[regime].entryThreshold,
  assetUniverse: [OPTIMA[regime].pair],
});

test("the optimum scores 1 and the edge spans magnitude/3 below zero to 2 magnitude/3 above", () => {
  for (const regime of regimes) {
    assert.ok(Math.abs(genomeScore(optimum(regime), regime) - 1) < 1e-12);
    assert.ok(Math.abs(genomeEdge(optimum(regime), regime, { magnitude: 0.006 }) - 0.004) < 1e-12);
    for (const timeHorizon of [1, 3, 12, 100, 200]) {
      for (const entryThreshold of [-1, -0.01, 0, 0.01, 1]) {
        for (const pair of PROTOCOL.allowedPairs) {
          const genome: Genome = { ...base, timeHorizon, entryThreshold, assetUniverse: [pair] };
          const score = genomeScore(genome, regime);
          assert.ok(score >= 0 && score <= 1 + 1e-12);
          assert.ok(genomeEdge(genome, regime, { magnitude: 0.006 }) >= -0.006 * OFFSET - 1e-12);
        }
      }
    }
  }
  assert.ok(genomeScore({ ...base, timeHorizon: 100 }, "trending") > genomeScore({ ...base, timeHorizon: 5 }, "trending"));
  assert.ok(
    genomeScore({ ...base, timeHorizon: 5 }, "mean_reverting") > genomeScore({ ...base, timeHorizon: 100 }, "mean_reverting"),
  );
});

test("only the traded pair, the time horizon, and the entry threshold move the score", () => {
  const genome = optimum("trending");
  const changed: Genome = {
    ...genome,
    exitThreshold: 0.5,
    riskTolerance: 0.1,
    executionFrequency: 7,
    informationBudget: 0.5,
    modelConfiguration: "mid",
    assetUniverse: ["PAIR_A", "PAIR_C"],
  };
  assert.equal(genomeScore(changed, "trending"), genomeScore(genome, "trending"));
  assert.ok(genomeScore({ ...genome, assetUniverse: ["PAIR_C", "PAIR_A"] }, "trending") < 1);
});

test("random genomes stay inside protocol bounds and keep the policy's risk and frequency", () => {
  const rng = mulberry32(11);
  const firstPairs = new Map<string, number>();
  for (let i = 0; i < 3000; i++) {
    const genome = randomGenome(rng, base, risk);
    assert.deepEqual(risk.clipGenome(genome), genome);
    assert.equal(genome.riskTolerance, 0.25);
    assert.equal(genome.executionFrequency, 1);
    assert.ok(genome.timeHorizon >= PROTOCOL.timeHorizonMin && genome.timeHorizon <= PROTOCOL.timeHorizonMax);
    assert.ok(Math.abs(genome.entryThreshold) <= 0.01);
    assert.ok(genome.assetUniverse.length >= 1 && genome.assetUniverse.length <= 3);
    const first = genome.assetUniverse[0] ?? "";
    firstPairs.set(first, (firstPairs.get(first) ?? 0) + 1);
  }
  for (const pair of PROTOCOL.allowedPairs) assert.ok((firstPairs.get(pair) ?? 0) > 850);
});

test("with the model on, hidden skill is zero, distance is reported, and the trace starts at tick 0", () => {
  const result = run({
    seed: 4,
    population: 20,
    ticks: 120,
    regime: "choppy",
    mode: "static",
    genome: { riskTolerance: 0.25, executionFrequency: 1 },
    genomeModel: { magnitude: 0.006 },
    randomGenomes: true,
  });
  for (const agent of result.agents) {
    assert.equal(agent.skill, 0);
    assert.ok(agent.genomeDistance !== undefined && agent.genomeDistance >= 0 && agent.genomeDistance <= 1);
  }
  assert.deepEqual(
    result.genomeTrace?.map((point) => point.tick),
    [0, 60, 120],
  );
  const off = run({ seed: 4, population: 20, ticks: 120, regime: "choppy", mode: "static" });
  assert.equal(off.genomeTrace, undefined);
  assert.ok(off.agents.every((agent) => agent.genomeDistance === undefined && agent.skill !== 0));
});

test("a population at the regime optimum earns more than one far from it, on the same market path", () => {
  for (const regime of regimes) {
    const common = {
      seed: 9,
      population: 50,
      ticks: 300,
      regime,
      mode: "static" as const,
      genomeModel: { magnitude: 0.006 },
      costs: { x402Usd: 0.01 },
    };
    const near = run({ ...common, genome: optimum(regime) });
    const far = run({ ...common, genome: { ...base, timeHorizon: 200, entryThreshold: 0.01, assetUniverse: ["PAIR_B"] } });
    assert.ok(Math.abs(genomeDistance(optimum(regime), regime)) < 1e-12);
    assert.ok(near.roiPct > far.roiPct, `${regime}: ${near.roiPct} <= ${far.roiPct}`);
  }
});

test("with the model off, a published twelve-cell row reproduces field by field", () => {
  const url = new URL("../../results/twelve-cell-rerun/A-10-choppy.json", import.meta.url);
  const published = (JSON.parse(readFileSync(url, "utf8")) as { rows: RerunRow[] }).rows[0];
  assert.ok(published);
  const row = compareCell(runRerunCell(ARMS.A!, 10, "choppy", 50));
  for (const [key, value] of Object.entries(published)) {
    assert.ok(Object.is(row[key as keyof RerunRow], value), `${key}: ${String(row[key as keyof RerunRow])} vs ${String(value)}`);
  }
});
